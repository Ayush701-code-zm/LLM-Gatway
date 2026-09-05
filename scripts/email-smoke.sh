#!/usr/bin/env bash
# Local SMTP smoke test via Mailhog (does not require a running API).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAILHOG_API_URL="${MAILHOG_API_URL:-http://localhost:8025}"
SMTP_HOST="${SMTP_HOST:-localhost}"
SMTP_PORT="${SMTP_PORT:-1025}"
EMAIL_FROM="${EMAIL_FROM:-smoke-test@smartroute.dev}"
EMAIL_TO="${EMAIL_TO:-recipient@smartroute.dev}"

echo "Email smoke test (Mailhog)"
echo "=========================="
echo "Mailhog API: $MAILHOG_API_URL"
echo "SMTP:        $SMTP_HOST:$SMTP_PORT"
echo ""

if ! curl -sf "$MAILHOG_API_URL/api/v2/messages" >/dev/null 2>&1; then
  echo "✗ Mailhog is not reachable at $MAILHOG_API_URL"
  echo "  Start it with: docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mailhog"
  exit 1
fi
echo "✓ Mailhog API reachable"

BEFORE="$(curl -sf "$MAILHOG_API_URL/api/v2/messages" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("total",0))' 2>/dev/null || echo 0)"

echo "→ Sending test email…"
SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" SMTP_USER="${SMTP_USER:-}" SMTP_PASS="${SMTP_PASS:-}" \
  EMAIL_FROM="$EMAIL_FROM" EMAIL_TO="$EMAIL_TO" \
  node "$ROOT/scripts/email-smoke-send.mjs"

sleep 1

AFTER="$(curl -sf "$MAILHOG_API_URL/api/v2/messages" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("total",0))' 2>/dev/null || echo 0)"

if [[ "$AFTER" -le "$BEFORE" ]]; then
  echo "✗ No new message in Mailhog (before=$BEFORE after=$AFTER)"
  exit 1
fi

SUBJECT="$(curl -sf "$MAILHOG_API_URL/api/v2/messages" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items') or []
if not items:
    sys.exit(1)
print(items[0].get('Content', {}).get('Headers', {}).get('Subject', [''])[0])
" 2>/dev/null || echo '')"

if [[ "$SUBJECT" != *"SmartRoute email smoke test"* ]]; then
  echo "✗ Latest Mailhog message subject unexpected: $SUBJECT"
  exit 1
fi

echo "✓ Message delivered to Mailhog"
echo ""
echo "  Web UI: $MAILHOG_API_URL"
echo "  Run 'make verify-email' before production deploy (real SMTP credentials)."
