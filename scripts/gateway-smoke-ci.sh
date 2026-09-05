#!/usr/bin/env bash
# CI-friendly gateway smoke: health, auth, billing — no LLM keys required.
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"
BASE="${API_URL}/api/v1"

echo "Gateway smoke (CI)"
echo "=================="
echo "Target: ${API_URL}"
echo ""

curl -sf "${API_URL}/health" >/dev/null
echo "✓ GET /health"

PLANS=$(curl -sf "${BASE}/billing/plans")
echo "${PLANS}" | grep -q '"FREE"'
echo "✓ GET /billing/plans"

LOGIN=$(curl -sf -X POST "${BASE}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@smartroute.dev","password":"admin123"}')

echo "${LOGIN}" | grep -q 'accessToken'
echo "✓ POST /auth/login"

DISCOVER=$(curl -sf "${BASE}/auth/saml/discover?workspace=acme-enterprise")
echo "${DISCOVER}" | grep -q '"enabled"'
echo "✓ GET /auth/saml/discover (public)"

TOKEN=$(echo "${LOGIN}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['accessToken'])" 2>/dev/null)

OVERVIEW=$(curl -sf "${BASE}/admin/overview" -H "Authorization: Bearer ${TOKEN}")
echo "${OVERVIEW}" | grep -q '"workspaces"'
echo "✓ GET /admin/overview (super-admin)"

WEBHOOKS=$(curl -sf "${BASE}/webhooks" -H "Authorization: Bearer ${TOKEN}")
echo "${WEBHOOKS}" | grep -q '"success"'
echo "✓ GET /webhooks (authenticated)"

CHAT_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"smoke"}')
if [[ "${CHAT_CODE}" != "401" ]]; then
  echo "✗ POST /chat expected 401 without API key, got ${CHAT_CODE}"
  exit 1
fi
echo "✓ POST /chat rejects unauthenticated requests"

EMBED_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/embeddings" \
  -H "Content-Type: application/json" \
  -d '{"input":"smoke"}')
if [[ "${EMBED_CODE}" != "401" ]]; then
  echo "✗ POST /embeddings expected 401 without API key, got ${EMBED_CODE}"
  exit 1
fi
echo "✓ POST /embeddings rejects unauthenticated requests"

ANALYTICS=$(curl -sf "${BASE}/analytics/overview" -H "Authorization: Bearer ${TOKEN}")
echo "${ANALYTICS}" | grep -q '"totalRequests"'
echo "✓ GET /analytics/overview (authenticated)"

ANOMALIES=$(curl -sf "${BASE}/analytics/anomalies?days=30" -H "Authorization: Bearer ${TOKEN}")
echo "${ANOMALIES}" | grep -q '"anomalies"'
echo "✓ GET /analytics/anomalies (authenticated)"

RELIABILITY=$(curl -sf "${BASE}/analytics/reliability?days=30" -H "Authorization: Bearer ${TOKEN}")
echo "${RELIABILITY}" | grep -q '"fallbackRate"'
echo "✓ GET /analytics/reliability (authenticated)"

USAGE=$(curl -sf "${BASE}/analytics/usage?days=30" -H "Authorization: Bearer ${TOKEN}")
echo "${USAGE}" | grep -q '"series"'
echo "✓ GET /analytics/usage (authenticated)"

USER_EXPORT=$(curl -sf "${BASE}/auth/me/export" -H "Authorization: Bearer ${TOKEN}")
echo "${USER_EXPORT}" | grep -q '"exportedAt"'
echo "✓ GET /auth/me/export (authenticated)"

AUDIT_LOGS=$(curl -sf "${BASE}/workspaces/current/audit-logs?page=1&limit=5" -H "Authorization: Bearer ${TOKEN}")
echo "${AUDIT_LOGS}" | grep -q '"pagination"'
echo "✓ GET /workspaces/current/audit-logs (authenticated)"

MEMBERS=$(curl -sf "${BASE}/workspaces/current/members" -H "Authorization: Bearer ${TOKEN}")
echo "${MEMBERS}" | grep -q '"success"'
echo "✓ GET /workspaces/current/members (authenticated)"

EXPORT=$(curl -sf "${BASE}/analytics/export?format=csv" -H "Authorization: Bearer ${TOKEN}")
echo "${EXPORT}" | grep -q 'traceId'
echo "✓ GET /analytics/export CSV (authenticated)"

MODELS=$(curl -sf "${BASE}/models")
echo "${MODELS}" | grep -q '"success"'
echo "✓ GET /models (public)"

API_KEYS=$(curl -sf "${BASE}/api-keys" -H "Authorization: Bearer ${TOKEN}")
echo "${API_KEYS}" | grep -q '"success"'
echo "✓ GET /api-keys (authenticated)"

echo ""
echo "Gateway smoke passed."
