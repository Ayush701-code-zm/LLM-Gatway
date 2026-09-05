/**
 * Output Redaction Middleware
 *
 * Scrubs common secret patterns from LLM responses before they reach the client.
 * Applied as a post-processing step on chat responses (non-streaming JSON path).
 */

import type { Request, Response, NextFunction } from 'express';

const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  { label: 'openai_key',    pattern: /\bsk-[a-zA-Z0-9]{20,}\b/g,                    replacement: '[REDACTED_OPENAI_KEY]' },
  { label: 'anthropic_key', pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,              replacement: '[REDACTED_ANTHROPIC_KEY]' },
  { label: 'bearer_token',  pattern: /\bBearer\s+[a-zA-Z0-9._-]{20,}\b/gi,          replacement: 'Bearer [REDACTED]' },
  { label: 'aws_key',       pattern: /\bAKIA[0-9A-Z]{16}\b/g,                        replacement: '[REDACTED_AWS_KEY]' },
  { label: 'jwt',           pattern: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, replacement: '[REDACTED_JWT]' },
  { label: 'email',         pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  { label: 'credit_card',   pattern: /\b(?:\d[ -]*?){13,16}\b/g,                    replacement: '[REDACTED_CARD]' },
];

export function redactOutput(text: string): { text: string; redacted: string[] } {
  let result = text;
  const redacted: string[] = [];

  for (const { pattern, replacement, label } of REDACTION_PATTERNS) {
    if (pattern.test(result)) {
      redacted.push(label);
      result = result.replace(pattern, replacement);
      pattern.lastIndex = 0;
    }
  }

  return { text: result, redacted };
}

/** Wraps res.json to redact chat response message field. */
export function outputRedactionMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).json = function patchedJson(body: unknown) {
    if (
      body &&
      typeof body === 'object' &&
      'data' in body &&
      body.data &&
      typeof body.data === 'object' &&
      'message' in body.data &&
      typeof (body.data as { message: unknown }).message === 'string'
    ) {
      const data = body.data as { message: string; redactionApplied?: boolean; redactionLabels?: string[] };
      const { text, redacted } = redactOutput(data.message);
      if (redacted.length > 0) {
        data.message = text;
        data.redactionApplied = true;
        data.redactionLabels = redacted;
      }
    }
    return originalJson(body);
  };

  next();
}
