import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireScope, requireAnyScope } from '../../middleware/apiKeyScope';

function runMiddleware(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  scopes: string[] | undefined,
) {
  const req = { apiKey: scopes ? { scopes } : undefined } as Request;
  const next = vi.fn();
  middleware(req, {} as Response, next);
  return next;
}

describe('API key scope middleware', () => {
  it('requireScope passes when all scopes are present', () => {
    const next = runMiddleware(requireScope('chat:write'), ['chat:write', 'analytics:read']);
    expect(next).toHaveBeenCalledWith();
  });

  it('requireScope rejects missing scopes', () => {
    const next = runMiddleware(requireScope('chat:write', 'analytics:read'), ['chat:write']);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('requireAnyScope passes with one matching scope', () => {
    const next = runMiddleware(
      requireAnyScope('embeddings:write', 'chat:write'),
      ['chat:write'],
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('requireAnyScope rejects when no scopes match', () => {
    const next = runMiddleware(
      requireAnyScope('embeddings:write', 'chat:write'),
      ['analytics:read'],
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
