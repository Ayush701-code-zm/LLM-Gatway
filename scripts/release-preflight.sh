#!/usr/bin/env bash
# Pre-release checks: SDK smoke, optional tag ↔ package version alignment.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-${GITHUB_REF_NAME:-}}"

echo "Release preflight"
echo "================="

if [[ -n "$TAG" ]]; then
  VERSION="${TAG#v}"
  PKG_VERSION="$(node -p "require('$ROOT/packages/sdk/package.json').version")"
  echo "Tag:         $TAG"
  echo "SDK version: $PKG_VERSION"
  if [[ "$PKG_VERSION" != "$VERSION" ]]; then
    echo "✗ Tag version ($VERSION) does not match packages/sdk/package.json ($PKG_VERSION)"
    echo "  Run: npm version $VERSION --workspace=@smartroute/sdk"
    exit 1
  fi
  echo "✓ Tag matches SDK package version"
fi

"$ROOT/scripts/sdk-publish-smoke.sh"

if [[ -n "${DATABASE_URL:-}" && -n "${REDIS_URL:-}" ]]; then
  echo ""
  "$ROOT/scripts/verify-production-env.sh" --core
fi

echo ""
echo "Release preflight passed."
