# SmartRoute SDK

The `@smartroute/sdk` package provides a typed TypeScript client for the SmartRoute AI gateway.

## Package location

```
packages/sdk/
├── src/index.ts    # SmartRouteClient
├── package.json
└── README.md
```

## Build

```bash
npm run build --workspace=@smartroute/sdk
```

Output is written to `packages/sdk/dist/`.

## API surface

| Method | Gateway route | Description |
|--------|---------------|-------------|
| `chat(body)` | `POST /api/v1/chat` | Non-streaming completion |
| `chatStream(body)` | `POST /api/v1/chat/stream` | Async generator of SSE chunks |
| `embeddings(input, model?)` | `POST /api/v1/embeddings` | Vector embeddings |
| `health()` | `GET /health` | Platform health (DB + Redis) |
| `models()` | `GET /api/v1/models` | Public model registry listing |

## Authentication

All `/api/v1/*` routes use the workspace API key via the `X-API-Key` header (Bearer token also accepted):

```
X-API-Key: sr_live_…
```

## Local development example

```typescript
import { SmartRouteClient } from '@smartroute/sdk';

const client = new SmartRouteClient({
  baseUrl: process.env.SMARTRoute_API_URL ?? 'http://localhost:3001',
  apiKey: process.env.SMARTRoute_API_KEY!,
});

const res = await client.chat({
  message: 'What is 2+2?',
  model: 'auto',
});
```

Create an API key from the dashboard at **API Keys**, or use the seed dev workspace.

## Publishing

The package is versioned at **0.1.2**. See **[NPM_PUBLISH.md](./NPM_PUBLISH.md)** for the full runbook (versioning, `NPM_TOKEN`, CI tag releases, and manual publish).

Quick manual publish:

```bash
npm run build --workspace=@smartroute/sdk
npm run test --workspace=@smartroute/sdk
npm publish --workspace=@smartroute/sdk --access public
```

`prepublishOnly` runs build + tests automatically.
