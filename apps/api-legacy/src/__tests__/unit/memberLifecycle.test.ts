import { describe, it, expect } from 'vitest';
import { assertOwnerCanLeave } from '../../lib/memberLifecycle';
import { AppError } from '../../middleware/errorHandler';

describe('assertOwnerCanLeave', () => {
  it('allows leave when sole owner', () => {
    expect(() => assertOwnerCanLeave(0, 'Acme')).not.toThrow();
  });

  it('blocks leave when other members exist', () => {
    expect(() => assertOwnerCanLeave(2, 'Acme')).toThrow(AppError);
    try {
      assertOwnerCanLeave(1, 'Acme');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).message).toContain('Transfer ownership');
    }
  });
});
