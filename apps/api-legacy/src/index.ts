// Load env first — will throw if required vars are missing
import './config/env';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from '@smartroute/database';
import { getRedis } from './config/redis';
import { registerRoutes } from './routes/index';
import { requestContextMiddleware } from './middleware/requestContext';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { metricsMiddleware } from './middleware/metrics';
import { startWorkers, scheduleRecurringJobs, shutdownWorkers } from './queues/index';

async function bootstrap(): Promise<void> {
  const app = express();

  // ===========================================================
  // Security & Global Middleware
  // ===========================================================
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false, // Allow Swagger UI
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(','),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Trace-ID',
        'Idempotency-Key',   // for POST /chat deduplication
      ],
      exposedHeaders: [
        'X-Request-ID',
        'X-Trace-ID',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'X-Idempotent-Replayed',
        'Retry-After',
      ],
    }),
  );

  app.use(compression());

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ===========================================================
  // Request Context (requestId + traceId on every request)
  // ===========================================================
  app.use(requestContextMiddleware);

  // ===========================================================
  // HTTP access logging (skip /health and /metrics)
  // ===========================================================
  app.use(
    pinoHttp({
      logger,
      quietReqLogger: true,
      customProps: (req) => ({
        requestId: (req as express.Request).requestId,
        traceId: (req as express.Request).traceId,
      }),
      autoLogging: {
        ignore: (req) => ['/health', '/health/live', '/health/ready', '/metrics'].includes(req.url ?? ''),
      },
    }),
  );

  // ===========================================================
  // Global rate limit (anti-abuse — per IP)
  // ===========================================================
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX_REQUESTS * 10, // generous global IP limit
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
    }),
  );

  // Prometheus HTTP metrics (duration + active connections)
  app.use(metricsMiddleware);

  // ===========================================================
  // Routes
  // ===========================================================
  registerRoutes(app);

  // ===========================================================
  // Error handlers (must be last)
  // ===========================================================
  app.use(notFoundHandler);
  app.use(errorHandler);

  // ===========================================================
  // Start server
  // ===========================================================
  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    logger.info(
      { port: env.API_PORT, host: env.API_HOST, env: env.NODE_ENV },
      '🚀 SmartRoute AI API server started',
    );
  });

  // ===========================================================
  // Start background workers
  // ===========================================================
  startWorkers();
  await scheduleRecurringJobs();

  // ===========================================================
  // Graceful shutdown
  // ===========================================================
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');

    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        await shutdownWorkers();
        await prisma.$disconnect();
        logger.info('Database disconnected');

        const redis = getRedis();
        await redis.quit();
        logger.info('Redis disconnected');
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
      }

      process.exit(0);
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled Promise rejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
