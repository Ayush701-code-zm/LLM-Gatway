import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@smartroute/database', () => ({
  prisma: {
    workspace: { findMany: vi.fn() },
    request: {
      aggregate: vi.fn(),
      count: vi.fn(),
    },
    notification: { create: vi.fn() },
  },
}));

vi.mock('../../config/redis', () => ({
  getRedis: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
  })),
}));

vi.mock('../../queues/index', () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue([]),
}));

import { prisma } from '@smartroute/database';
import { AnomalyDetectorEngine } from '../../engines/anomalyDetector';

describe('AnomalyDetectorEngine', () => {
  const engine = new AnomalyDetectorEngine();
  const workspaceId = 'ws-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyseWorkspace()', () => {
    it('returns early when no recent traffic', async () => {
      vi.mocked(prisma.request.aggregate).mockResolvedValue({
        _avg: { actualCostUsd: null, totalLatencyMs: null },
        _sum: { actualCostUsd: null },
        _count: null,
        _min: null,
        _max: null,
      } as never);
      vi.mocked(prisma.request.count)
        .mockResolvedValueOnce(0)   // recent count
        .mockResolvedValueOnce(100); // baseline count

      await engine.analyseWorkspace(workspaceId);

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('returns early when baseline has fewer than 10 requests', async () => {
      vi.mocked(prisma.request.aggregate)
        .mockResolvedValueOnce({
          _avg: { actualCostUsd: 0.01, totalLatencyMs: 500 },
          _sum: { actualCostUsd: 0.5 },
        } as never)
        .mockResolvedValueOnce({
          _avg: { actualCostUsd: 0.005, totalLatencyMs: 400 },
        } as never);
      vi.mocked(prisma.request.count)
        .mockResolvedValueOnce(20)  // recent
        .mockResolvedValueOnce(5);   // baseline < 10

      await engine.analyseWorkspace(workspaceId);

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('fires cost_spike anomaly when cost is 3× baseline', async () => {
      vi.mocked(prisma.request.aggregate)
        .mockResolvedValueOnce({
          _avg: { actualCostUsd: 0.03, totalLatencyMs: 500 },
          _sum: { actualCostUsd: 0.6 },
        } as never)
        .mockResolvedValueOnce({
          _avg: { actualCostUsd: 0.005, totalLatencyMs: 400 },
        } as never);
      vi.mocked(prisma.request.count)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(1000);
      vi.mocked(prisma.notification.create).mockResolvedValue({} as never);

      await engine.analyseWorkspace(workspaceId);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceId,
            type: 'ANOMALY_DETECTED',
          }),
        }),
      );
    });

    it('fires error_surge when error rate exceeds 20%', async () => {
      vi.mocked(prisma.request.aggregate)
        .mockResolvedValueOnce({
          _avg: { actualCostUsd: 0.005, totalLatencyMs: 400 },
          _sum: { actualCostUsd: 0.1 },
        } as never)
        .mockResolvedValueOnce({
          _avg: { actualCostUsd: 0.005, totalLatencyMs: 400 },
        } as never);
      vi.mocked(prisma.request.count)
        .mockResolvedValueOnce(10)   // recent total
        .mockResolvedValueOnce(1000)  // baseline
        .mockResolvedValueOnce(3);    // recent errors (30%)

      vi.mocked(prisma.notification.create).mockResolvedValue({} as never);

      await engine.analyseWorkspace(workspaceId);

      expect(prisma.notification.create).toHaveBeenCalled();
    });
  });

  describe('runForAllWorkspaces()', () => {
    it('analyses all active workspaces', async () => {
      vi.mocked(prisma.workspace.findMany).mockResolvedValue([
        { id: 'ws-1' },
        { id: 'ws-2' },
      ] as never);

      const spy = vi.spyOn(engine, 'analyseWorkspace').mockResolvedValue();

      await engine.runForAllWorkspaces();

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith('ws-1');
      expect(spy).toHaveBeenCalledWith('ws-2');
    });
  });
});
