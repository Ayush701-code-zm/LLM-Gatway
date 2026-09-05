import IORedis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

let redisClient: IORedis | null = null;

export function getRedis(): IORedis {
  if (redisClient) return redisClient;

  redisClient = new IORedis(env.REDIS_URL, {
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      logger.warn({ attempt: times }, `Redis reconnecting in ${delay}ms`);
      return delay;
    },
    reconnectOnError(err) {
      return err.message.includes('READONLY');
    },
  });

  redisClient.on('connect', () => logger.info('Redis connected'));
  redisClient.on('error', (err) => logger.error({ err }, 'Redis error'));
  redisClient.on('close', () => logger.warn('Redis connection closed'));

  return redisClient;
}

/**
 * BullMQ uses its own bundled ioredis internally.
 * Pass connection options as a plain object — BullMQ will instantiate its own client.
 * Do NOT pass an ioredis instance across the version boundary.
 */
export function getBullMQConnectionOptions() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: env.REDIS_PASSWORD || url.password || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  };
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
