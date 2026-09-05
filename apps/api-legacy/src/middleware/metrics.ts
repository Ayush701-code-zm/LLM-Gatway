/**
 * Prometheus metrics middleware.
 *
 * Measures HTTP request duration and records it by method/route/status.
 * Attach BEFORE route handlers so it covers the full request lifecycle.
 */

import type { Request, Response, NextFunction } from 'express';
import { httpRequestDuration, activeConnections } from '../config/metrics';

let connectionCount = 0;

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  connectionCount++;
  activeConnections.set(connectionCount);

  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    connectionCount = Math.max(0, connectionCount - 1);
    activeConnections.set(connectionCount);

    // Normalize route for label cardinality reduction
    // e.g. /api/v1/api-keys/abc123 → /api/v1/api-keys/:id
    const route = normalizeRoute(req.route?.path ?? req.path);

    end({
      method: req.method,
      route,
      status_code: res.statusCode.toString(),
    });
  });

  next();
}

const UUID_RE   = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_RE = /\/\d+/g;

function normalizeRoute(path: string): string {
  return path
    .replace(UUID_RE, ':id')
    .replace(NUMERIC_RE, '/:id')
    .replace(/\/$/,'')
    || '/';
}
