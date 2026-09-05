import { Router } from 'express';
import { requireApiKey } from '../middleware/auth';
import { requireScope } from '../middleware/apiKeyScope';
import { backpressureMiddleware } from '../middleware/backpressure';
import { outputRedactionMiddleware } from '../middleware/outputRedaction';
import { validate } from '../middleware/validate';
import { ChatRequestSchema } from '@smartroute/shared';
import { gatewayService } from '../services/gateway.service';
import { rateLimitHeadersMiddleware } from '../middleware/rateLimitHeaders';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { promptGuardMiddleware } from '../middleware/promptGuard';
import type { Request, Response, NextFunction } from 'express';

export const chatRouter = Router();

/**
 * Non-streaming chat completion.
 * POST /api/v1/chat
 */
chatRouter.post(
  '/',
  requireApiKey,
  requireScope('chat:write'),
  backpressureMiddleware,
  rateLimitHeadersMiddleware,
  idempotencyMiddleware,
  promptGuardMiddleware,
  outputRedactionMiddleware,
  validate(ChatRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await gatewayService.processChat(req.body, {
        requestId:    req.requestId,
        traceId:      req.traceId,
        apiKey:       req.apiKey!,
        onRateLimit:  (info) => { req.rateLimitInfo = info; },
      });

      res.status(200).json({ success: true, data: response });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Server-Sent Events streaming chat.
 * POST /api/v1/chat/stream
 */
chatRouter.post(
  '/stream',
  requireApiKey,
  requireScope('chat:write'),
  backpressureMiddleware,
  rateLimitHeadersMiddleware,
  idempotencyMiddleware,
  promptGuardMiddleware,
  validate(ChatRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Request-ID', req.requestId);
    res.setHeader('X-Trace-ID', req.traceId);
    res.flushHeaders();

    function send(data: object) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    function sendError(message: string, code = 'STREAM_ERROR') {
      send({ type: 'error', code, message });
      res.end();
    }

    try {
      const done = await gatewayService.processChatStream(
        req.body,
        {
          requestId:   req.requestId,
          traceId:     req.traceId,
          apiKey:      req.apiKey!,
          onRateLimit: (info) => { req.rateLimitInfo = info; },
        },
        {
          onRouting: (routing) => send({ type: 'routing', ...routing }),
          onDelta:   (content) => send({ type: 'delta', content }),
        },
      );

      send({ type: 'done', ...done });
      res.end();
    } catch (err) {
      if (res.headersSent) {
        sendError((err as Error).message);
      } else {
        next(err);
      }
    }
  },
);
