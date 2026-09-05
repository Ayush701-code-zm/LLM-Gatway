import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';
import type { ApiResponse } from '@smartroute/shared';
import { ERROR_CODES } from '@smartroute/shared';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, ERROR_CODES.INVALID_REQUEST, message, details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new AppError(401, ERROR_CODES.UNAUTHORIZED, message);
  }

  static forbidden(message = 'Forbidden') {
    return new AppError(403, ERROR_CODES.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found') {
    return new AppError(404, ERROR_CODES.NOT_FOUND, message);
  }

  static conflict(message: string) {
    return new AppError(409, ERROR_CODES.CONFLICT, message);
  }

  static rateLimitExceeded(retryAfterSeconds: number) {
    return new AppError(429, ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Rate limit exceeded', {
      retryAfter: retryAfterSeconds,
    });
  }

  static budgetExceeded(message = 'Monthly budget exceeded') {
    return new AppError(402, ERROR_CODES.BUDGET_EXCEEDED, message);
  }

  static providerError(message: string, details?: unknown) {
    return new AppError(502, ERROR_CODES.PROVIDER_ERROR, message, details);
  }

  static internal(message = 'Internal server error') {
    return new AppError(500, ERROR_CODES.INTERNAL_ERROR, message);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    logger.warn(
      { requestId: req.requestId, code: err.code, statusCode: err.statusCode, details: err.details },
      err.message,
    );

    const body: ApiResponse = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId: req.requestId,
      },
    };

    // Inject Retry-After for rate limit errors
    if (err.statusCode === 429 && err.details && typeof err.details === 'object') {
      const d = err.details as { retryAfter?: number };
      if (d.retryAfter) res.setHeader('Retry-After', d.retryAfter.toString());
    }

    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ApiResponse = {
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed',
        details: err.flatten().fieldErrors,
        requestId: req.requestId,
      },
    };
    res.status(400).json(body);
    return;
  }

  logger.error({ requestId: req.requestId, err }, 'Unhandled error');

  const body: ApiResponse = {
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      requestId: req.requestId,
    },
  };

  res.status(500).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: `Route ${req.method} ${req.path} not found`,
      requestId: req.requestId,
    },
  } satisfies ApiResponse);
}
