import type { Application } from 'express';
import { chatRouter } from './chat.routes';
import { authRouter } from './auth.routes';
import { oauthRouter } from './oauth.routes';
import { apiKeyRouter } from './apiKey.routes';
import { workspaceRouter } from './workspace.routes';
import { memberRouter } from './member.routes';
import { analyticsRouter } from './analytics.routes';
import { healthRouter } from './health.routes';
import { metricsRouter } from './metrics.routes';
import { docsRouter } from './docs.routes';
import { modelsRouter } from './models.routes';
import { webhookRouter } from './webhook.routes';
import { notificationRouter } from './notification.routes';
import { embeddingsRouter } from './embeddings.routes';
import { billingRouter, handleStripeWebhook } from './billing.routes';
import { adminRouter } from './admin.routes';
import { systemRouter } from './system.routes';
import { ssoRouter, samlAuthRouter } from './sso.routes';
import { scimWorkspaceRouter, scimRouter } from './scim.routes';
import { API_PREFIX } from '@smartroute/shared';
import express from 'express';

export function registerRoutes(app: Application): void {
  app.use(`${API_PREFIX}/chat`, chatRouter);
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/auth/oauth`, oauthRouter);
  app.use(`${API_PREFIX}/api-keys`, apiKeyRouter);
  app.use(`${API_PREFIX}/workspaces`, workspaceRouter);
  app.use(`${API_PREFIX}/workspaces`, memberRouter);
  app.use(`${API_PREFIX}/workspaces`, ssoRouter);
  app.use(`${API_PREFIX}/workspaces`, scimWorkspaceRouter);
  app.use(`${API_PREFIX}/auth/saml`, samlAuthRouter);
  app.use('/scim/v2', scimRouter);
  app.use(`${API_PREFIX}/analytics`, analyticsRouter);
  app.use(`${API_PREFIX}/models`, modelsRouter);
  app.use(`${API_PREFIX}/webhooks`, webhookRouter);
  app.use(`${API_PREFIX}/notifications`, notificationRouter);
  app.use(`${API_PREFIX}/embeddings`, embeddingsRouter);
  app.use(`${API_PREFIX}/billing`, billingRouter);
  app.use(`${API_PREFIX}/admin`, adminRouter);
  app.use(`${API_PREFIX}/system`, systemRouter);

  // Stripe webhook needs raw body
  app.post(
    `${API_PREFIX}/billing/webhook`,
    express.raw({ type: 'application/json' }),
    handleStripeWebhook,
  );
  app.use('/health', healthRouter);
  app.use('/metrics', metricsRouter);
  app.use('/docs', docsRouter);
}
