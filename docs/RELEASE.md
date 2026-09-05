# Release Checklist

Use this when cutting a semver release (`v*.*.*`). Docker images and `@smartroute/sdk` share the same tag.

## Before tagging

1. **Update changelog** — `packages/sdk/CHANGELOG.md`
2. **Bump SDK version** (must match tag):

   ```bash
   npm version patch --workspace=@smartroute/sdk
   # commit: chore: release v0.1.3
   ```

3. **Run preflight locally**:

   ```bash
   chmod +x scripts/release-preflight.sh
   ./scripts/release-preflight.sh v0.1.3
   ```

   This runs:
   - Tag ↔ `packages/sdk/package.json` version check
   - `sdk-publish-smoke.sh` (build, test, npm pack dry-run)
   - `verify-production-env.sh --core` (when env vars are set)

4. **Full CI green** on `main`

## Tag and push

```bash
git tag v0.1.3
git push origin main --tags
```

## What runs automatically

[`.github/workflows/release.yml`](../.github/workflows/release.yml):

| Job | Action |
|-----|--------|
| `test` | Full CI suite (reusable workflow) |
| `preflight` | `release-preflight.sh` with tag version check |
| `publish` | Push API + web Docker images to GHCR, GitHub Release |
| `publish-sdk` | npm publish (when `NPM_TOKEN` secret is set) |
| `publish-sdk-skipped` | Notice when `NPM_TOKEN` is missing |

## Required GitHub configuration

| Setting | Purpose |
|---------|---------|
| `NPM_TOKEN` | Publish `@smartroute/sdk` |
| `vars.NEXT_PUBLIC_API_URL` | Web Docker build arg for production API URL |
| `secrets.GITHUB_TOKEN` | GHCR push (automatic) |

## After release

1. Verify Docker images:

   ```bash
   docker pull ghcr.io/<owner>/smartroute-api:v0.1.3
   docker pull ghcr.io/<owner>/smartroute-web:v0.1.3
   ```

2. Verify npm (if published):

   ```bash
   npm view @smartroute/sdk version
   ```

3. Deploy and run [PRODUCTION_CUTOVER.md](./PRODUCTION_CUTOVER.md)

## Hotfix release

1. Fix on `main`, bump patch version
2. `./scripts/release-preflight.sh vX.Y.Z`
3. Tag and push — do not skip preflight on hotfixes

## Related

- [NPM_PUBLISH.md](./NPM_PUBLISH.md) — npm token and troubleshooting
- [GATEWAY_SMOKE.md](./GATEWAY_SMOKE.md) — optional LLM smoke after deploy
- [STRIPE_STAGING.md](./STRIPE_STAGING.md) — billing validation before live cutover
