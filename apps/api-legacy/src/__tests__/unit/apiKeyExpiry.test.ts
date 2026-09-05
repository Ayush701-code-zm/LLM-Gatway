import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindMany = vi.fn();
const mockCreate = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisSetex = vi.fn();

vi.mock('@smartroute/database', () => ({
  prisma: {
    apiKey: { findMany: mockFindMany },
    notification: { create: mockCreate },
  },
}));

vi.mock('../../config/redis', () => ({
  getRedis: () => ({
    get: mockRedisGet,
    setex: mockRedisSetex,
  }),
}));

vi.mock('../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('notifyExpiringApiKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue('OK');
    mockCreate.mockResolvedValue({});
  });

  it('creates notifications for keys expiring within 7 days', async () => {
    const expiresAt = new Date(Date.now() + 3 * 86_400_000);
    mockFindMany.mockResolvedValue([
      {
        id: 'key-1',
        name: 'Prod key',
        keyPrefix: 'sk-abcd',
        expiresAt,
        workspaceId: 'ws-1',
      },
    ]);

    const { notifyExpiringApiKeys } = await import('../../lib/apiKeyExpiry');
    const created = await notifyExpiringApiKeys();

    expect(created).toBe(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          type: 'API_KEY_EXPIRING',
        }),
      }),
    );
    expect(mockRedisSetex).toHaveBeenCalledWith('apikey:expiry:notified:key-1', expect.any(Number), '1');
  });

  it('skips keys already notified (redis cooldown)', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'key-2',
        name: 'Dev key',
        keyPrefix: 'sk-efgh',
        expiresAt: new Date(Date.now() + 2 * 86_400_000),
        workspaceId: 'ws-1',
      },
    ]);
    mockRedisGet.mockResolvedValue('1');

    const { notifyExpiringApiKeys } = await import('../../lib/apiKeyExpiry');
    const created = await notifyExpiringApiKeys();

    expect(created).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
