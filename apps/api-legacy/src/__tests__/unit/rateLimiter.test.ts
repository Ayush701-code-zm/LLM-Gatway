import { describe, it, expect, vi, beforeEach } from 'vitest';

// Single shared pipeline mock — mutate exec per test
const pipelineExec = vi.fn();

const pipelineMock = {
  incr:   vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec:   pipelineExec,
};

const redisMock = { pipeline: vi.fn().mockReturnValue(pipelineMock) };

vi.mock('../../config/redis', () => ({
  getRedis: () => redisMock,
}));

vi.mock('@smartroute/database', () => ({
  prisma: {
    workspace: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        plan: 'FREE', requestsPerMinute: null, requestsPerDay: null,
      }),
    },
  },
}));

import { RateLimiterEngine } from '../../engines/rateLimiter';
import { prisma }            from '@smartroute/database';

const FREE_RPM = 10;   // matches PLAN_LIMITS.FREE.requestsPerMinute
const FREE_RPD = 500;  // matches PLAN_LIMITS.FREE.requestsPerDay

function mockPipelineResult(rpm: number, rpd: number) {
  pipelineExec.mockResolvedValueOnce([
    [null, rpm], [null, true],
    [null, rpd], [null, true],
  ]);
}

describe('RateLimiterEngine', () => {
  let limiter: RateLimiterEngine;
  const workspaceId = 'ws-test-456';

  beforeEach(() => {
    vi.clearAllMocks();
    limiter = new RateLimiterEngine();
    redisMock.pipeline.mockReturnValue(pipelineMock);
    vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({
      plan: 'FREE', requestsPerMinute: null, requestsPerDay: null,
    } as never);
  });

  it('passes for first request (count = 1 well under limit)', async () => {
    mockPipelineResult(1, 1);
    await expect(limiter.check(workspaceId)).resolves.not.toThrow();
  });

  it('passes at exactly the limit (not over)', async () => {
    mockPipelineResult(FREE_RPM, FREE_RPD);
    await expect(limiter.check(workspaceId)).resolves.not.toThrow();
  });

  it('throws RATE_LIMIT_EXCEEDED when RPM count exceeds limit', async () => {
    mockPipelineResult(FREE_RPM + 1, 1);
    await expect(limiter.check(workspaceId)).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('throws RATE_LIMIT_EXCEEDED when RPD count exceeds limit', async () => {
    mockPipelineResult(1, FREE_RPD + 1);
    await expect(limiter.check(workspaceId)).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('includes retryAfter in error details', async () => {
    mockPipelineResult(FREE_RPM + 1, 1);
    await expect(limiter.check(workspaceId)).rejects.toMatchObject({
      details: expect.objectContaining({ retryAfter: expect.any(Number) }),
    });
  });

  it('respects custom workspace RPM override', async () => {
    vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({
      plan: 'FREE', requestsPerMinute: 5, requestsPerDay: null,
    } as never);
    mockPipelineResult(6, 1); // count 6 > custom limit 5
    await expect(limiter.check(workspaceId)).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('passes with custom limit when count is within it', async () => {
    vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({
      plan: 'FREE', requestsPerMinute: 10, requestsPerDay: null,
    } as never);
    mockPipelineResult(5, 1); // count 5 <= custom limit 10
    await expect(limiter.check(workspaceId)).resolves.not.toThrow();
  });

  it('uses rpm: and rpd: key prefixes', async () => {
    // Use a local pipeline to inspect incr calls
    const localPipeline = {
      incr:   vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec:   vi.fn().mockResolvedValue([[null,1],[null,true],[null,1],[null,true]]),
    };
    redisMock.pipeline.mockReturnValueOnce(localPipeline as never);

    await limiter.check(workspaceId);
    const keys = localPipeline.incr.mock.calls.map((c) => c[0] as string);
    expect(keys[0]).toMatch(/^rl:rpm:/);
    expect(keys[1]).toMatch(/^rl:rpd:/);
    expect(keys[0]).toContain(workspaceId);
  });
});
