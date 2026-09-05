# Stripe — Production Checklist

Use this checklist when moving from local Stripe CLI testing to live billing.

For staging validation first, see [STRIPE_STAGING.md](./STRIPE_STAGING.md).

## Pre-flight script

Run before deploying to production (checks env vars only — does not call Stripe):

```bash
chmod +x scripts/verify-stripe-env.sh
STRIPE_SECRET_KEY=sk_live_… \
STRIPE_WEBHOOK_SECRET=whsec_… \
STRIPE_PRICE_PRO=price_… \
STRIPE_PRICE_ENTERPRISE=price_… \
API_BASE_URL=https://api.yourdomain.com \
  ./scripts/verify-stripe-env.sh
```

## 1. Stripe Dashboard setup

- [ ] Switch to **Live mode** in Stripe Dashboard
- [ ] Create **Products** for Pro and Enterprise with recurring monthly prices
- [ ] Note live `price_…` IDs for `.env`
- [ ] Enable **Customer portal** (Settings → Billing → Customer portal) for self-service cancellation

## 2. Webhook endpoint

- [ ] Add endpoint: `https://api.yourdomain.com/api/v1/billing/webhook`
- [ ] Subscribe to events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- [ ] Copy the **signing secret** (`whsec_…`) to production secrets as `STRIPE_WEBHOOK_SECRET`
- [ ] Send a test event from Dashboard and confirm `200` response in Stripe logs

## 3. Environment variables

Set in your secret manager (never in git):

```bash
STRIPE_SECRET_KEY=sk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_PRO=price_…
STRIPE_PRICE_ENTERPRISE=price_…
API_BASE_URL=https://api.yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

Restart all API instances after updating secrets.

## 4. Verify end-to-end

- [ ] Upgrade a test workspace via Settings → Billing (use a real card or Stripe test in staging first)
- [ ] Confirm workspace `plan` updates in database
- [ ] Confirm `rate_limits` row synced (check dashboard rate-limit card)
- [ ] Cancel subscription via Stripe Customer Portal
- [ ] Confirm downgrade to Free and rate limits reset

## 5. Operational safeguards

- [ ] Monitor webhook delivery failures in Stripe Dashboard
- [ ] Alert on repeated `invoice.payment_failed` for the same customer
- [ ] Document refund/chargeback process for support team
- [ ] Review [docs/STRIPE.md](./STRIPE.md) for local dev parity

## 6. Compliance

- [ ] Update [SUBPROCESSORS.md](./SUBPROCESSORS.md) if Stripe data residency differs from your deployment region
- [ ] Ensure privacy policy mentions payment processing by Stripe

## 7. Rollback plan

- [ ] Document how to revert `STRIPE_SECRET_KEY` to test keys in staging if checkout breaks
- [ ] Keep previous `STRIPE_WEBHOOK_SECRET` until new endpoint is verified
- [ ] Run `./scripts/verify-stripe-env.sh` after every secret rotation

For deployment infrastructure see [DEPLOYMENT.md](./DEPLOYMENT.md). Local dev guide: [STRIPE.md](./STRIPE.md).
