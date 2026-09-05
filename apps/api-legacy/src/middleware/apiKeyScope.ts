import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

/** Enforces that the API key includes all required scope(s). */
export function requireScope(...scopes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const keyScopes = req.apiKey?.scopes ?? [];
    const missing = scopes.filter((s) => !keyScopes.includes(s));
    if (missing.length > 0) {
      return next(
        AppError.forbidden(`API key missing required scope(s): ${missing.join(', ')}`),
      );
    }
    next();
  };
}

/** Enforces that the API key includes at least one of the required scopes. */
export function requireAnyScope(...scopes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const keyScopes = req.apiKey?.scopes ?? [];
    if (!scopes.some((s) => keyScopes.includes(s))) {
      return next(
        AppError.forbidden(`API key missing required scope (need one of): ${scopes.join(', ')}`),
      );
    }
    next();
  };
}
