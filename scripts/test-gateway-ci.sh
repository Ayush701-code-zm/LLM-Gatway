#!/usr/bin/env bash
# CI-friendly extended gateway smoke: standard endpoints + API key lifecycle + chat auth.
# Does not require LLM provider keys (chat may return 502/503 if providers are unset).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${API_URL:-http://localhost:3001}"
BASE="${API_URL}/api/v1"

echo "Gateway extended smoke (CI)"
echo "==========================="
echo "Target: ${API_URL}"
echo ""

curl -sf "${API_URL}/health/live" >/dev/null
echo "✓ GET /health/live"

curl -sf "${API_URL}/health/ready" >/dev/null
echo "✓ GET /health/ready"

chmod +x "${ROOT}/scripts/gateway-smoke-ci.sh"
API_URL="${API_URL}" "${ROOT}/scripts/gateway-smoke-ci.sh"

LOGIN=$(curl -sf -X POST "${BASE}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@smartroute.dev","password":"admin123"}')

TOKEN=$(echo "${LOGIN}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['accessToken'])" 2>/dev/null)

KEY_RESPONSE=$(curl -sf -X POST "${BASE}/api-keys" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"name":"ci-smoke-key"}')

echo "${KEY_RESPONSE}" | grep -q '"rawKey"'
echo "✓ POST /api-keys (create)"

API_KEY=$(echo "${KEY_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['rawKey'])" 2>/dev/null)
KEY_ID=$(echo "${KEY_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)

CHAT_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/chat" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{"message":"ci smoke ping","model":"auto"}')

if [[ "${CHAT_CODE}" == "401" ]] || [[ "${CHAT_CODE}" == "403" ]]; then
  echo "✗ POST /chat with valid API key must not return ${CHAT_CODE}"
  exit 1
fi
echo "✓ POST /chat accepts API key (HTTP ${CHAT_CODE}; LLM keys optional)"

curl -sf -X DELETE "${BASE}/api-keys/${KEY_ID}" \
  -H "Authorization: Bearer ${TOKEN}" >/dev/null
echo "✓ DELETE /api-keys/:id (cleanup)"

echo ""
echo "Gateway extended smoke passed."
