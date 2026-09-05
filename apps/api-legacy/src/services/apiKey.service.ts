import { randomBytes, createHash } from 'crypto';
import { prisma } from '@smartroute/database';
import { AppError } from '../middleware/errorHandler';
import { maskApiKey } from '@smartroute/shared';
import type { CreateApiKeyRequest } from '@smartroute/shared';

import { enforceApiKeyLimit } from '../lib/planEnforcement';

function serializeApiKey<T extends { requestCount?: bigint }>(key: T) {
  return {
    ...key,
    ...(key.requestCount !== undefined
      ? { requestCount: key.requestCount.toString() }
      : {}),
  };
}

export class ApiKeyService {
  async create(workspaceId: string, userId: string, data: CreateApiKeyRequest) {
    await enforceApiKeyLimit(workspaceId);
    const raw = `sk-${randomBytes(32).toString('base64url')}`;
    const keyHash = createHash('sha256').update(raw).digest('hex');
    const keyPrefix = raw.substring(0, 14);

    const apiKey = await prisma.apiKey.create({
      data: {
        workspaceId,
        createdById: userId,
        name: data.name,
        keyHash,
        keyPrefix,
        scopes: data.scopes,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        rateLimitRpm: data.rateLimitRpm,
        rateLimitTpm: data.rateLimitTpm,
      },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId,
        action: 'API_KEY_CREATED',
        resourceType: 'api_key',
        resourceId: apiKey.id,
        metadata: { name: data.name },
      },
    });

    // Return the raw key ONLY on creation — never stored in plain text
    return { ...serializeApiKey(apiKey), rawKey: raw };
  }

  async list(workspaceId: string) {
    const keys = await prisma.apiKey.findMany({
      where: { workspaceId, status: { not: 'REVOKED' } },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        status: true,
        scopes: true,
        expiresAt: true,
        lastUsedAt: true,
        requestCount: true,
        createdAt: true,
        createdBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return keys.map((k: typeof keys[number]) =>
      serializeApiKey({
        ...k,
        maskedKey: maskApiKey(k.keyPrefix + '****'),
      }),
    );
  }

  async revoke(workspaceId: string, keyId: string, userId: string): Promise<void> {
    const key = await prisma.apiKey.findFirst({
      where: { id: keyId, workspaceId },
    });

    if (!key) throw AppError.notFound('API key not found');
    if (key.status === 'REVOKED') throw AppError.conflict('API key already revoked');

    await prisma.apiKey.update({
      where: { id: keyId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: userId },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId,
        action: 'API_KEY_REVOKED',
        resourceType: 'api_key',
        resourceId: keyId,
      },
    });
  }

  async rotate(workspaceId: string, keyId: string, userId: string) {
    const existing = await prisma.apiKey.findFirst({
      where: { id: keyId, workspaceId, status: 'ACTIVE' },
    });

    if (!existing) throw AppError.notFound('Active API key not found');

    // Revoke old
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: userId },
    });

    // Create new with same config
    const newKey = await this.create(workspaceId, userId, {
      name: existing.name + ' (rotated)',
      scopes: existing.scopes,
      expiresAt: existing.expiresAt?.toISOString(),
      rateLimitRpm: existing.rateLimitRpm ?? undefined,
      rateLimitTpm: existing.rateLimitTpm ?? undefined,
    });

    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId,
        action: 'API_KEY_ROTATED',
        resourceType: 'api_key',
        resourceId: keyId,
        metadata: { newKeyId: newKey.id },
      },
    });

    return newKey;
  }
}

export const apiKeyService = new ApiKeyService();
