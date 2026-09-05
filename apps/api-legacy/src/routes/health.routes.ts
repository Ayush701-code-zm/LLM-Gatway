import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '@smartroute/database';
import { getRedis } from '../config/redis';
import { env } from '../config/env';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // Database
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'healthy', latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks.database = { status: 'unhealthy', error: (err as Error).message };
  }

  // Redis
  const redisStart = Date.now();
  try {
    await getRedis().ping();
    checks.redis = { status: 'healthy', latencyMs: Date.now() - redisStart };
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: (err as Error).message };
  }

  const allHealthy = Object.values(checks).every((c) => c.status === 'healthy');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    version: env.APP_VERSION,
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    checks,
  });
});

healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

healthRouter.get('/ready', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not ready', reason: 'database unavailable' });
  }
});
