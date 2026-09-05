import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Injects requestId and traceId into every request for full distributed tracing.
 * requestId: unique per HTTP request
 * traceId: can be forwarded from upstream for cross-service tracing
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = uuidv4();
  req.traceId = (req.headers['x-trace-id'] as string) || uuidv4();
  req.startTime = Date.now();

  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-Trace-ID', req.traceId);

  next();
}
