# Stripe — Local Development Guide

SmartRoute uses Stripe for subscription billing (Pro / Enterprise plans). Production webhook setup is deferred; this guide covers **local development** with the Stripe CLI.

## Prerequisites

1. A [Stripe account](https://dashboard.stripe.com/register) (test mode is fine).
2. [Stripe CLI](https://stripe.com/docs/stripe-cli) installed and logged in:

```bash
stripe login
```

## Environment variables

Add these to your root `.env` (see `.env.example`):

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Test secret key (`sk_test_…`) from Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from `stripe listen` (see below) |
| `STRIPE_PRICE_PRO` | Price ID for the Pro plan (`price_…`) |
| `STRIPE_PRICE_ENTERPRISE` | Price ID for the Enterprise plan (`price_…`) |

Create products/prices in Stripe Dashboard → Products, or via CLI:

```bash
stripe products create --name "SmartRoute Pro"
stripe prices create --product prod_xxx --unit-amount 2900 --currency usd -d "recurring[interval]=month"
```

Copy the returned `price_…` IDs into `.env`.

## Forward webhooks to the API

With the API running on port 3001:

```bash
stripe listen --forward-to localhost:3001/api/v1/billing/webhook
```

The CLI prints a webhook signing secret like `whsec_…`. Set it as `STRIPE_WEBHOOK_SECRET` and restart the API.

## Test the checkout flow

1. Start infra + API + web: `make dev` from repo root.
2. Sign in to the dashboard → **Settings → Billing & Plans**.
3. Click **Upgrade to Pro** — you should be redirected to Stripe Checkout.
4. Use a [test card](https://stripe.com/docs/testing#cards): `4242 4242 4242 4242`, any future expiry, any CVC.
5. After payment, Stripe sends `checkout.session.completed` to your local webhook.
6. Confirm the workspace plan updated in Settings and rate limits synced.

## Trigger events manually

Useful for testing without going through Checkout:

```bash
# Simulate subscription update
stripe trigger customer.subscription.updated

# Simulate payment failure
stripe trigger invoice.payment_failed
```

## Handled webhook events

| Event | Action |
|---|---|
| `checkout.session.completed` | Activates plan, syncs rate limits |
| `customer.subscription.updated` | Updates plan tier from price ID |
| `customer.subscription.deleted` | Downgrades workspace to Free |
| `invoice.payment_failed` | Creates dashboard notification |

Idempotency is enforced via Redis (`stripe:webhook:{eventId}`) so duplicate deliveries are safe.

## Production (later)

When deploying:

1. Follow [STRIPE_STAGING.md](./STRIPE_STAGING.md) to validate billing on a staging API.
2. Follow [STRIPE_PRODUCTION.md](./STRIPE_PRODUCTION.md) for the live checklist.
3. Create a **live** webhook endpoint in Stripe Dashboard pointing to `https://your-api/api/v1/billing/webhook`.
4. Subscribe to the four events listed above.
5. Set live `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and price IDs in production secrets.
6. Verify with a real (small) subscription before announcing billing.
