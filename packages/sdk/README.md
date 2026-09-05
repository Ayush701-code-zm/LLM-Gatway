# @smartroute/sdk

Official TypeScript SDK for [SmartRoute AI](https://github.com) — the AI Gateway & Cost Optimization Platform.

## Install

```bash
npm install @smartroute/sdk
```

From the monorepo during development:

```bash
npm run build --workspace=@smartroute/sdk
```

## Quick start

```typescript
import { SmartRouteClient } from '@smartroute/sdk';

const client = new SmartRouteClient({
  baseUrl: 'http://localhost:3001',
  apiKey: 'sr_live_…',
});

// Non-streaming chat
const response = await client.chat({
  message: 'Explain vector databases in one paragraph.',
  model: 'auto',
  systemPrompt: 'Be concise.',
});

console.log(response.message);
console.log(`Cost: $${response.cost.actualUsd} (saved ${response.cost.savingsPercent}%)`);

// Streaming
for await (const chunk of client.chatStream({ message: 'Hello!', stream: true })) {
  if (chunk.type === 'content') process.stdout.write(String(chunk.delta ?? ''));
}

// Embeddings
const { embeddings } = await client.embeddings('semantic cache lookup');

// Health check (no API key required on gateway /health)
const health = await client.health();
console.log(health.status);

// List available models
const models = await client.models();
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `apiKey` | — | Workspace API key (`sr_live_…`) |
| `baseUrl` | `http://localhost:3001` | Gateway base URL (no trailing slash) |

## Error handling

Failed requests throw `Error` with the API error message:

```typescript
try {
  await client.chat({ message: '…' });
} catch (err) {
  console.error((err as Error).message);
}
```

## Publishing

Maintainers: see [`docs/NPM_PUBLISH.md`](../../docs/NPM_PUBLISH.md) in the monorepo root.

## License

MIT
