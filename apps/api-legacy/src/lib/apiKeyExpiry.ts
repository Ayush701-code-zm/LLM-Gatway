import { prisma } from '@smartroute/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';

const NOTIFY_COOLDOWN_SEC = 7 * 24 * 60 * 60;

/** Creates dashboard notifications for API keys expiring within 7 days. */
export async function notifyExpiringApiKeys(): Promise<number> {
  const redis = getRedis();
  const now = new Date();
  const in7days = new Date(Date.now() + 7 * 86_400_000);

  const keys = await prisma.apiKey.findMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { not: null, gt: now, lte: in7days },
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      expiresAt: true,
      workspaceId: true,
    },
  });

  let created = 0;

  for (const key of keys) {
    const cooldownKey = `apikey:expiry:notified:${key.id}`;
    const already = await redis.get(cooldownKey);
    if (already) continue;

    await prisma.notification.create({
      data: {
        workspaceId: key.workspaceId,
        type: 'API_KEY_EXPIRING',
        title: `API key "${key.name}" expiring soon`,
        body: `${key.keyPrefix}… expires on ${key.expiresAt!.toISOString().slice(0, 10)}. Rotate or extend it in API Keys.`,
        metadata: { apiKeyId: key.id, expiresAt: key.expiresAt!.toISOString() },
      },
    });

    await redis.setex(cooldownKey, NOTIFY_COOLDOWN_SEC, '1');
    created += 1;
  }

  if (created > 0) {
    logger.info({ created }, 'API key expiry notifications created');
  }

  return created;
}
