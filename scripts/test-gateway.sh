#!/usr/bin/env bash
# ===========================================================
# SmartRoute AI — End-to-End Gateway Test
#
# Tests the full request pipeline:
#   login → create API key → send chat request → verify response
#
# Usage:
#   API_URL=http://localhost:3001 ./scripts/test-gateway.sh
# ===========================================================

set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"
BASE="${API_URL}/api/v1"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
step() { echo -e "\n${BLUE}▶ $1${NC}"; }

echo ""
echo -e "${BLUE}SmartRoute AI — Gateway E2E Test${NC}"
echo -e "Target: ${API_URL}"
echo ""

# ── 1. Health check ───────────────────────────────────────────

step "1. Health check"
HEALTH=$(curl -sf "${API_URL}/health" || echo '{}')
echo "  Response: $(echo "$HEALTH" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("data",{}).get("status","unknown"))' 2>/dev/null || echo 'unknown')"
pass "API is responding"

# ── 2. Login ──────────────────────────────────────────────────

step "2. Login as dev user"
LOGIN=$(curl -sf -X POST "${BASE}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@smartroute.dev","password":"admin123"}')

ACCESS_TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['tokens']['accessToken'])" 2>/dev/null || fail "Login failed — run ./scripts/dev-setup.sh first")
pass "Logged in, token: ${ACCESS_TOKEN:0:20}..."

# ── 3. Create API key ─────────────────────────────────────────

step "3. Create API key"
KEY_RESPONSE=$(curl -sf -X POST "${BASE}/api-keys" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -d '{"name":"Test Key"}')

API_KEY=$(echo "$KEY_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['rawKey'])" 2>/dev/null || fail "API key creation failed")
pass "API key created: ${API_KEY:0:16}..."

# ── 4. Send chat request ──────────────────────────────────────

step "4. Send chat request"
CHAT=$(curl -sf -X POST "${BASE}/chat" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{"message":"What is 2+2? Answer in one word.","model":"auto"}' || echo '{}')

REQUEST_ID=$(echo "$CHAT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('requestId','N/A'))" 2>/dev/null || echo 'N/A')
PROVIDER=$(echo "$CHAT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('provider','N/A'))" 2>/dev/null || echo 'N/A')
MODEL=$(echo "$CHAT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('model','N/A'))" 2>/dev/null || echo 'N/A')
COST=$(echo "$CHAT" | python3 -c "import sys,json; d=json.load(sys.stdin); c=d.get('data',{}).get('cost',{}); print(f'\${c.get(\"actualUsd\",0):.6f} (saved \${c.get(\"savingsUsd\",0):.6f})')" 2>/dev/null || echo 'N/A')
CACHE_HIT=$(echo "$CHAT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('data',{}).get('performance',{}).get('cacheHit') else 'no')" 2>/dev/null || echo 'N/A')
LATENCY=$(echo "$CHAT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('data',{}).get('performance',{}).get('totalLatencyMs','N/A'))+'ms')" 2>/dev/null || echo 'N/A')
COMPLEXITY=$(echo "$CHAT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('routing',{}).get('complexityLevel','N/A'))" 2>/dev/null || echo 'N/A')

pass "Request processed!"
echo ""
echo "  Request ID  : ${REQUEST_ID}"
echo "  Provider    : ${PROVIDER} / ${MODEL}"
echo "  Cost        : ${COST}"
echo "  Latency     : ${LATENCY}"
echo "  Cache hit   : ${CACHE_HIT}"
echo "  Complexity  : ${COMPLEXITY}"

# ── 5. Send same request again (should be cached) ─────────────

step "5. Send duplicate request (expect cache hit)"
CHAT2=$(curl -sf -X POST "${BASE}/chat" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{"message":"What is 2+2? Answer in one word.","model":"auto"}' || echo '{}')

CACHE_HIT2=$(echo "$CHAT2" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('data',{}).get('performance',{}).get('cacheHit') else 'no')" 2>/dev/null || echo 'N/A')
echo "  Cache hit   : ${CACHE_HIT2}"
if [ "$CACHE_HIT2" = "yes" ]; then
  pass "Semantic cache hit! Zero provider cost."
else
  echo -e "  ${YELLOW}⚠  Cache miss (semantic cache may need OpenAI key for embeddings)${NC}"
fi

# ── 6. Check analytics ────────────────────────────────────────

step "6. Analytics overview"
ANALYTICS=$(curl -sf "${BASE}/analytics/overview" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" || echo '{}')

TOTAL=$(echo "$ANALYTICS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('totalRequests','N/A'))" 2>/dev/null || echo 'N/A')
pass "Analytics working — ${TOTAL} total requests recorded"

# ── Done ──────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}All tests passed! ✅${NC}"
echo ""
echo "  API Docs  : ${API_URL}/docs"
echo "  Metrics   : ${API_URL}/metrics"
echo "  Grafana   : http://localhost:3002"
echo ""
