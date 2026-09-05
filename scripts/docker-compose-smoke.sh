#!/usr/bin/env bash
# Validate docker-compose.yml structure and healthcheck definitions (no stack startup).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="${ROOT}/docker-compose.yml"

echo "→ Docker Compose smoke"
echo "======================"
echo "File: ${COMPOSE}"

if [[ ! -f "${COMPOSE}" ]]; then
  echo "✗ docker-compose.yml not found"
  exit 1
fi
echo "✓ compose file exists"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose -f "${COMPOSE}" config >/dev/null
  echo "✓ docker compose config valid"
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f "${COMPOSE}" config >/dev/null
  echo "✓ docker-compose config valid"
else
  echo "⚠ docker compose unavailable — running static structure checks"
fi

grep -q '^  postgres:' "${COMPOSE}" || { echo "✗ missing postgres service"; exit 1; }
grep -q '^  redis:' "${COMPOSE}" || { echo "✗ missing redis service"; exit 1; }
grep -q 'pg_isready' "${COMPOSE}" || { echo "✗ missing postgres healthcheck"; exit 1; }
grep -q 'redis-cli' "${COMPOSE}" || { echo "✗ missing redis healthcheck"; exit 1; }
grep -q '/health/live' "${COMPOSE}" || { echo "✗ missing api healthcheck"; exit 1; }
grep -q "profiles: \\['full'\\]" "${COMPOSE}" || { echo "✗ missing full profile services"; exit 1; }
echo "✓ required services and healthchecks present"

echo ""
echo "Docker Compose smoke passed."
