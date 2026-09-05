# Stripe — Staging Deployment

Use this guide to test **live-mode Stripe** against a staging API before production cutover. Pair with [STRIPE.md](./STRIPE.md) (local CLI) and [STRIPE_PRODUCTION.md](./STRIPE_PRODUCTION.md) (go-live checklist).

## Overview

| Environment | API URL | Stripe mode | Webhooks |
|-------------|---------|-------------|----------|
| Local | `http://localhost:3001` | Test (`sk_test_…`) | `stripe listen --forward-to localhost:3001/...` |
| Staging | `https://staging-api.yourdomain.com` | Test or Live | Stripe Dashboard endpoint or CLI tunnel |
| Production | `https://api.yourdomain.com` | Live (`sk_live_…`) | Dashboard endpoint only |

## 1. Staging environment variables

Deploy the API with **test** keys first (recommended):

```bash
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…          # from Dashboard or stripe listen
STRIPE_PRICE_PRO=price_…
STRIPE_PRICE_ENTERPRISE=price_…
API_BASE_URL=https://staging-api.yourdomain.com
NEXT_PUBLIC_API_URL=https://staging-api.yourdomain.com
```

Run the pre-flight check:

```bash
./scripts/verify-stripe-env.sh
```

## 2. Webhook options for staging

### Option A — Stripe Dashboard (persistent)

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://staging-api.yourdomain.com/api/v1/billing/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. Copy signing secret → `STRIPE_WEBHOOK_SECRET` on staging
5. **Send test webhook** from Dashboard; confirm `200` in API logs

### Option B — Stripe CLI tunnel (temporary)

Useful when staging is not publicly reachable or for debugging:

```bash
stripe listen --forward-to https://staging-api.yourdomain.com/api/v1/billing/webhook
```

Or tunnel staging to your machine via ngrok/Cloudflare Tunnel, then:

```bash
stripe listen --forward-to https://your-tunnel.ngrok.io/api/v1/billing/webhook
```

Set the CLI `whsec_…` on the **target** API instance and restart it.

## 3. Staging verification checklist

Run automated smoke checks (requires env vars on your shell or staging deploy config):

```bash
export STAGING_API_URL=https://staging-api.yourdomain.com
export STRIPE_SECRET_KEY=sk_test_…
export STRIPE_WEBHOOK_SECRET=whsec_…
export STRIPE_PRICE_PRO=price_…
export STRIPE_PRICE_ENTERPRISE=price_…
./scripts/stripe-staging-smoke.sh
```

Manual checks:

- [ ] `./scripts/verify-stripe-env.sh` passes on staging secrets
- [ ] Dashboard → Settings → Billing → **Upgrade to Pro** opens Checkout
- [ ] Complete checkout with test card `4242 4242 4242 4242`
- [ ] Webhook delivery shows `200` in Stripe Dashboard
- [ ] Workspace `plan` column updates to `PRO` in database
- [ ] Rate limits reflect Pro tier on Settings page
- [ ] Customer Portal cancellation downgrades to `FREE`

## 4. Promote staging → production

1. Swap `sk_test_…` → `sk_live_…` and live price IDs
2. Create a **new** live webhook endpoint (do not reuse test signing secret)
3. Follow [STRIPE_PRODUCTION.md](./STRIPE_PRODUCTION.md) sections 4–7
4. Run one real small subscription before announcing billing

## Makefile & CI

```bash
export STAGING_API_URL=https://staging-api.yourdomain.com
# + Stripe env vars (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, price IDs)
make stripe-staging-smoke
```

GitHub Actions: **Actions → Staging Smoke → Run workflow** (requires `STAGING_API_URL` and Stripe secrets in repo settings).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Checkout redirects but plan unchanged | Check webhook logs; verify `STRIPE_WEBHOOK_SECRET` matches endpoint |
| `400` on webhook | Signature mismatch — restart API after updating secret |
| Staging CORS errors | Set `CORS_ORIGINS` to staging web URL |
| Duplicate plan updates | Expected — idempotency via Redis `stripe:webhook:{eventId}` |
