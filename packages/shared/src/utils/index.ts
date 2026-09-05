import { randomBytes } from 'crypto';

export function generateRequestId(): string {
  return randomBytes(16).toString('hex');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function calculateExponentialBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor = 0.2,
): number {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  const jitter = exponential * jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(exponential + jitter));
}

export function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputCostPerMillion: number,
  outputCostPerMillion: number,
): number {
  return (inputTokens / 1_000_000) * inputCostPerMillion +
    (outputTokens / 1_000_000) * outputCostPerMillion;
}

export function calculateSavingsPercent(baseline: number, actual: number): number {
  if (baseline <= 0) return 0;
  return Math.round(((baseline - actual) / baseline) * 100 * 100) / 100;
}

export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

export function isRetryableStatusCode(statusCode: number): boolean {
  return [429, 500, 502, 503, 504].includes(statusCode);
}

export function maskApiKey(key: string): string {
  if (key.length < 8) return '****';
  return key.substring(0, 8) + '****' + key.substring(key.length - 4);
}
