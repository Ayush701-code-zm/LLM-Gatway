import type { ZodError } from 'zod';

/** Returns the first human-readable message from a Zod validation error. */
export function firstZodErrorMessage(error: ZodError): string {
  return error.issues[0]?.message ?? 'Validation failed';
}

/** Extracts the first field error string from API error details. */
export function firstFieldErrorMessage(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  for (const messages of Object.values(details as Record<string, string[]>)) {
    if (Array.isArray(messages) && messages[0]) return messages[0];
  }
  return null;
}
