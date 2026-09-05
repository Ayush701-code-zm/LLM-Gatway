import { Router } from 'express';
import type { Request, Response } from 'express';
import { register } from '../config/metrics';

export const metricsRouter = Router();

// Prometheus scrape endpoint — should be protected in production (e.g. behind internal network)
metricsRouter.get('/', async (_req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
