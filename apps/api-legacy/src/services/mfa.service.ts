import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { generateSecret, generateURI, verify } from 'otplib';
import { prisma } from '@smartroute/database';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import type { AuthTokens, AuthUser } from '@smartroute/shared';
import { authService } from './auth.service';

const MFA_ISSUER = 'SmartRoute AI';
const BACKUP_CODE_COUNT = 8;
const BCRYPT_ROUNDS = 12;

export type LoginResult =
  | { mfaRequired: true; mfaToken: string }
  | { user: AuthUser; tokens: AuthTokens; mfaRequired?: false };

export interface MfaSetupResult {
  otpauthUrl: string;
  secret: string;
}

function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  );
}

async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS)));
}

function issueMfaToken(userId: string, workspaceId: string, email: string): string {
  return jwt.sign(
    { sub: userId, workspaceId, email, purpose: 'mfa' },
    env.JWT_SECRET,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { expiresIn: '5m' as any },
  );
}

function verifyMfaToken(mfaToken: string): { userId: string; workspaceId: string; email: string } {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(mfaToken, env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    throw AppError.unauthorized('MFA session expired. Please sign in again.');
  }
  if (payload.purpose !== 'mfa' || !payload.sub || !payload.workspaceId) {
    throw AppError.unauthorized('Invalid MFA session');
  }
  return {
    userId: payload.sub,
    workspaceId: payload.workspaceId as string,
    email: payload.email as string,
  };
}

async function verifyTotpOrBackup(userId: string, code: string, consumeBackup = true): Promise<void> {
  const normalized = code.replace(/\s/g, '').toUpperCase();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { mfaSecretEncrypted: true, mfaBackupCodesHash: true },
  });

  if (user.mfaSecretEncrypted) {
    const secret = decryptSecret(user.mfaSecretEncrypted);
    const valid = await verify({ token: normalized, secret });
    if (valid) return;
  }

  const hashes = (user.mfaBackupCodesHash as string[] | null) ?? [];
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i])) {
      if (consumeBackup) {
        const remaining = hashes.filter((_, idx) => idx !== i);
        await prisma.user.update({
          where: { id: userId },
          data: {
            mfaBackupCodesHash: remaining.length
              ? (remaining as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });
      }
      return;
    }
  }

  throw AppError.unauthorized('Invalid authentication code');
}

export class MfaService {
  async getStatus(userId: string): Promise<{ enabled: boolean; backupCodesRemaining: number }> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabled: true, mfaBackupCodesHash: true },
    });
    const hashes = (user.mfaBackupCodesHash as string[] | null) ?? [];
    return { enabled: user.mfaEnabled, backupCodesRemaining: hashes.length };
  }

  async setup(userId: string): Promise<MfaSetupResult> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, mfaEnabled: true },
    });
    if (user.mfaEnabled) throw AppError.badRequest('MFA is already enabled');

    const secret = generateSecret();
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaSecretEncrypted: encryptSecret(secret),
        mfaEnabled: false,
        mfaBackupCodesHash: Prisma.DbNull,
      },
    });

    return {
      secret,
      otpauthUrl: generateURI({ issuer: MFA_ISSUER, label: user.email, secret }),
    };
  }

  async confirmSetup(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    await verifyTotpOrBackup(userId, code, false);

    const backupCodes = generateBackupCodes();
    const hashed = await hashBackupCodes(backupCodes);

    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaBackupCodesHash: hashed as Prisma.InputJsonValue },
    });

    return { backupCodes };
  }

  async disable(userId: string, password: string, code: string): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { hashedPassword: true, mfaEnabled: true },
    });
    if (!user.mfaEnabled) throw AppError.badRequest('MFA is not enabled');

    const valid = await bcrypt.compare(password, user.hashedPassword);
    if (!valid) throw AppError.unauthorized('Incorrect password');

    await verifyTotpOrBackup(userId, code);

    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        mfaBackupCodesHash: Prisma.DbNull,
      },
    });
  }

  async completeLogin(
    mfaToken: string,
    code: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const { userId, workspaceId, email } = verifyMfaToken(mfaToken);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabled: true, deletedAt: true },
    });
    if (!user.mfaEnabled || user.deletedAt) {
      throw AppError.unauthorized('Invalid MFA session');
    }

    await verifyTotpOrBackup(userId, code);

    return authService.finalizeLogin(userId, workspaceId, email, ipAddress, { mfa: true }, {
      ipAddress,
      userAgent,
    });
  }

  createMfaChallenge(userId: string, workspaceId: string, email: string): string {
    return issueMfaToken(userId, workspaceId, email);
  }
}

export const mfaService = new MfaService();
