/**
 * Rate-limit header middleware.
 *
 * Attaches standard X-RateLimit-* and Retry-After headers to every
 * response that goes through an API-key-authenticated route (chat, etc.).
 *
 * The RateLimiterEngine stores the current window info on the request object
 * (via `req.rateLimitInfo`) so this middleware can pick it up in `res.on('finish')`.
 *
 * Standard headers: https://www.ietf.org/archive/id/draft-polli-ratelimit-headers-02.txt
 */

import type { Request, Response, NextFunction } from 'express';
import type { RateLimitInfo } from '../engines/rateLimiter';

declare global {
  namespace Express {
    interface Request {
      rateLimitInfo?: RateLimitInfo;
    }
  }
}

export function rateLimitHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.on('finish', () => {
    const info = req.rateLimitInfo;
    if (!info) return;

    // Use the more restrictive of RPM vs RPD for the primary header set
    const limitHeader     = Math.min(info.limitRpm, info.limitRpd);
    const remainingHeader = Math.min(info.remainingRpm, info.remainingRpd);
    const resetHeader     = info.remainingRpm <= info.remainingRpd
      ? info.resetRpm
      : info.resetRpd;

    res.setHeader('X-RateLimit-Limit',     limitHeader.toString());
    res.setHeader('X-RateLimit-Remaining', remainingHeader.toString());
    res.setHeader('X-RateLimit-Reset',     resetHeader.toString());
    res.setHeader('X-RateLimit-Limit-RPM', info.limitRpm.toString());
    res.setHeader('X-RateLimit-Limit-RPD', info.limitRpd.toString());
    res.setHeader('X-RateLimit-Used-RPM',  info.usedRpm.toString());
    res.setHeader('X-RateLimit-Used-RPD',  info.usedRpd.toString());
  });

  next();
}
