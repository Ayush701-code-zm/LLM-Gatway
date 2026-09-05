import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStripeEvent } from '../../lib/stripeWebhook';

const WS_ID = '00000000-0000-4000-8000-000000000101';

const redisSetMock = vi.fn().mockResolvedValue('OK');

vi.mock('../../config/redis', () => ({
  getRedis: () => ({
    set: (...args: unknown[]) => redisSetMock(...args),
  }),
}));

vi.mock('../../config/env', () => ({
  env: {
    STRIPE_PRICE_PRO: 'price_pro_test',
    STRIPE_PRICE_ENTERPRISE: 'price_ent_test',
  },
}));

const workspaceUpdateMock = vi.fn().mockResolvedValue({});
const workspaceFindFirstMock = vi.fn();
const notificationCreateMock = vi.fn().mockResolvedValue({});

vi.mock('@smartroute/database', () => ({
  prisma: {
    workspace: {
      update: (...args: unknown[]) => workspaceUpdateMock(...args),
      findFirst: (...args: unknown[]) => workspaceFindFirstMock(...args),
    },
    notification: {
      create: (...args: unknown[]) => notificationCreateMock(...args),
    },
  },
}));

vi.mock('../../lib/syncRateLimit', () => ({
  syncRateLimitRecord: vi.fn().mockResolvedValue(undefined),
}));

describe('handleStripeEvent', () => {
  beforeEach(() => {
    redisSetMock.mockClear();
    redisSetMock.mockResolvedValue('OK');
    workspaceUpdateMock.mockClear();
    workspaceFindFirstMock.mockClear();
    notificationCreateMock.mockClear();
  });

  it('upgrades workspace on checkout.session.completed', async () => {
    await handleStripeEvent({
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { workspaceId: WS_ID, plan: 'PRO' },
          customer: 'cus_test_1',
        },
      },
    });

    expect(workspaceUpdateMock).toHaveBeenCalledWith({
      where: { id: WS_ID },
      data: { plan: 'PRO', stripeCustomerId: 'cus_test_1' },
    });
  });

  it('skips duplicate webhook events', async () => {
    redisSetMock.mockResolvedValueOnce(null);

    await handleStripeEvent({
      id: 'evt_dup',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { workspaceId: WS_ID, plan: 'PRO' },
          customer: 'cus_test_1',
        },
      },
    });

    expect(workspaceUpdateMock).not.toHaveBeenCalled();
  });

  it('downgrades workspace on customer.subscription.deleted', async () => {
    await handleStripeEvent({
      id: 'evt_sub_del',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          metadata: { workspaceId: WS_ID },
        },
      },
    });

    expect(workspaceUpdateMock).toHaveBeenCalledWith({
      where: { id: WS_ID },
      data: { plan: 'FREE' },
    });
  });

  it('creates notification on invoice.payment_failed', async () => {
    workspaceFindFirstMock.mockResolvedValueOnce({ id: WS_ID });

    await handleStripeEvent({
      id: 'evt_invoice_fail',
      type: 'invoice.payment_failed',
      data: {
        object: {
          customer: 'cus_test_1',
        },
      },
    });

    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WS_ID,
          type: 'BUDGET_CRITICAL',
          title: 'Payment failed',
        }),
      }),
    );
  });
});
