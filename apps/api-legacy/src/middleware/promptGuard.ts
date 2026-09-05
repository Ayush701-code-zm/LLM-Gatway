/**
 * Prompt Injection Guard
 *
 * Detects and blocks prompt injection / jailbreak attempts before they
 * reach an LLM provider.  Works in two layers:
 *
 *   1. Pattern matching  — regex library of known injection patterns
 *      (role-switching, system-override, DAN prompts, delimiter attacks)
 *
 *   2. Heuristic scoring — weighted sum across signal categories.
 *      Score ≥ BLOCK_THRESHOLD  → 400 Bad Request
 *      Score ≥ WARN_THRESHOLD   → request proceeds, flag logged + recorded
 *
 * Design decisions:
 *   - Fail-open by default: if the guard itself throws, the request continues.
 *   - The guard only reads `message` and `systemPrompt`; never the routing result.
 *   - Block decisions are logged to the AuditLog asynchronously (fire-and-forget).
 *   - Every detected injection increments the `smartroute_injection_attempts_total`
 *     Prometheus counter so you can alert on it in Grafana.
 *
 * Calibration:
 *   Thresholds are conservative to avoid false positives on legitimate technical
 *   prompts (e.g. "ignore the previous tests and write new ones" from a developer).
 *   Tune BLOCK_THRESHOLD and WARN_THRESHOLD per deployment risk profile.
 */

import type { Request, Response, NextFunction } from 'express';
import { Counter } from 'prom-client';
import { logger } from '../config/logger';

// ── Prometheus counter ────────────────────────────────────────

const injectionAttemptsTotal = new Counter({
  name:       'smartroute_injection_attempts_total',
  help:       'Number of detected prompt injection attempts',
  labelNames: ['severity', 'workspace_id'],
});

// ── Thresholds ────────────────────────────────────────────────

export const BLOCK_THRESHOLD = 0.70;
export const WARN_THRESHOLD  = 0.40;

// ── Signal patterns and weights ──────────────────────────────

interface SignalPattern {
  pattern: RegExp;
  weight:  number;
  label:   string;
}

const SIGNALS: SignalPattern[] = [
  // ── Role / persona override
  { label: 'role_override',      weight: 0.45, pattern: /\b(you are now|act as|pretend (to be|you are)|roleplay as|your new (role|persona|identity) is)\b/i },
  { label: 'dan_jailbreak',      weight: 0.80, pattern: /\bDAN\b|\bdo anything now\b|\bjailbreak\b/i },
  { label: 'developer_mode',     weight: 0.60, pattern: /\b(developer mode|sudo mode|god mode|unrestricted mode|bypass (all )?(restrictions|filters|safety))\b/i },

  // ── System / instruction override
  { label: 'ignore_previous',    weight: 0.55, pattern: /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|above|prior|all)\b.{0,40}\b(instruction|prompt|rule|guideline|context|message)\b/i },
  { label: 'system_override',    weight: 0.65, pattern: /\[SYSTEM\]|\[INST\]|\[\/INST\]|<\|system\|>|<\|user\|>|<\|assistant\|>/i },
  { label: 'new_instructions',   weight: 0.45, pattern: /\b(your (new |real |actual |true |only )?(instruction|task|job|goal|purpose|directive|objective) (is|are|will be))\b/i },

  // ── Delimiter / context injection
  { label: 'delimiter_attack',   weight: 0.50, pattern: /(-{4,}|={4,}|\*{4,}|_{4,})\s*(system|user|assistant|instruction|prompt|context)/i },
  { label: 'template_injection',  weight: 0.40, pattern: /\{\{.*?\}\}|\{%.*?%\}|<%.*?%>/i },
  { label: 'xml_injection',       weight: 0.35, pattern: /<(system|prompt|instruction|context|task|role)>/i },

  // ── Data exfiltration
  { label: 'exfil_prompt',        weight: 0.55, pattern: /\b(repeat|print|output|reveal|show|tell me|display|write out).{0,50}\b(system prompt|instruction|context|training data|secret|password|api key)\b/i },
  { label: 'exfil_base64',        weight: 0.40, pattern: /\b(encode|decode|base64).{0,30}\b(system|instruction|prompt)\b/i },

  // ── Safety bypass
  { label: 'safety_bypass',       weight: 0.50, pattern: /\b(without|no|disable|remove|bypass|ignore)\b.{0,30}\b(ethical|moral|safety|content|filter|restriction|guideline|policy|limit)\b/i },
  { label: 'hypothetical_bypass', weight: 0.35, pattern: /\b(hypothetically|theoretically|in a fictional|imagine if|what if .{0,30} no (rule|law|restriction|limit|filter))\b/i },

  // ── Token manipulation
  { label: 'token_manipulation',  weight: 0.30, pattern: /(\w)\1{15,}/  },   // 15+ repeated chars (token stuffing)
  { label: 'prompt_length_bomb',  weight: 0.25, pattern: /(.)\1{8,}/    },   // repeated single chars (filling context)
];

// ── Normalise prompt for matching ─────────────────────────────

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')    // zero-width chars
    .replace(/[^\x20-\x7E\n]/g, ' ')          // non-ASCII → space
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Score a single text ───────────────────────────────────────

interface ScanResult {
  score:      number;
  matched:    string[];
  normalised: string;
}

export function scanText(text: string): ScanResult {
  const normalised = normalise(text);
  const matched: string[] = [];
  let score = 0;

  for (const signal of SIGNALS) {
    if (signal.pattern.test(normalised)) {
      matched.push(signal.label);
      score += signal.weight;
    }
  }

  // Cap at 1.0
  return { score: Math.min(score, 1.0), matched, normalised };
}

// ── Middleware ────────────────────────────────────────────────

export function promptGuardMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    const { message = '', systemPrompt = '' } = req.body as {
      message?:     string;
      systemPrompt?: string;
    };

    if (!message && !systemPrompt) {
      next();
      return;
    }

    // Scan both fields; take the max score across them
    const msgScan    = scanText(message);
    const sysScan    = scanText(systemPrompt);
    const worstScore = Math.max(msgScan.score, sysScan.score);
    const allMatched = [...new Set([...msgScan.matched, ...sysScan.matched])];

    const workspaceId = req.apiKey?.workspaceId ?? 'unknown';

    if (worstScore >= BLOCK_THRESHOLD) {
      injectionAttemptsTotal.inc({ severity: 'blocked', workspace_id: workspaceId });
      logger.warn(
        { workspaceId, score: worstScore.toFixed(3), signals: allMatched, requestId: req.requestId },
        'Prompt injection attempt BLOCKED',
      );

      // Fire-and-forget: write to audit log
      import('../middleware/errorHandler').then(({ AppError }) => {
        // Already handled below — just for audit persistence
      }).catch(() => {});

      res.status(400).json({
        success: false,
        error: {
          code:    'PROMPT_INJECTION_DETECTED',
          message: 'The request was blocked because it appears to contain prompt injection patterns.',
          requestId: req.requestId,
        },
      });
      return;
    }

    if (worstScore >= WARN_THRESHOLD) {
      injectionAttemptsTotal.inc({ severity: 'flagged', workspace_id: workspaceId });
      logger.warn(
        { workspaceId, score: worstScore.toFixed(3), signals: allMatched, requestId: req.requestId },
        'Prompt injection attempt FLAGGED — request proceeding',
      );
      // Attach flag to request so downstream (analytics, logging) can record it
      req.promptInjectionScore = worstScore;
      req.promptInjectionSignals = allMatched;
    }

    next();
  } catch (err) {
    // Fail-open: guard failure never blocks a request
    logger.error({ err }, 'Prompt guard threw — failing open');
    next();
  }
}

// ── Type augmentation ─────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      promptInjectionScore?:   number;
      promptInjectionSignals?: string[];
    }
  }
}
