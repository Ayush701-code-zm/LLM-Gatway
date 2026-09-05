#!/usr/bin/env bash
# Post-deploy production cutover validation.
# Usage:
#   source .env && PRODUCTION_API_URL=https://api.yourdomain.com ./scripts/production-cutover-smoke.sh
#   ./scripts/production-cutover-smoke.sh --with-email --with-stripe
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCTION_API_URL="${PRODUCTION_API_URL:-${API_BASE_URL:-}}"
WITH_EMAIL=0
WITH_STRIPE=0

for arg in "$@"; do
  case "$arg" in
    --with-email)  WITH_EMAIL=1 ;;
    --with-stripe) WITH_STRIPE=1 ;;
    -h|--help)
      echo "Usage: $0 [--with-email] [--with-stripe]"
      exit 0
      ;;
  esac
done

if [[ -z "$PRODUCTION_API_URL" ]]; then
  echo "Set PRODUCTION_API_URL or API_BASE_URL (e.g. https://api.yourdomain.com)"
  exit 1
fi

PRODUCTION_API_URL="${PRODUCTION_API_URL%/}"

echo "Production cutover smoke"
echo "========================"
echo "Target: $PRODUCTION_API_URL"
echo ""

echo "→ Core env preflight…"
"$ROOT/scripts/verify-production-env.sh" --core
echo ""

if [[ "$WITH_EMAIL" -eq 1 ]]; then
  echo "→ Email env preflight…"
  "$ROOT/scripts/verify-email-env.sh"
  echo ""
fi

if [[ "$WITH_STRIPE" -eq 1 ]]; then
  echo "→ Stripe env preflight…"
  "$ROOT/scripts/verify-stripe-env.sh"
  echo ""
fi

check_http() {
  local path="$1"
  local label="$2"
  local code
  code="$(curl -sS -o /tmp/smartroute-cutover.json -w '%{http_code}' "$PRODUCTION_API_URL$path")"
  if [[ "$code" != "200" ]]; then
    echo "✗ $label returned HTTP $code ($path)"
    cat /tmp/smartroute-cutover.json 2>/dev/null || true
    exit 1
  fi
  echo "✓ $label OK"
}

check_http "/health"       "GET /health"
check_http "/health/live"  "GET /health/live"
check_http "/health/ready" "GET /health/ready"
check_http "/api/v1/billing/plans" "GET /api/v1/billing/plans"

echo ""
echo "→ SAML discover (seed workspace slug, optional)…"
DISCOVER_CODE="$(curl -sS -o /tmp/smartroute-saml.json -w '%{http_code}' \
  "$PRODUCTION_API_URL/api/v1/auth/saml/discover?workspace=acme-enterprise")"
if [[ "$DISCOVER_CODE" == "200" ]]; then
  echo "✓ SAML discover endpoint OK"
else
  echo "⚠ SAML discover returned HTTP $DISCOVER_CODE (configure Enterprise SSO separately)"
fi

echo ""
echo "Production cutover smoke passed."
echo "Complete manual checks in docs/PRODUCTION_CUTOVER.md (Stripe checkout, IdP login, monitoring)."
