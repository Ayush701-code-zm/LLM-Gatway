#!/usr/bin/env bash
# Run Playwright E2E tests against a local API + web stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_ENV=test
export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:3000}"
export E2E_EMAIL="${E2E_EMAIL:-admin@smartroute.dev}"
export E2E_PASSWORD="${E2E_PASSWORD:-admin123}"
export SAML_E2E_BYPASS=true
export OAUTH_E2E_BYPASS=true

# Minimal env for API
export API_KEY_ENCRYPTION_SECRET="${API_KEY_ENCRYPTION_SECRET:-test-secret-32-chars-padding-xxxx}"
export JWT_SECRET="${JWT_SECRET:-test-jwt-secret-for-e2e-pipeline-xx}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-test-jwt-refresh-secret-e2e-xx}"
export DATABASE_URL="${DATABASE_URL:-postgresql://smartroute:smartroute@localhost:5432/smartroute_test}"
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:3000}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:3001}"

API_PID=""
WEB_PID=""

cleanup() {
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "→ Building shared package…"
npm run build --workspace=packages/shared --silent

echo "→ Generating Prisma client…"
npx prisma generate --schema=packages/database/prisma/schema.prisma --silent

echo "→ Applying migrations…"
npm run db:migrate --workspace=@smartroute/database 2>/dev/null || \
  npx prisma migrate deploy --schema=packages/database/prisma/schema.prisma

echo "→ Seeding database…"
npm run db:seed --workspace=@smartroute/database 2>/dev/null || true

echo "→ Installing Python API dependencies…"
(cd apps/api && python3 -m venv .venv 2>/dev/null || true && .venv/bin/pip install -q -e ".[dev]")

echo "→ Starting FastAPI on :3001…"
(cd apps/api && SAML_E2E_BYPASS=true OAUTH_E2E_BYPASS=true .venv/bin/uvicorn smartroute.main:app --host 0.0.0.0 --port 3001) &
API_PID=$!

echo "→ Starting web on :3000…"
npm run dev --workspace=@smartroute/web --silent &
WEB_PID=$!

echo "→ Waiting for services…"
for i in $(seq 1 60); do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1 && curl -sf http://localhost:3000/login >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -sf http://localhost:3001/health >/dev/null || { echo "API failed to start"; exit 1; }
curl -sf http://localhost:3000/login >/dev/null || { echo "Web failed to start"; exit 1; }

echo "→ Running Playwright…"
npx playwright test "$@"

echo "→ Gateway extended smoke (API key lifecycle)…"
chmod +x scripts/test-gateway-ci.sh
API_URL=http://localhost:3001 ./scripts/test-gateway-ci.sh

echo "→ Infra config smoke…"
chmod +x scripts/verify-nginx-config.sh scripts/docker-compose-smoke.sh
./scripts/verify-nginx-config.sh
./scripts/docker-compose-smoke.sh
