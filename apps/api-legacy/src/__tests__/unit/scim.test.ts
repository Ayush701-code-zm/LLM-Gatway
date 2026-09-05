import { describe, it, expect } from 'vitest';
import { generateScimToken } from '../../lib/scim';
import { createHash } from 'node:crypto';

describe('generateScimToken', () => {
  it('returns sr_scim_ prefixed token with matching hash', () => {
    const { raw, hash, prefix } = generateScimToken();
    expect(raw.startsWith('sr_scim_')).toBe(true);
    expect(prefix.endsWith('…')).toBe(true);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(hash);
  });
});
