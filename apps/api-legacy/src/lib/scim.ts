import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '@smartroute/database';
import { AppError } from '../middleware/errorHandler';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      scimWorkspaceId?: string;
    }
  }
}

/** Authenticates SCIM bearer token and attaches workspace id. */
export async function requireScimAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthorized('SCIM bearer token required');
    }

    const token = header.slice(7).trim();
    if (!token.startsWith('sr_scim_')) {
      throw AppError.unauthorized('Invalid SCIM token');
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const workspace = await prisma.workspace.findFirst({
      where: {
        scimEnabled: true,
        scimTokenHash: tokenHash,
        deletedAt: null,
        plan: 'ENTERPRISE',
      },
      select: { id: true },
    });

    if (!workspace) throw AppError.unauthorized('Invalid SCIM token');

    req.scimWorkspaceId = workspace.id;
    next();
  } catch (err) {
    next(err);
  }
}

export function generateScimToken(): { raw: string; hash: string; prefix: string } {
  const raw = `sr_scim_${randomBytes(24).toString('hex')}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = `${raw.slice(0, 20)}…`;
  return { raw, hash, prefix };
}

export interface ScimConfigResponse {
  enabled: boolean;
  tokenPrefix: string | null;
  baseUrl: string;
  hasToken: boolean;
}

export function toScimUser(member: {
  user: { id: string; email: string; name: string; deletedAt: Date | null };
  role: string;
}) {
  const active = !member.user.deletedAt;
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: member.user.id,
    userName: member.user.email,
    name: { formatted: member.user.name },
    emails: [{ value: member.user.email, primary: true }],
    active,
    meta: { resourceType: 'User' },
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
      role: member.role,
    },
  };
}
