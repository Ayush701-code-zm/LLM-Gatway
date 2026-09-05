/**
 * Token Pre-Estimator
 *
 * Why:
 *   Budget enforcement and TPM (tokens-per-minute) rate limiting need a
 *   token count *before* the LLM responds. We use tiktoken to count input
 *   tokens and apply a configurable multiplier to estimate the output.
 *
 * Encoding map:
 *   GPT-4 / GPT-4o family  → cl100k_base
 *   GPT-3.5-turbo          → cl100k_base
 *   text-embedding-*       → cl100k_base
 *   Anthropic Claude        → cl100k_base (conservative approximation)
 *   Google Gemini           → cl100k_base (conservative approximation)
 *   Ollama / unknown        → simple char/4 heuristic fallback
 *
 * The estimator is intentionally over-inclusive (slightly inflates the count)
 * to avoid under-charging. The actual token usage recorded in the DB comes from
 * the provider response (source of truth for billing).
 */

import { getEncoding, type Tiktoken } from 'js-tiktoken';

// Output-to-input ratio used for estimation when no hint is available.
// Claude and GPT-4o typically respond with 30-50% of input token count.
const DEFAULT_OUTPUT_RATIO = 0.5;

// Maps model ID prefixes to tiktoken encoding names.
// We keep this simple — both cl100k_base and o200k_base count very similarly.
const MODEL_ENCODING: Record<string, 'cl100k_base' | 'o200k_base'> = {
  'gpt-4o':          'o200k_base',
  'gpt-4':           'cl100k_base',
  'gpt-3.5':         'cl100k_base',
  'text-embedding':  'cl100k_base',
  'claude':          'cl100k_base',
  'gemini':          'cl100k_base',
};

let cl100kEncoder: Tiktoken | null = null;
let o200kEncoder:  Tiktoken | null = null;

function getEncoder(model: string): Tiktoken | null {
  try {
    const encodingName = Object.entries(MODEL_ENCODING).find(([prefix]) =>
      model.toLowerCase().startsWith(prefix),
    )?.[1] ?? 'cl100k_base';

    if (encodingName === 'o200k_base') {
      if (!o200kEncoder) o200kEncoder = getEncoding('o200k_base');
      return o200kEncoder;
    }
    if (!cl100kEncoder) cl100kEncoder = getEncoding('cl100k_base');
    return cl100kEncoder;
  } catch {
    return null;  // fallback to heuristic
  }
}

export interface TokenEstimate {
  inputTokens:    number;
  outputTokens:   number;
  totalTokens:    number;
  /** Whether this was a precise tiktoken count or a char-based heuristic */
  method: 'tiktoken' | 'heuristic';
}

/**
 * Estimate total tokens for a set of messages + expected output.
 *
 * @param messages  Chat messages (role + content)
 * @param model     The model ID (used to select encoding)
 * @param maxTokens Optional max_tokens requested (used as output upper bound)
 */
export function estimateTokens(
  messages: Array<{ role: string; content: string }>,
  model:    string,
  maxTokens?: number,
): TokenEstimate {
  const encoder = getEncoder(model);

  // Combine all message content for counting
  const fullText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  let inputTokens: number;
  let method: TokenEstimate['method'];

  if (encoder) {
    // Tiktoken precise count (+4 tokens per message for role/formatting overhead)
    inputTokens = encoder.encode(fullText).length + messages.length * 4;
    method = 'tiktoken';
  } else {
    // Heuristic: ~4 chars per token (standard rule of thumb)
    inputTokens = Math.ceil(fullText.length / 4);
    method = 'heuristic';
  }

  // Output estimation: use maxTokens cap if provided, otherwise apply ratio
  const estimatedOutput = maxTokens
    ? Math.min(maxTokens, Math.ceil(inputTokens * DEFAULT_OUTPUT_RATIO))
    : Math.ceil(inputTokens * DEFAULT_OUTPUT_RATIO);

  return {
    inputTokens,
    outputTokens: estimatedOutput,
    totalTokens:  inputTokens + estimatedOutput,
    method,
  };
}

/**
 * Quick single-string token count (for cache key generation, budget checks etc.)
 */
export function countTokens(text: string, model = 'gpt-4o'): number {
  const encoder = getEncoder(model);
  if (encoder) return encoder.encode(text).length;
  return Math.ceil(text.length / 4);
}
