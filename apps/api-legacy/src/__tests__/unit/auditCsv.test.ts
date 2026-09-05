import { describe, it, expect } from 'vitest';
import { auditSlugColumns } from '../../lib/auditCsv';

describe('auditSlugColumns', () => {
  it('extracts previous and new slug from metadata', () => {
    expect(
      auditSlugColumns({ previousSlug: 'old-co', newSlug: 'new-co', name: 'ignored' }),
    ).toEqual({ previousSlug: 'old-co', newSlug: 'new-co' });
  });

  it('returns empty strings when metadata lacks slug fields', () => {
    expect(auditSlugColumns({ foo: 'bar' })).toEqual({ previousSlug: '', newSlug: '' });
    expect(auditSlugColumns(null)).toEqual({ previousSlug: '', newSlug: '' });
  });
});
