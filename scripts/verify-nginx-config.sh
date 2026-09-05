#!/usr/bin/env bash
# Validate infra/nginx/nginx.conf syntax via Docker nginx image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="${ROOT}/infra/nginx/nginx.conf"

echo "→ Nginx config smoke"
echo "===================="
echo "Config: ${CONF}"

if [[ ! -f "${CONF}" ]]; then
  echo "✗ nginx.conf not found"
  exit 1
fi
echo "✓ config file exists"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker run --rm \
    -v "${CONF}:/etc/nginx/nginx.conf:ro" \
    nginx:1.27-alpine \
    nginx -t -c /etc/nginx/nginx.conf
  echo "✓ nginx -t passed (Docker)"
elif command -v nginx >/dev/null 2>&1; then
  nginx -t -c "${CONF}"
  echo "✓ nginx -t passed (local)"
else
  echo "⚠ docker/nginx daemon unavailable — running static structure checks"
  grep -q 'upstream api_servers' "${CONF}" || { echo "✗ missing api upstream"; exit 1; }
  grep -q 'upstream web_servers' "${CONF}" || { echo "✗ missing web upstream"; exit 1; }
  grep -q 'location /api/' "${CONF}" || { echo "✗ missing /api/ location"; exit 1; }
  grep -q 'location /health' "${CONF}" || { echo "✗ missing /health location"; exit 1; }
  echo "✓ static structure checks passed"
fi

echo ""
echo "Nginx config smoke passed."
