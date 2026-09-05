import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { LoginSchema, RegisterSchema } from '@smartroute/shared';
import { authService } from '../services/auth.service';
import { z } from 'zod';

export const authRouter = Router();

authRouter.post(
  '/register',
  validate(RegisterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.register(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/login',
  validate(LoginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
      const result = await authService.login(req.body, req.ip, userAgent);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string() })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tokens = await authService.refreshTokens(req.body.refreshToken);
      res.status(200).json({ success: true, data: tokens });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/logout',
  validate(z.object({ refreshToken: z.string() })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.logout(req.body.refreshToken);
      res.status(200).json({ success: true, data: { message: 'Logged out successfully' } });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.getAuthUser(req.user!.sub);
    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

authRouter.patch(
  '/me',
  requireAuth,
  validate(z.object({ name: z.string().min(2).max(100) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await authService.updateProfile(req.user!.sub, req.body.name);
      res.status(200).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/change-password',
  requireAuth,
  validate(
    z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(128),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.changePassword(
        req.user!.sub,
        req.body.currentPassword,
        req.body.newPassword,
      );
      res.status(200).json({
        success: true,
        data: { message: 'Password updated. Please sign in again on other devices.' },
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/forgot-password',
  validate(z.object({ email: z.string().email() })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.requestPasswordReset(req.body.email);
      res.status(200).json({
        success: true,
        data: { message: 'If that email exists, a reset link has been sent.' },
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/reset-password',
  validate(
    z.object({
      token: z.string().min(1),
      password: z.string().min(8).max(128),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.resetPassword(req.body.token, req.body.password);
      res.status(200).json({
        success: true,
        data: { message: 'Password updated. Please sign in again.' },
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/switch-workspace',
  requireAuth,
  validate(z.object({ workspaceId: z.string().uuid() })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.switchWorkspace(req.user!.sub, req.body.workspaceId);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/verify-email',
  validate(z.object({ token: z.string().min(1) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.verifyEmail(req.body.token);
      res.status(200).json({
        success: true,
        data: { message: 'Email verified successfully.' },
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/resend-verification',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.sendVerificationEmail(req.user!.sub);
      res.status(200).json({
        success: true,
        data: { message: 'If your email is unverified, a new link has been sent.' },
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get('/mfa/status', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mfaService } = await import('../services/mfa.service');
    const status = await mfaService.getStatus(req.user!.sub);
    res.status(200).json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/mfa/setup', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mfaService } = await import('../services/mfa.service');
    const setup = await mfaService.setup(req.user!.sub);
    res.status(200).json({ success: true, data: setup });
  } catch (err) {
    next(err);
  }
});

authRouter.post(
  '/mfa/confirm',
  requireAuth,
  validate(z.object({ code: z.string().min(6).max(16) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { mfaService } = await import('../services/mfa.service');
      const result = await mfaService.confirmSetup(req.user!.sub, req.body.code);
      const user = await authService.getAuthUser(req.user!.sub);
      res.status(200).json({ success: true, data: { ...result, user } });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/mfa/disable',
  requireAuth,
  validate(
    z.object({
      password: z.string().min(1),
      code: z.string().min(6).max(16),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { mfaService } = await import('../services/mfa.service');
      await mfaService.disable(req.user!.sub, req.body.password, req.body.code);
      const user = await authService.getAuthUser(req.user!.sub);
      res.status(200).json({ success: true, data: { user } });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/mfa/verify-login',
  validate(
    z.object({
      mfaToken: z.string().min(1),
      code: z.string().min(6).max(16),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
      const { mfaService } = await import('../services/mfa.service');
      const result = await mfaService.completeLogin(req.body.mfaToken, req.body.code, req.ip, userAgent);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get('/sessions', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessions = await authService.listSessions(req.user!.sub);
    res.status(200).json({ success: true, data: sessions });
  } catch (err) {
    next(err);
  }
});

authRouter.delete('/sessions/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await authService.revokeSession(req.user!.sub, String(req.params.id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.post(
  '/sessions/revoke-others',
  requireAuth,
  validate(z.object({ refreshToken: z.string().min(1) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await authService.revokeOtherSessions(req.user!.sub, req.body.refreshToken);
      res.status(200).json({ success: true, data: { revokedCount: count } });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get('/me/export', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await authService.exportUserData(req.user!.sub);
    const filename = `smartroute-user-${req.user!.sub.slice(0, 8)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    next(err);
  }
});

authRouter.delete(
  '/me',
  requireAuth,
  validate(z.object({ password: z.string().min(1) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.deleteAccount(req.user!.sub, req.body.password);
      res.status(200).json({
        success: true,
        data: { message: 'Account deleted successfully' },
      });
    } catch (err) {
      next(err);
    }
  },
);
