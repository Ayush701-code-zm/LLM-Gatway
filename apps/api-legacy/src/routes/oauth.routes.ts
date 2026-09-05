/**
 * Google OAuth routes.
 *
 * GET  /auth/oauth/google          — redirect to Google consent
 * GET  /auth/oauth/google/callback — handle callback, issue JWT
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { authService } from '../services/auth.service';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';

export const oauthRouter = Router();

oauthRouter.get('/google', (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!env.GOOGLE_CLIENT_ID || !env.OAUTH_REDIRECT_URI) {
      throw AppError.badRequest('Google OAuth is not configured');
    }

    const params = new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      redirect_uri:  env.OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope:         'openid email profile',
      access_type:   'offline',
      prompt:        'consent',
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  } catch (err) {
    next(err);
  }
});

const OAUTH_E2E_PREFIX = 'e2e-test-oauth:';

/** Test-only OAuth bypass for Playwright. Format: `e2e-test-oauth:email|Name` */
function parseE2eOAuthCode(code: string | undefined): { email: string; name: string } | null {
  if (process.env.OAUTH_E2E_BYPASS !== 'true' || !code?.startsWith(OAUTH_E2E_PREFIX)) {
    return null;
  }

  const payload = code.slice(OAUTH_E2E_PREFIX.length);
  const [email, name] = payload.split('|');
  if (!email?.includes('@')) {
    throw AppError.badRequest('E2E OAuth code requires a valid email');
  }

  return {
    email: email.toLowerCase().trim(),
    name: name?.trim() || email.split('@')[0],
  };
}

async function redirectOAuthResult(result: Awaited<ReturnType<typeof authService.loginOrRegisterOAuth>>, res: Response) {
  const redirectUrl = new URL(`${env.API_BASE_URL.replace(':3001', ':3000')}/oauth/callback`);

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

oauthRouter.get('/google/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string | undefined;
    const e2eUser = parseE2eOAuthCode(code);
    if (e2eUser) {
      const result = await authService.loginOrRegisterOAuth({
        email: e2eUser.email,
        name: e2eUser.name,
        provider: 'google',
        providerId: `e2e-${e2eUser.email}`,
      });
      await redirectOAuthResult(result, res);
      return;
    }

    if (!code) throw AppError.badRequest('Missing authorization code');

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.OAUTH_REDIRECT_URI) {
      throw AppError.badRequest('Google OAuth is not configured');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  env.OAUTH_REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      throw AppError.unauthorized('Google token exchange failed');
    }

    const tokens = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) throw AppError.unauthorized('Failed to fetch Google profile');

    const profile = (await profileRes.json()) as { id: string; email: string; name: string; picture?: string };

    const result = await authService.loginOrRegisterOAuth({
      email:     profile.email,
      name:      profile.name,
      avatarUrl: profile.picture,
      provider:  'google',
      providerId: profile.id,
    });

    await redirectOAuthResult(result, res);
  } catch (err) {
    logger.error({ err }, 'Google OAuth callback failed');
    next(err);
  }
});
