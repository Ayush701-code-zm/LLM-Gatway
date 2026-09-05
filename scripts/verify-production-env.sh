#!/usr/bin/env bash
# Preflight check for production deployment env vars.
# Usage:
#   ./scripts/verify-production-env.sh           # core vars only
#   ./scripts/verify-production-env.sh --email   # SMTP vars
#   ./scripts/verify-production-env.sh --stripe  # Stripe vars
#   ./scripts/verify-production-env.sh --all     # core + email + Stripe
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

check_core() {
  echo "Production core environment check"
  echo "=================================="

  check_var DATABASE_URL
  check_var REDIS_URL
  check_var JWT_SECRET
  check_var JWT_REFRESH_SECRET
  check_var API_KEY_ENCRYPTION_SECRET
  check_var API_BASE_URL
  check_var NEXT_PUBLIC_API_URL

  if [[ -n "${JWT_SECRET:-}" && "${JWT_SECRET}" == change-me* ]]; then
    echo "✗ JWT_SECRET must not be the default placeholder"
    MISSING=1
  fi

  if [[ -n "${JWT_REFRESH_SECRET:-}" && "${JWT_REFRESH_SECRET}" == change-me* ]]; then
    echo "✗ JWT_REFRESH_SECRET must not be the default placeholder"
    MISSING=1
  fi

  if [[ -n "${API_KEY_ENCRYPTION_SECRET:-}" && ${#API_KEY_ENCRYPTION_SECRET} -lt 32 ]]; then
    echo "✗ API_KEY_ENCRYPTION_SECRET must be at least 32 characters"
    MISSING=1
  fi

  if [[ "${NODE_ENV:-}" == "production" ]]; then
    echo "✓ NODE_ENV=production"
  else
    echo "⚠ NODE_ENV is not production (current: ${NODE_ENV:-unset})"
  fi

  if [[ -n "${API_BASE_URL:-}" && "${API_BASE_URL}" == http://localhost* ]]; then
    echo "⚠ API_BASE_URL still points at localhost"
  fi

  if [[ $MISSING -eq 1 ]]; then
    echo ""
    echo "Fix missing core variables before deploy. See docs/DEPLOYMENT.md"
    exit 1
  fi

  echo ""
  echo "Core production variables look good."
}

MODE="${1:-}"

case "$MODE" in
  ""|--core)
    check_core
    ;;
  --email)
    "$ROOT/scripts/verify-email-env.sh"
    ;;
  --stripe)
    "$ROOT/scripts/verify-stripe-env.sh"
    ;;
  --all)
    check_core
    echo ""
    "$ROOT/scripts/verify-email-env.sh"
    echo ""
    "$ROOT/scripts/verify-stripe-env.sh"
    ;;
  -h|--help)
    echo "Usage: $0 [--core|--email|--stripe|--all]"
    exit 0
    ;;
  *)
    echo "Unknown option: $MODE"
    echo "Usage: $0 [--core|--email|--stripe|--all]"
    exit 1
    ;;
esac
