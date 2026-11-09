# SmartRoute AI — Production-Grade AI Gateway & Cost Optimization Platform

> **Reduce AI spending by 30–60% while maintaining response quality.**

SmartRoute AI is a self-hosted API gateway that sits in front of your LLM providers (OpenAI, Anthropic, Google Gemini, Cohere, Mistral, Ollama) and adds intelligent routing, semantic caching, budget management, rate limiting, circuit breaking, and full observability — all in one stack.

## Links

- **Portfolio**: https://portfolio-website-master-wxeo.vercel.app/
- **SmartSpidy** (related RAG product): https://smartspidy.smartbrew.in/
- **This repo**: https://github.com/Ayush701-code-zm/LLM-Gatway

---

## Architecture Overview

```
Client App
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Gateway (FastAPI)                   │
│  JWT Auth │ API Key Auth │ Rate Limiter │ Budget Guard       │
│                           │                                  │
│         ┌─────────────────┼──────────────┐                  │
│         ▼                 ▼              ▼                   │
│   Semantic Cache    Complexity      Routing Engine           │
│   (pgvector)        Classifier      (cost/latency/          │
│                     (heuristic)      round-robin)            │
│                                       │                      │
│              ┌────────────────────────┤                      │
│              ▼           ▼            ▼                      │
│           OpenAI     Anthropic    Google/Ollama              │
│              │                                               │
│         Circuit Breaker + Retry + Fallback                   │
│              │                                               │
│    ┌─────────┴───────────────┐                              │
│    ▼                         ▼                               │
│  Prometheus               Celery Workers                     │
│  (Grafana)             (analytics, health,                   │
│                         budget alerts,                        │
│                         cache maintenance)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Python 3.12 |
| **Framework** | FastAPI + Pydantic v2 |
| **Database** | PostgreSQL 16 + SQLAlchemy async + pgvector |
| **Cache** | Redis 7 (rate limiting, circuit breaker state, semantic cache) |
| **Queues** | Celery + Redis (analytics, health checks, budget alerts, cache maintenance) |
| **Frontend** | Next.js 15, Zustand, TailwindCSS, Recharts |
| **Observability** | Prometheus + Grafana (14-panel dashboard) |
| **Testing** | pytest (API), Playwright E2E (27 specs) |
| **Auth** | JWT + Refresh Tokens + bcrypt |
| **Monorepo** | npm workspaces (web/sdk) + Python API |
| **DevOps** | Docker Compose, Nginx, Makefile |

---

## Core Features

### Intelligent Routing
- **Complexity Classification** — heuristic scorer (keyword signals + length) routes simple prompts to cheap models, complex to capable ones
- **Cost-Optimized routing** — always picks the cheapest model that meets quality requirements
- **Round-Robin / Balanced / Performance** strategies — configurable per workspace
- **Fallback routing** — automatically tries alternate providers when one fails

### Cost Optimization
- **Semantic Cache** — embeddings stored in pgvector; similar queries return cached responses (no LLM call)
- **Baseline vs. actual cost tracking** — every request records what it *would* have cost vs. what it *did* cost
- **Savings attribution** — routing savings and cache savings tracked separately in Prometheus

### Reliability
- **Circuit Breaker** (Redis-backed): CLOSED → OPEN → HALF_OPEN state machine with configurable thresholds
- **Exponential backoff retries** with jitter
- **Rate limiter** — sliding-window RPM/RPD/TPM per workspace (Redis pipeline, <1ms overhead)
- **Budget guard** — blocks requests when workspace budget is exhausted; fires WARNING/CRITICAL alerts at 80%/90%
- **Idempotency** — `Idempotency-Key` header deduplicates identical concurrent requests; replayed responses returned in <1ms
- **Request coalescing** — identical in-flight concurrent requests are deduplicated at the process level (SHA-256 keyed)

### Security
- **Prompt injection guard** — 15-signal regex scorer; blocks jailbreak/role-override/exfiltration patterns before the LLM call. Configurable `BLOCK_THRESHOLD` (default 0.70) and `WARN_THRESHOLD` (0.40). Fail-open by design
- **HMAC-SHA256 signed webhooks** — every outbound webhook POST is signed; recipients can verify authenticity with a timing-safe comparison
- **Audit log** — immutable record of every workspace action (API key creation, budget changes, member updates, etc.)

### Observability
- **Prometheus metrics**: request rate, latency histograms, cost, savings, cache hit-rate, circuit breaker state, provider availability, queue depths, active connections
- **Grafana dashboard** — 14 pre-built panels, auto-provisioned
- **Request tracing** — every request gets a `requestId` + `traceId` header; full trace stored in DB
- **Structured logging** (Pino) — JSON logs with severity, context, and performance timings

### Multi-Tenancy
- **Workspaces** with members and roles (OWNER, ADMIN, MEMBER, VIEWER)
- **Per-workspace API keys** with scoped permissions and rotation
- **Per-workspace budgets** with period tracking (daily/weekly/monthly/annual)
- **Per-workspace rate limit overrides** (or use plan defaults)

### Webhooks & Alerting
- **Webhook delivery system** — configurable HTTP callbacks for `budget.warning`, `budget.critical`, `anomaly.detected` events; HMAC-signed, retry on failure, auto-disable after 3 consecutive failures
- **Anomaly detection** — Celery worker scans all workspaces every 15 min for cost spikes (3×), volume spikes (3×), latency spikes (2×), and error surges (>20%); fires webhook + in-app notification with 60-min cooldown

---

## Project Structure

```
LLM Gatway/
├── apps/
│   ├── api/                    # FastAPI backend (Python)
│   │   ├── Dockerfile          # Production image (uvicorn)
│   │   ├── pyproject.toml
│   │   ├── tests/              # pytest
│   │   └── smartroute/
│   │       ├── config/         # env, redis, logger, metrics
│   │       ├── engines/        # circuitBreaker, complexityClassifier,
│   │       │                   # rateLimiter, routingEngine, budgetGuard,
│   │       │                   # anomalyDetector
│   │       ├── providers/      # openai, anthropic, google, ollama
│   │       ├── services/       # auth, gateway, apiKey, webhook, saml
│   │       ├── routes/         # auth, chat, workspace, analytics, …
│   │       ├── middleware/     # auth, gateway guards, idempotency
│   │       └── workers/        # Celery tasks (analytics, health, budget, cache)
│   ├── api-legacy/             # Archived Express/TypeScript API (reference only)
│   │   └── src/                # archived Express + BullMQ (vitest ~284 tests)
│   └── web/                    # Next.js 15 dashboard
│       └── src/
│           ├── app/(auth)/     # login, register pages
│           ├── app/(dashboard) # dashboard, analytics, reliability, models, …
│           ├── components/     # ui/ + dashboard/ charts
│           ├── store/          # Zustand auth store
│           ├── lib/            # typed API client
│           └── hooks/          # useApi, useMutation
├── packages/
│   ├── database/               # Prisma schema (21 tables), migrations, seed
│   └── shared/                 # TypeScript types, Zod schemas, constants
├── infra/
│   ├── prometheus/             # prometheus.yml
│   └── grafana/                # provisioning datasources + dashboards
├── scripts/
│   ├── dev-setup.sh            # one-command first-time setup
│   ├── e2e-ci.sh               # Playwright E2E + gateway smoke CI
│   ├── gateway-smoke-ci.sh     # health, login, admin (no LLM keys)
│   ├── test-gateway-ci.sh      # extended smoke: API key + chat auth (no LLM keys)
│   ├── sdk-publish-smoke.sh    # SDK build, test, npm pack dry-run
│   ├── docker-compose-smoke.sh # compose config + healthcheck validation
│   ├── verify-nginx-config.sh  # nginx.conf syntax check
│   ├── verify-production-env.sh # core prod env preflight (--email, --stripe, --all)
│   ├── verify-email-env.sh     # SMTP vars for transactional email
│   ├── verify-stripe-env.sh    # Stripe billing env vars
│   ├── email-smoke.sh          # Mailhog SMTP delivery smoke
│   ├── release-preflight.sh    # tag ↔ SDK version + publish smoke
│   ├── production-cutover-smoke.sh # post-deploy HTTP validation
│   ├── test-gateway.sh         # full smoke (login → API key → chat → cache)
│   └── stripe-staging-smoke.sh # staging health + billing checks
├── docs/
│   ├── DEPLOYMENT.md           # production runbook
│   ├── PRODUCTION_CUTOVER.md   # go-live checklist (Stripe, IdP, deploy)
│   ├── RELEASE.md              # semver release checklist
│   ├── GATEWAY_SMOKE.md        # full LLM test-gateway.sh guide
│   ├── DPA.md                  # data processing agreement
│   ├── SUBPROCESSORS.md        # subprocessor list
│   ├── STRIPE.md               # Stripe local dev guide
│   └── curl-cheatsheet.md      # all API examples
├── docker-compose.yml          # production stack
├── docker-compose.dev.yml      # development stack (Postgres, Redis, Grafana)
└── Makefile                    # common dev commands
```

---

## Quick Start

### Prerequisites
- Node.js 22+, npm 10+, Python 3.11+, Docker

### One-command setup
```bash
git clone <repo>
cd "LLM Gatway"
chmod +x scripts/dev-setup.sh
./scripts/dev-setup.sh
```

This script:
1. Checks prerequisites
2. Installs npm dependencies
3. Copies `.env.example` → `.env` with secure random secrets
4. Starts Postgres, Redis, Prometheus, Grafana via Docker Compose
5. Runs Prisma migrations
6. Seeds model registry (~18 models) + demo user
7. Opens the dashboard URL

### Manual setup
```bash
# Install dependencies
npm install

# Start infrastructure (Postgres + Redis + Grafana)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Configure environment
cp .env.example .env
# Edit .env: add OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY

# Run migrations + seed
npm run db:migrate
npm run db:seed

# Install Python API + start dev servers (FastAPI :3001 + Next.js :3000)
make api-install
make dev
```

### Default credentials (seed)
| Field | Value |
|---|---|
| Email | `admin@smartroute.dev` |
| Password | `admin123` |

---

## Running Tests

```bash
# Python API tests (pytest)
make test

# Python API coverage
make test-coverage

# Legacy Express API tests (archived — optional regression)
make test-api-legacy

# SDK tests (7 passing)
npm run test --workspace=@smartroute/sdk

# SDK publish readiness (build + test + npm pack dry-run)
./scripts/sdk-publish-smoke.sh

# E2E (requires Postgres + Redis; starts FastAPI + web automatically)
chmod +x scripts/e2e-ci.sh
./scripts/e2e-ci.sh

# E2E specs (27): public, dashboard, register, login, invite, settings, workspace,
# notifications, saml, billing, mfa, admin, oauth, scim, sessions, webhooks,
# api-keys, analytics, requests, providers, cache, reliability, audit-log, team,
# anomalies, models, cost-explorer
npm run test:e2e -- e2e/public.spec.ts

# Gateway API smoke — CI subset (no LLM keys)
API_URL=http://localhost:3001 ./scripts/gateway-smoke-ci.sh

# Extended gateway smoke — API key create + chat auth (no LLM keys)
API_URL=http://localhost:3001 ./scripts/test-gateway-ci.sh

# Infra config smoke (nginx + docker-compose)
make smoke-infra

# Full smoke (infra + gateway; API must be running)
make smoke

# Full gateway smoke with real LLM chat + semantic cache (requires provider keys)
make test-gateway
# See docs/GATEWAY_SMOKE.md

# Local SMTP smoke via Mailhog
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mailhog
make email-smoke

# Stripe staging smoke (remote API + Stripe env vars)
make stripe-staging-smoke

# Release preflight before tagging
TAG=v0.1.3 make release-preflight
```

### Test coverage
| Module | Tests | Type |
|---|---|---|
| Python API (`apps/api`) | pytest | Unit + integration |
| Legacy Express (`apps/api-legacy`) | ~284 | vitest (archived) |
| `@smartroute/sdk` | 7 | Unit |
| Playwright E2E | 53 tests / 27 spec files | Browser |

---

## API Reference

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Create account + workspace (optional `workspaceSlug`) |
| `POST` | `/api/v1/auth/login` | Get JWT tokens |
| `POST` | `/api/v1/auth/refresh` | Refresh access token |
| `POST` | `/api/v1/auth/logout` | Revoke refresh token |

### Gateway
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/chat` | API Key | Blocking chat completion |
| `POST` | `/api/v1/chat/stream` | API Key | SSE streaming chat |

### Analytics
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/analytics/overview` | 30-day summary stats |
| `GET` | `/api/v1/analytics/spend/daily?days=30` | Per-day breakdown |
| `GET` | `/api/v1/analytics/reliability?days=30` | Fallback, retry, circuit breaker stats |
| `GET` | `/api/v1/analytics/usage?days=30` | Usage metrics time-series (cost, requests, latency) |
| `GET` | `/api/v1/analytics/anomalies?days=30` | Anomaly detection alerts |
| `GET` | `/api/v1/analytics/providers` | Per-provider breakdown |
| `GET` | `/api/v1/analytics/export?format=csv` | CSV export for BI tools |
| `GET` | `/api/v1/analytics/requests` | Paginated request history |

### Workspace Settings
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/workspaces/current` | Workspace info + members |
| `PATCH` | `/api/v1/workspaces/current` | Update name, slug, routing strategy, cache, rate limits |
| `GET` | `/api/v1/workspaces/current/budgets` | Active budgets + alerts |
| `POST` | `/api/v1/workspaces/current/budgets` | Create a budget |
| `GET` | `/api/v1/workspaces/current/rate-limits` | Live rate-limit consumption (Redis) |
| `GET` | `/api/v1/workspaces/current/health` | Provider health status |

### API Keys
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/api-keys` | List all keys |
| `POST` | `/api/v1/api-keys` | Create key (returns raw key once) |
| `DELETE` | `/api/v1/api-keys/:id` | Revoke key |
| `POST` | `/api/v1/api-keys/:id/rotate` | Rotate key |

### Billing
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/billing/plans` | Available plans (public) |
| `GET` | `/api/v1/billing/status` | Current plan + Stripe config status |
| `POST` | `/api/v1/billing/checkout` | Stripe Checkout session (owner only) |
| `POST` | `/api/v1/billing/portal` | Stripe customer portal (owner only) |

### Auth (MFA)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/auth/mfa/status` | MFA enabled + backup codes remaining |
| `POST` | `/api/v1/auth/mfa/setup` | Start TOTP setup (returns otpauth URL) |
| `POST` | `/api/v1/auth/mfa/confirm` | Confirm setup with 6-digit code |
| `POST` | `/api/v1/auth/mfa/disable` | Disable MFA (password + code) |
| `POST` | `/api/v1/auth/mfa/verify-login` | Complete login after MFA challenge |

### Team invites
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/workspaces/current/members/invites` | List pending invites (admin) |
| `DELETE` | `/api/v1/workspaces/current/members/invites/:token` | Revoke a pending invite |
| `POST` | `/api/v1/workspaces/current/members/:userId/transfer-ownership` | Transfer workspace ownership (owner) |
| `POST` | `/api/v1/workspaces/current/members/leave` | Leave workspace (switches JWT if others remain) |

### Sessions
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/auth/sessions` | List active refresh-token sessions |
| `DELETE` | `/api/v1/auth/sessions/:id` | Revoke a specific session |
| `POST` | `/api/v1/auth/sessions/revoke-others` | Sign out all other devices |

### Audit log export
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/workspaces/current/audit-logs/export?format=csv` | Download audit log as CSV (last 30 days by default) |

Stripe local setup: see [docs/STRIPE.md](docs/STRIPE.md) · Production checklist: [docs/STRIPE_PRODUCTION.md](docs/STRIPE_PRODUCTION.md)

### GDPR / data privacy
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/auth/me/export` | Download user profile, memberships, sessions as JSON |
| `DELETE` | `/api/v1/auth/me` | Soft-delete account (password required) |

### Enterprise SSO & SCIM
| Method | Endpoint | Description |
|---|---|---|
| `GET/PATCH` | `/api/v1/workspaces/current/sso` | Configure SAML IdP metadata (Enterprise) |
| `GET` | `/api/v1/auth/saml/discover?workspace=slug` | Check SSO availability on login |
| `GET/PATCH` | `/api/v1/workspaces/current/scim` | SCIM bearer token management |
| `*` | `/scim/v2/Users` | SCIM 2.0 user provisioning (Bearer `sr_scim_…`) |

Guides: [docs/SSO.md](docs/SSO.md) · [docs/SCIM.md](docs/SCIM.md)

Full Swagger UI: [http://localhost:3001/docs](http://localhost:3001/docs)

---

## Available Make Commands

```
make setup          # First-time dev environment setup
make dev            # Start FastAPI (uvicorn) + web in watch mode
make dev-api        # FastAPI only
make api-install    # Create venv + pip install apps/api
make infra          # Start Docker infrastructure
make migrate        # Run Prisma migrations
make seed           # Seed model registry + demo user
make typecheck      # TypeScript type check (web app)
make test           # pytest (Python API)
make test-api-legacy # vitest (archived Express API)
make test-coverage  # pytest with coverage
make smoke          # Infra + gateway smoke (API must be running for gateway)
make smoke-infra    # nginx.conf + docker-compose validation
make smoke-gateway  # Health, auth, analytics, billing endpoints
make test-gateway-ci # Extended smoke: API key lifecycle + chat auth
make sdk-smoke      # @smartroute/sdk build, test, pack dry-run
make verify-prod-env # Core production env preflight
make verify-email    # SMTP vars for invites, reset, alerts
make verify-stripe   # Stripe billing env vars
make stripe-staging-smoke # Remote staging API + Stripe checks
make email-smoke     # Mailhog SMTP delivery test
make test-gateway    # Full LLM chat + cache smoke
make release-preflight # Pre-tag SDK + env checks (TAG=v0.1.2)
make cutover-smoke   # Post-deploy production HTTP smoke
make lint           # ESLint check
make logs           # Tail Docker container logs
make clean          # Remove build artifacts + node_modules
```

---

## Monitoring

| Service | URL | Credentials |
|---|---|---|
| Dashboard | http://localhost:3000 | your login |
| API | http://localhost:3001 | API key |
| Swagger UI | http://localhost:3001/docs | — |
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3002 | admin / admin |
| Mailhog (dev SMTP) | http://localhost:8025 | — |

---

## Production Launch Checklist

Use this after local dev and test/smoke CI are green. Full runbook: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Complete go-live guide: [docs/PRODUCTION_CUTOVER.md](docs/PRODUCTION_CUTOVER.md).

| Step | Command / doc |
|------|----------------|
| Core env preflight | `make verify-prod-env` |
| Transactional email | `make verify-email` — local test: `make email-smoke` (Mailhog) |
| Stripe billing (optional) | `make verify-stripe` — [STRIPE_PRODUCTION.md](docs/STRIPE_PRODUCTION.md) |
| Staging smoke | `make stripe-staging-smoke` — [STRIPE_STAGING.md](docs/STRIPE_STAGING.md) |
| Release tag | `TAG=v0.1.2 make release-preflight` — [RELEASE.md](docs/RELEASE.md) |
| SDK npm publish | `NPM_TOKEN` + tag `v*.*.*` — [NPM_PUBLISH.md](docs/NPM_PUBLISH.md) |
| Compliance pages | `/privacy`, `/dpa`, `/subprocessors` (E2E in `e2e/public.spec.ts`) |
| Full LLM gateway smoke | `make test-gateway` — [GATEWAY_SMOKE.md](docs/GATEWAY_SMOKE.md) |
| Post-deploy validation | `make cutover-smoke` — [PRODUCTION_CUTOVER.md](docs/PRODUCTION_CUTOVER.md) |

### Optional GitHub Actions (manual dispatch)

| Workflow | Secrets required |
|----------|------------------|
| `staging-smoke.yml` | `STAGING_API_URL`, Stripe vars |
| `gateway-smoke.yml` | `OPENAI_API_KEY` and/or other LLM keys |

---

## Engineering Decisions Worth Discussing

### Why Redis for circuit breaker state?
The circuit breaker state must be **shared across all API server instances** (for horizontal scaling). Storing it in Redis with a TTL slightly longer than the open timeout means: if Redis is down, we fail open (CLOSED state) to avoid blocking all traffic.

### Why Celery for analytics instead of direct DB writes?
Every chat request would otherwise block on 3+ database writes (request log, budget update, metrics). Celery decouples the hot path from persistence. The gateway service pushes a single lightweight task and returns the response to the user in ~10ms of added latency. Workers process the batch asynchronously.

### Why pgvector for semantic cache?
Vector similarity search directly in Postgres avoids an additional infrastructure dependency (Pinecone, Weaviate). For typical workloads (<10M cached entries), pgvector with an IVFFLAT index delivers sub-millisecond lookups. The threshold (default 0.92 cosine similarity) is tunable per workspace.

### Why heuristic complexity classification instead of ML?
A lightweight ML model (e.g., DistilBERT) would be more accurate, but adds 200ms cold-start latency and requires GPU infrastructure. The heuristic (keyword signals + token count) runs in <1ms and catches ~85% of classification decisions correctly — good enough for the cost savings it drives. The architecture is designed so the classifier is swappable.

### Why sliding-window rate limiter instead of token bucket?
Sliding-window (Redis `INCR` + `EXPIRE` on minute/day keys) is simpler to reason about and debug. Token bucket is more burst-friendly but requires atomic operations and careful precision. For an API gateway where the exact window matters to customers, sliding-window is the better UX choice.

### Why fail-open on the prompt injection guard?
The guard is a defence-in-depth layer, not the last line of defence. If the guard itself throws (Redis unavailable, regex engine crash), blocking legitimate requests would break the product. We log the failure and let the request through — the LLM's own safety training is still in effect.

### Why heuristic anomaly detection instead of ML-based?
Statistical z-score / rolling average anomaly detection is deterministic, explainable, and has zero cold-start time. ML-based anomaly detection requires labelled training data and adds inference latency. The 7-day rolling baseline + ratio threshold approach catches 95%+ of real-world cost spikes and is easy to explain to a customer support team.

### Why 60-min cooldown on anomaly alerts?
Without a cooldown, a sustained anomaly would generate one alert per 15-minute scan cycle — 4 per hour — which creates alert fatigue. The cooldown ensures that once a workspace is notified, they have an hour to investigate before being notified again. The cooldown key is stored in Redis with a TTL, so it automatically expires.
