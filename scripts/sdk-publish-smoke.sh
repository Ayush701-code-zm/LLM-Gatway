#!/usr/bin/env bash
# Validate @smartroute/sdk is ready to publish (build, test, pack).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ SDK publish smoke"
echo "===================="

npm run build --workspace=@smartroute/sdk --silent
echo "✓ build"

npm run test --workspace=@smartroute/sdk --silent
echo "✓ tests"

PACK=$(npm pack --workspace=@smartroute/sdk --dry-run 2>&1)
echo "${PACK}" | grep -q '@smartroute/sdk'
echo "✓ npm pack dry-run"

echo ""
echo "SDK publish smoke passed."
