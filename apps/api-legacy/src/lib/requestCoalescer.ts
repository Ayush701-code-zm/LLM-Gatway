/**
 * In-flight Request Coalescer
 *
 * Problem it solves:
 *   Under bursty traffic the same prompt can arrive multiple times concurrently
 *   (client retries, duplicate tab submits, load-balancer replays).  Without
 *   coalescing every copy fires a separate LLM call, multiplying cost N×.
 *
 * Solution:
 *   Maintain a process-local Map of  requestHash → inflight Promise.
 *   When a request arrives:
 *     ①  Hash { workspaceId, model, messages, temperature, maxTokens }.
 *     ②  If an identical hash is already in-flight, subscribe to its Promise.
 *     ③  Otherwise, register a new entry and execute the call.
 *     ④  Either way, callers receive the same resolved value.
 *
 * Scope:
 *   Single-process only — sufficient for most deployments.
 *   For multi-instance setups the semantic cache (via pgvector) already
 *   coalesces *completed* responses; this layer handles the race window
 *   before any response is cached.
 *
 * Throughput:
 *   The Map entry is deleted as soon as the Promise settles, so memory
 *   footprint is proportional only to concurrent in-flight requests.
 *
 * Observable:
 *   Every coalesced (deduplicated) call is counted in the `coalesced_requests_total`
 *   Prometheus counter so you can see the cost-saving impact in Grafana.
 */

import crypto from 'node:crypto';
import { logger } from '../config/logger';
import { Counter } from 'prom-client';

// Prometheus counter — how many requests were served from a coalesced in-flight call
const coalescedRequestsTotal = new Counter({
  name:    'smartroute_coalesced_requests_total',
  help:    'Number of LLM requests served from an identical in-flight coalesced request',
  labelNames: ['workspace_id'],
});

export interface CoalesceKey {
  workspaceId:  string;
  model:        string;
  messages:     Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?:   number;
}

export class RequestCoalescer {
  /** Map from request hash → in-flight Promise */
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Execute `fn` at most once per unique `key` across concurrent callers.
   *
   * If a call with the same hash is already in-flight, `fn` is NOT called —
   * the caller waits for the existing Promise to resolve and gets that result.
   */
  async coalesce<T>(key: CoalesceKey, fn: () => Promise<T>): Promise<T> {
    const hash = this.hash(key);
    const existing = this.inflight.get(hash);

    if (existing) {
      coalescedRequestsTotal.inc({ workspace_id: key.workspaceId });
      logger.debug(
        { hash: hash.slice(0, 8), workspaceId: key.workspaceId },
        'Request coalesced — waiting for in-flight LLM call',
      );
      return existing as Promise<T>;
    }

    // Register the new in-flight promise
    const promise = fn().finally(() => {
      // Always remove entry when the call settles (success or error)
      this.inflight.delete(hash);
    });

    this.inflight.set(hash, promise);
    return promise;
  }

  /** Number of currently in-flight unique requests */
  get size(): number {
    return this.inflight.size;
  }

  private hash(key: CoalesceKey): string {
    const normalized = JSON.stringify({
      w: key.workspaceId,
      m: key.model,
      // Normalize message whitespace for better deduplication
      ms: key.messages.map((msg) => ({
        r: msg.role,
        c: msg.content.trim().replace(/\s+/g, ' '),
      })),
      t:  key.temperature ?? null,
      mt: key.maxTokens   ?? null,
    });
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }
}

/** Process-level singleton — shared across all gateway requests in this process */
export const requestCoalescer = new RequestCoalescer();
