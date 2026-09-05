'use client';

import { useCallback, useState } from 'react';
import { CreditCard, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';
import { useApi, useMutation } from '@/hooks/useApi';
import { billingApi, SmartRouteApiError } from '@/lib/api';
import { selectCurrentWorkspace, useAuthStore } from '@/store/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const PLAN_BADGE: Record<string, 'muted' | 'default' | 'info'> = {
  FREE: 'muted',
  PRO: 'default',
  ENTERPRISE: 'info',
};

export function BillingSection({ billingNotice }: { billingNotice?: string | null }) {
  const currentRole = useAuthStore((s) => selectCurrentWorkspace(s)?.role ?? 'MEMBER');
  const isOwner = currentRole === 'OWNER';

  const plans = useApi(useCallback(() => billingApi.plans(), []));
  const status = useApi(useCallback((t) => billingApi.status(t), []));
  const { mutate: checkout, loading: checkingOut } = useMutation(
    (t, plan: 'PRO' | 'ENTERPRISE') => billingApi.checkout(t, plan),
  );
  const { mutate: openPortal, loading: openingPortal } = useMutation(
    (t, _input: null) => billingApi.portal(t),
  );

  const [error, setError] = useState<string | null>(null);

  const currentPlan = status.data?.currentPlan ?? 'FREE';
  const stripeReady = status.data?.stripeConfigured ?? false;

  async function handleUpgrade(plan: 'PRO' | 'ENTERPRISE') {
    setError(null);
    const result = await checkout(plan);
    if (result?.url) {
      window.location.href = result.url;
    } else {
      setError('Checkout failed. Is Stripe configured?');
    }
  }

  async function handlePortal() {
    setError(null);
    try {
      const result = await openPortal(null);
      if (result?.url) window.location.href = result.url;
    } catch (err) {
      setError(err instanceof SmartRouteApiError ? err.message : 'Could not open billing portal');
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-blue-400" />
            Billing & Plans
          </CardTitle>
          <Badge variant={PLAN_BADGE[currentPlan] ?? 'muted'}>
            {currentPlan.toLowerCase()} plan
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {billingNotice === 'success' && (
          <div
            data-testid="billing-success-notice"
            className="flex items-center gap-2 rounded-lg border border-emerald-800/50 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-400"
          >
            <CheckCircle2 className="h-4 w-4" />
            Payment successful — your plan will update shortly.
          </div>
        )}
        {billingNotice === 'cancelled' && (
          <p className="text-sm text-slate-500">Checkout was cancelled.</p>
        )}
        {!stripeReady && (
          <div
            data-testid="billing-stripe-not-configured"
            className="rounded-lg border border-yellow-800/40 bg-yellow-900/20 px-3 py-2 text-sm text-yellow-300"
          >
            Stripe is not configured. Set <code className="text-yellow-200">STRIPE_SECRET_KEY</code> and{' '}
            <code className="text-yellow-200">STRIPE_PRICE_*</code> in your API env to enable upgrades.
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="grid gap-3 sm:grid-cols-3">
          {(plans.data ?? []).map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const canUpgrade =
              isOwner &&
              stripeReady &&
              plan.id !== 'FREE' &&
              plan.id !== currentPlan &&
              (currentPlan === 'FREE' || (currentPlan === 'PRO' && plan.id === 'ENTERPRISE'));

            return (
              <div
                key={plan.id}
                className={`rounded-xl border p-4 ${
                  isCurrent ? 'border-blue-600 bg-blue-950/30' : 'border-slate-800 bg-slate-900/50'
                }`}
              >
                <p className="font-semibold text-white">{plan.name}</p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {plan.priceUsd === 0 ? 'Free' : `$${plan.priceUsd}`}
                  {plan.priceUsd > 0 && <span className="text-sm font-normal text-slate-500">/mo</span>}
                </p>
                <ul className="mt-3 space-y-1 text-xs text-slate-400">
                  <li>{plan.limits.rpm} req/min</li>
                  <li>{plan.limits.apiKeys === -1 ? 'Unlimited' : plan.limits.apiKeys} API keys</li>
                  <li>{plan.limits.members === -1 ? 'Unlimited' : plan.limits.members} members</li>
                </ul>
                {isCurrent && (
                  <Badge variant="info" className="mt-3">Current plan</Badge>
                )}
                {canUpgrade && (
                  <Button
                    size="sm"
                    className="mt-3 w-full"
                    disabled={checkingOut}
                    onClick={() => handleUpgrade(plan.id as 'PRO' | 'ENTERPRISE')}
                    data-testid={`billing-upgrade-${plan.id.toLowerCase()}`}
                  >
                    {checkingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Upgrade'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {isOwner && stripeReady && status.data?.hasBillingAccount && (
          <Button
            variant="outline"
            size="sm"
            disabled={openingPortal}
            onClick={handlePortal}
            data-testid="billing-manage-subscription"
          >
            {openingPortal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
            Manage subscription
          </Button>
        )}

        {!isOwner && (
          <p className="text-xs text-slate-500">Only workspace owners can change billing plans.</p>
        )}
      </CardContent>
    </Card>
  );
}
