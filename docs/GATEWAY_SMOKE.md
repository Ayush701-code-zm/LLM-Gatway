# Full Gateway Smoke (`test-gateway.sh`)

This guide covers the **full LLM gateway pipeline** smoke test — login, API key creation, real chat request, semantic cache verification, and analytics.

For CI-safe smoke without LLM keys, use [`test-gateway-ci.sh`](../scripts/test-gateway-ci.sh) instead.

## What it tests

| Step | Endpoint | Requires LLM keys? |
|------|----------|-------------------|
| 1 | `GET /health` | No |
| 2 | `POST /auth/login` | No (seed user) |
| 3 | `POST /api-keys` | No |
| 4 | `POST /chat` | **Yes** |
| 5 | Duplicate `POST /chat` (cache) | **Yes** (OpenAI key helps embeddings) |
| 6 | `GET /analytics/overview` | No |

## Prerequisites

1. API running (local: `make dev` or Docker stack)
2. Database seeded (`make seed` or `npm run db:seed`)
3. At least one provider API key in `.env`:

```bash
OPENAI_API_KEY=sk-...
# and/or
ANTHROPIC_API_KEY=sk-ant-...
# and/or
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
```

For semantic cache step (5), an **OpenAI** key is recommended (`EMBEDDING_MODEL=text-embedding-3-small`).

## Local run

```bash
# Default target http://localhost:3001
make test-gateway

# Or explicitly:
API_URL=http://localhost:3001 ./scripts/test-gateway.sh
```

Expected output ends with `All tests passed! ✅` and prints request ID, provider, cost, and cache hit status.

## CI (optional, manual)

The workflow [`.github/workflows/gateway-smoke.yml`](../.github/workflows/gateway-smoke.yml) runs on **workflow_dispatch** when repo secrets are configured:

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | Chat + embeddings (recommended) |
| `ANTHROPIC_API_KEY` | Alternative chat provider |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Alternative chat provider |

Trigger: **Actions → Gateway Smoke (LLM) → Run workflow**

The job starts Postgres + Redis, migrates, seeds, starts the API, and runs `test-gateway.sh`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Login failed | Run `make seed`; use `admin@smartroute.dev` / `admin123` |
| Chat returns 502/503 | No valid LLM key or provider outage |
| Cache always misses | Set `OPENAI_API_KEY` for embedding model |
| `curl: (7) Failed to connect` | API not running on `API_URL` |

## Related

- [`scripts/gateway-smoke-ci.sh`](../scripts/gateway-smoke-ci.sh) — no LLM keys
- [`scripts/test-gateway-ci.sh`](../scripts/test-gateway-ci.sh) — API key + chat auth only
- [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) — production deploy
- [`docs/PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md) — go-live checklist
