#!/usr/bin/env bash
# Verify Stripe production env vars are set (does not call Stripe API).
set -euo pipefail

MISSING=0

check_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "✗ $name is not set"
    MISSING=1
  else
    echo "✓ $name is set"
  fi
}

echo "Stripe production environment check"
echo "===================================="

check_var STRIPE_SECRET_KEY
check_var STRIPE_WEBHOOK_SECRET
check_var STRIPE_PRICE_PRO
check_var STRIPE_PRICE_ENTERPRISE
check_var API_BASE_URL

if [[ -n "${STRIPE_SECRET_KEY:-}" && "${STRIPE_SECRET_KEY}" == sk_test_* ]]; then
  echo "⚠ STRIPE_SECRET_KEY looks like a test key (sk_test_…)"
fi

if [[ -n "${STRIPE_SECRET_KEY:-}" && "${STRIPE_SECRET_KEY}" == sk_live_* ]]; then
  echo "✓ STRIPE_SECRET_KEY is a live key"
fi

if [[ $MISSING -eq 1 ]]; then
  echo ""
  echo "Set missing variables before production deploy. See docs/STRIPE_PRODUCTION.md"
  exit 1
fi

echo ""
echo "All required Stripe variables are present."
