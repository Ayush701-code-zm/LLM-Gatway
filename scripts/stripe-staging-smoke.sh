#!/usr/bin/env bash
# Smoke-test a staging API deployment and Stripe env configuration.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGING_API_URL="${STAGING_API_URL:-${API_BASE_URL:-}}"

if [[ -z "$STAGING_API_URL" ]]; then
  echo "Set STAGING_API_URL or API_BASE_URL (e.g. https://staging-api.yourdomain.com)"
  exit 1
fi

STAGING_API_URL="${STAGING_API_URL%/}"

echo "Stripe staging smoke test"
echo "========================="
echo "Target: $STAGING_API_URL"
echo ""

echo "→ Verifying Stripe env vars…"
"$ROOT/scripts/verify-stripe-env.sh"
echo ""

echo "→ GET /health"
health_code="$(curl -sS -o /tmp/smartroute-health.json -w '%{http_code}' "$STAGING_API_URL/health")"
if [[ "$health_code" != "200" ]]; then
  echo "✗ /health returned HTTP $health_code"
  cat /tmp/smartroute-health.json 2>/dev/null || true
  exit 1
fi
echo "✓ /health OK"

echo "→ GET /health/ready"
ready_code="$(curl -sS -o /tmp/smartroute-ready.json -w '%{http_code}' "$STAGING_API_URL/health/ready")"
if [[ "$ready_code" != "200" ]]; then
  echo "✗ /health/ready returned HTTP $ready_code"
  cat /tmp/smartroute-ready.json 2>/dev/null || true
  exit 1
fi
echo "✓ /health/ready OK"

echo "→ GET /api/v1/billing/plans"
plans_code="$(curl -sS -o /tmp/smartroute-plans.json -w '%{http_code}' "$STAGING_API_URL/api/v1/billing/plans")"
if [[ "$plans_code" != "200" ]]; then
  echo "✗ /api/v1/billing/plans returned HTTP $plans_code"
  exit 1
fi
echo "✓ Billing plans endpoint OK"

echo ""
echo "Staging smoke checks passed. Complete manual checkout in Settings → Billing."
