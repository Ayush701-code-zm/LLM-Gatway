/**
 * Enterprise SSO routes + SAML auth endpoints.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@smartroute/database';
import { requireAuth } from '../middleware/auth';
import { loadWorkspaceRole, canAdmin } from '../middleware/workspaceRole';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { getAuthWorkspaceId } from '../lib/workspaceContext';
import { buildSsoConfig, buildSpMetadataXml, fetchIdpMetadata } from '../lib/sso';
import { createSamlLoginRedirect, validateSamlResponse } from '../services/saml.service';
import { authService } from '../services/auth.service';
import { env } from '../config/env';
import { logger } from '../config/logger';

export const ssoRouter = Router();

const workspaceSsoSelect = {
  id: true,
  slug: true,
  name: true,
  plan: true,
  ssoEnabled: true,
  ssoMetadataUrl: true,
  ssoEntityId: true,
  ssoIdpSsoUrl: true,
  ssoIdpCertPem: true,
} as const;

const PatchSsoSchema = z.object({
  enabled:     z.boolean().optional(),
  metadataUrl: z.string().url().nullable().optional(),
  entityId:    z.string().min(1).max(512).nullable().optional(),
});

async function requireEnterpriseWorkspace(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: workspaceSsoSelect,
  });
  if (!ws) throw AppError.notFound('Workspace not found');
  if (ws.plan !== 'ENTERPRISE') {
    throw AppError.forbidden('SSO is available on the Enterprise plan only');
  }
  return ws;
}

async function loadWorkspaceBySlug(slug: string) {
  return prisma.workspace.findUnique({
    where: { slug },
    select: workspaceSsoSelect,
  });
}

function redirectToWeb(result: Awaited<ReturnType<typeof authService.loginOrRegisterSaml>>, res: Response) {
  const redirectUrl = new URL(`${env.API_BASE_URL.replace(':3001', ':3000')}/saml/callback`);

  if ('mfaRequired' in result && result.mfaRequired) {
    redirectUrl.searchParams.set('mfaToken', result.mfaToken);
    res.redirect(redirectUrl.toString());
    return;
  }

  if ('tokens' in result && result.tokens) {
    redirectUrl.searchParams.set('accessToken', result.tokens.accessToken);
    redirectUrl.searchParams.set('refreshToken', result.tokens.refreshToken);
  }

  res.redirect(redirectUrl.toString());
}

// ── Workspace SSO config (dashboard) ──────────────────────────

ssoRouter.get(
  '/current/sso',
  requireAuth,
  loadWorkspaceRole,
  canAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ws = await requireEnterpriseWorkspace(getAuthWorkspaceId(req));
      res.status(200).json({ success: true, data: buildSsoConfig(ws) });
    } catch (err) {
      next(err);
    }
  },
);

ssoRouter.patch(
  '/current/sso',
  requireAuth,
  loadWorkspaceRole,
  canAdmin,
  validate(PatchSsoSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getAuthWorkspaceId(req);
      await requireEnterpriseWorkspace(workspaceId);

      const { enabled, metadataUrl, entityId } = req.body as z.infer<typeof PatchSsoSchema>;

      let idpUpdate: { ssoIdpSsoUrl?: string | null; ssoIdpCertPem?: string | null } = {};

      if (metadataUrl !== undefined) {
        if (metadataUrl === null) {
          idpUpdate = { ssoIdpSsoUrl: null, ssoIdpCertPem: null };
        } else {
          try {
            const parsed = await fetchIdpMetadata(metadataUrl);
            idpUpdate = { ssoIdpSsoUrl: parsed.entryPoint, ssoIdpCertPem: parsed.certPem };
          } catch (err) {
            throw AppError.badRequest(
              err instanceof Error ? err.message : 'Failed to parse IdP metadata',
            );
          }
        }
      }

      const updated = await prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          ...(enabled !== undefined ? { ssoEnabled: enabled } : {}),
          ...(metadataUrl !== undefined ? { ssoMetadataUrl: metadataUrl } : {}),
          ...(entityId !== undefined ? { ssoEntityId: entityId } : {}),
          ...idpUpdate,
        },
        select: workspaceSsoSelect,
      });

      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId: req.user!.sub,
          action: 'SETTINGS_UPDATED',
          resourceType: 'sso',
          metadata: { enabled: updated.ssoEnabled, idpConfigured: Boolean(updated.ssoIdpSsoUrl) },
        },
      });

      res.status(200).json({ success: true, data: buildSsoConfig(updated) });
    } catch (err) {
      next(err);
    }
  },
);

// ── Public SAML endpoints ─────────────────────────────────────

export const samlAuthRouter = Router();

samlAuthRouter.get('/discover', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.query.workspace as string | undefined;
    if (!slug) throw AppError.badRequest('workspace query parameter is required');

    const ws = await loadWorkspaceBySlug(slug);
    if (!ws || ws.plan !== 'ENTERPRISE') {
      res.status(200).json({ success: true, data: { enabled: false } });
      return;
    }

    const config = buildSsoConfig(ws);
    res.status(200).json({
      success: true,
      data: {
        enabled: config.enabled && config.implemented,
        workspaceName: ws.name,
        loginUrl: config.loginUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

samlAuthRouter.get('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.query.workspace as string | undefined;
    if (!slug) throw AppError.badRequest('workspace query parameter is required');

    const ws = await loadWorkspaceBySlug(slug);
    if (!ws || ws.plan !== 'ENTERPRISE' || !ws.ssoEnabled) {
      throw AppError.notFound('SSO is not enabled for this workspace');
    }

    const redirectUrl = await createSamlLoginRedirect(ws);
    res.redirect(redirectUrl);
  } catch (err) {
    next(err);
  }
});

samlAuthRouter.post('/acs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.query.workspace as string | undefined;
    if (!slug) throw AppError.badRequest('workspace query parameter is required');

    const ws = await loadWorkspaceBySlug(slug);
    if (!ws || ws.plan !== 'ENTERPRISE' || !ws.ssoEnabled) {
      throw AppError.notFound('SSO is not enabled for this workspace');
    }

    const body = req.body as Record<string, string>;
    const { email, name } = await validateSamlResponse(ws, body);

    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
    const result = await authService.loginOrRegisterSaml({
      email,
      name,
      workspaceId: ws.id,
      ipAddress: req.ip,
      userAgent,
    });

    redirectToWeb(result, res);
  } catch (err) {
    logger.error({ err }, 'SAML ACS failed');
    next(err);
  }
});

samlAuthRouter.get('/metadata', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.query.workspace as string | undefined;
    if (!slug) throw AppError.badRequest('workspace query parameter is required');

    const ws = await loadWorkspaceBySlug(slug);
    if (!ws || ws.plan !== 'ENTERPRISE') {
      throw AppError.notFound('SSO metadata not available');
    }

    const config = buildSsoConfig(ws);
    res.setHeader('Content-Type', 'application/xml');
    res.send(buildSpMetadataXml(config));
  } catch (err) {
    next(err);
  }
});
