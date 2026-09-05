/** Extracts slug-change fields from audit log metadata for CSV export. */
export function auditSlugColumns(metadata: unknown): { previousSlug: string; newSlug: string } {
  if (!metadata || typeof metadata !== 'object') {
    return { previousSlug: '', newSlug: '' };
  }
  const m = metadata as Record<string, unknown>;
  return {
    previousSlug: typeof m.previousSlug === 'string' ? m.previousSlug : '',
    newSlug: typeof m.newSlug === 'string' ? m.newSlug : '',
  };
}
