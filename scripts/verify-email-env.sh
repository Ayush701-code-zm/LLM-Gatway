#!/usr/bin/env bash
# Verify SMTP env vars are set (does not send email).
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

echo "Email (SMTP) environment check"
echo "=============================="

check_var SMTP_HOST
check_var SMTP_USER
check_var SMTP_PASS
check_var EMAIL_FROM

if [[ -n "${SMTP_PORT:-}" ]]; then
  echo "✓ SMTP_PORT is set (${SMTP_PORT})"
else
  echo "⚠ SMTP_PORT not set (defaults to 587 in app config)"
fi

if [[ -n "${EMAIL_FROM:-}" && "$EMAIL_FROM" != *"@"* ]]; then
  echo "⚠ EMAIL_FROM does not look like an email address"
fi

if [[ $MISSING -eq 1 ]]; then
  echo ""
  echo "Set missing variables before enabling transactional email."
  echo "Without SMTP, password reset and team invites log URLs in dev only."
  exit 1
fi

echo ""
echo "All required SMTP variables are present."
