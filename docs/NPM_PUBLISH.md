# Publishing `@smartroute/sdk` to npm

This runbook covers manual and automated publishing of the TypeScript SDK at `packages/sdk/`.

## Prerequisites

1. **npm account** with permission to publish `@smartroute/sdk` (scoped package).
2. **Organization access** if publishing under an npm org (e.g. `@smartroute`).
3. **`NPM_TOKEN`** — create at [npmjs.com/settings/~/tokens](https://www.npmjs.com/settings/~/tokens) with **Automation** or **Publish** scope.

## One-time setup

1. Set `repository.url` in `packages/sdk/package.json` to your GitHub repo.
2. Log in locally (optional for manual publish):

   ```bash
   npm login
   ```

3. Add `NPM_TOKEN` as a GitHub Actions secret on the repo (Settings → Secrets → Actions).

## Versioning

Follow semver. Update `packages/sdk/CHANGELOG.md` before each release.

```bash
# Bump patch/minor/major in package.json + lockfile
npm version patch --workspace=@smartroute/sdk
# or: npm version minor --workspace=@smartroute/sdk
```

Commit the version bump and tag the **monorepo** release (Docker + SDK share tags):

```bash
git tag v0.1.2
git push origin main --tags
```

## Automated publish (recommended)

Run the local preflight script before tagging:

```bash
chmod +x scripts/release-preflight.sh
TAG=v0.1.2 ./scripts/release-preflight.sh
```

Or via Make:

```bash
TAG=v0.1.2 make release-preflight
```

This validates tag ↔ SDK version alignment and runs `sdk-publish-smoke.sh`. See [RELEASE.md](./RELEASE.md) for the full checklist.

On push of a semver tag `v*.*.*`, `.github/workflows/release.yml` runs:

1. Full CI test suite
2. **Release preflight** (tag ↔ SDK version, sdk-publish-smoke)
3. Docker image publish (API + web)
4. **`publish-sdk`** job (when `NPM_TOKEN` is set):
   - `npm run build --workspace=@smartroute/sdk`
   - `npm run test --workspace=@smartroute/sdk`
   - `npm publish --workspace=@smartroute/sdk --access public --provenance`

If `NPM_TOKEN` is missing, the workflow runs a **skipped** notice job instead of failing silently.

## Manual publish

Use when testing before tagging or for hotfix releases:

```bash
npm run build --workspace=@smartroute/sdk
npm run test --workspace=@smartroute/sdk
npm publish --workspace=@smartroute/sdk --access public
```

`prepublishOnly` in `package.json` runs build + tests automatically.

With provenance (requires npm 9+ and CI or `NPM_TOKEN`):

```bash
npm publish --workspace=@smartroute/sdk --access public --provenance
```

## Verify after publish

```bash
npm view @smartroute/sdk version
npm install @smartroute/sdk@latest
```

Smoke test:

```typescript
import { SmartRouteClient } from '@smartroute/sdk';

const client = new SmartRouteClient({
  baseUrl: 'http://localhost:3001',
  apiKey: process.env.SMARTRoute_API_KEY!,
});

await client.health();
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `403 Forbidden` on publish | Check npm org membership and token scopes |
| `402 Payment Required` | Enable billing on npm org for private packages (this package is **public**) |
| Version already exists | Bump version in `package.json` / `CHANGELOG.md` |
| Provenance failed | Run from GitHub Actions or use `npm publish --provenance` with valid `NPM_TOKEN` |

## Related docs

- [`docs/SDK.md`](./SDK.md) — API surface and local development
- [`packages/sdk/README.md`](../packages/sdk/README.md) — consumer quick start
- [`packages/sdk/CHANGELOG.md`](../packages/sdk/CHANGELOG.md) — release notes
