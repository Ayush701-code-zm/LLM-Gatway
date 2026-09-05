import { Router } from 'express';
import type { Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '../config/swagger';

export const docsRouter = Router();

// Serve Swagger UI at /docs
docsRouter.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: `
      .swagger-ui .topbar { background: #0f172a; }
      .swagger-ui .topbar-wrapper img { content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2'%3E%3Cpolygon points='13 2 3 14 12 14 11 22 21 10 12 10 13 2'/%3E%3C/svg%3E"); width: 24px; height: 24px; }
      .swagger-ui .topbar-wrapper:after { content: "SmartRoute AI"; color: white; font-weight: 700; margin-left: 8px; font-size: 16px; }
      body { background: #0f172a; }
      .swagger-ui { background: #0f172a; }
      .swagger-ui .info .title { color: white; }
    `,
    customSiteTitle: 'SmartRoute AI — API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
  }),
);

// Serve raw OpenAPI spec as JSON
docsRouter.get('/openapi.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(swaggerSpec);
});
