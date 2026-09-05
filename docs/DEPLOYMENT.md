# SmartRoute AI — Production Deployment Runbook

This guide covers deploying SmartRoute AI to a production environment (Docker Compose or Kubernetes). For local development, see the root [README](../README.md).

---

## Prerequisites

| Component | Version | Notes |
|-----------|---------|-------|
| Python | 3.11+ | FastAPI API server |
| Node.js | 20 LTS | Web dashboard build |
| PostgreSQL | 15+ | With `pgvector` extension |
| Redis | 7+ | **`maxmemory-policy noeviction`** required for Celery + rate limiting |
| SMTP | — | Required for invites, budget alerts, password reset |

---

## Environment Variables

Copy `.env.example` to `.env` and set production values. Critical variables:

```bash
# Core
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/smartroute
REDIS_URL=redis://host:6379

# Auth
JWT_SECRET=<64+ char random string>
JWT_EXPIRES_IN=15m

# API / Web URLs (used in emails, OAuth redirects, Stripe)
API_BASE_URL=https://api.yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com

# LLM providers (at least one)
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_AI_API_KEY=...

# Email (required for password reset & team invites)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=noreply@yourdomain.com

# Optional: Stripe billing
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PRICE_PRO=...

# Optional: Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_OAUTH_CALLBACK_URL=https://api.yourdomain.com/api/v1/auth/oauth/google/callback
```

Never commit `.env` files. Use your platform's secret manager (AWS Secrets Manager, GCP Secret Manager, Doppler, etc.).

### Preflight scripts

Before your first production deploy, run these from the repo root (with production `.env` loaded):

```bash
make verify-prod-env   # DATABASE_URL, Redis, JWT secrets, encryption key, public URLs
make verify-email      # SMTP — required for password reset & team invites
make verify-stripe     # Stripe — required only if billing is enabled
```

Or run everything at once:

```bash
./scripts/verify-production-env.sh --all
```

### Local email testing (Mailhog)

Start Mailhog with dev infrastructure:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mailhog
make email-smoke
```

Mailhog UI: http://localhost:8025 · SMTP: `localhost:1025`

See also [STRIPE_PRODUCTION.md](./STRIPE_PRODUCTION.md) and [NPM_PUBLISH.md](./NPM_PUBLISH.md). Production cutover: [PRODUCTION_CUTOVER.md](./PRODUCTION_CUTOVER.md).

---

## Database Setup

1. Create a PostgreSQL database with the `vector` extension enabled.
2. Run migrations from the repo root:

```bash
cd packages/database
npx prisma migrate deploy
npx prisma db seed   # optional: demo workspace + admin user
```

3. Verify `pgvector` is installed:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## Build & Deploy

### Docker Compose (single host)

```bash
docker compose -f docker-compose.yml up -d postgres redis api web
```

Or run locally without Docker for the app tier:

```bash
make api-install
make migrate-deploy
cd apps/api && .venv/bin/uvicorn smartroute.main:app --host 0.0.0.0 --port 3001
npm run start --workspace=@smartroute/web
```

Build the API image from the repo root:

```bash
docker build -f apps/api/Dockerfile -t smartroute-api:latest .
```

Expose:
- **API** on port `3001` (or behind reverse proxy)
- **Web dashboard** on port `3000`
- **Grafana** on port `3002` (optional observability stack)

### Reverse proxy (recommended)

Place nginx, Caddy, or a cloud load balancer in front:

| Path | Backend |
|------|---------|
| `https://app.yourdomain.com/*` | Next.js `:3000` |
| `https://api.yourdomain.com/*` | FastAPI (uvicorn) `:3001` |

Enable TLS termination, HTTP/2, and rate limiting at the edge.

Validate the bundled config before deploy:

```bash
chmod +x scripts/verify-nginx-config.sh
./scripts/verify-nginx-config.sh
```

See `infra/nginx/nginx.conf` for the Docker Compose reverse-proxy setup (`api:3001`, `web:3000` upstreams).

Validate Compose structure before deploy:

```bash
chmod +x scripts/docker-compose-smoke.sh
./scripts/docker-compose-smoke.sh
```

---

## Redis Configuration

Celery task queues require Redis **not** to evict keys under memory pressure:

```
maxmemory-policy noeviction
```

The included `docker-compose.yml` sets this. If using managed Redis (ElastiCache, Upstash, etc.), confirm the policy in your provider console.

---

## Health Checks

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness — API process up |
| `GET /ready` | Readiness — DB + Redis connected |

Configure your orchestrator to probe these before routing traffic.

---

## Stripe Webhooks (optional)

If billing is enabled:

1. Create a Stripe webhook pointing to `https://api.yourdomain.com/api/v1/billing/webhook`
2. Subscribe to: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
3. Set `STRIPE_WEBHOOK_SECRET` from the Stripe dashboard

---

## Observability

- **Prometheus metrics**: `GET /metrics` on the API
- **Grafana**: import dashboards from `infra/grafana/` (dev default: `http://localhost:3002`)
- **Structured logs**: JSON via Pino; ship to your log aggregator (Datadog, Loki, CloudWatch)

Key metrics to alert on:
- `smartroute_llm_request_duration_seconds` p99 latency
- Circuit breaker OPEN events
- Budget alert queue depth
- Redis connection errors

---

## Backup & Recovery

| Data | Strategy |
|------|----------|
| PostgreSQL | Daily automated snapshots + point-in-time recovery |
| Redis | Ephemeral (queues/cache); no backup required for core operation |
| API keys | Stored hashed only — users must rotate if DB is compromised |

Test restore quarterly.

---

## Security Checklist

- [ ] Strong `JWT_SECRET` (rotate on compromise)
- [ ] TLS everywhere (no plain HTTP in production)
- [ ] CORS restricted to your dashboard origin
- [ ] Provider API keys in secrets manager, not env files on disk
- [ ] Rate limits configured per workspace (`settings` page)
- [ ] SMTP credentials scoped to send-only
- [ ] Database network isolated (no public ingress)

---

## Rolling Updates

1. Run migrations: `npx prisma migrate deploy`
2. Deploy new API containers; wait for `/ready`
3. Deploy new web containers
4. Monitor error rates for 15 minutes post-deploy

Zero-downtime requires at least two API replicas behind a load balancer with graceful shutdown (finish in-flight requests before SIGTERM).

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Celery "eviction policy" warning | Redis `maxmemory-policy` not `noeviction` |
| Password reset emails not sent | SMTP vars missing; check API logs for dev reset URL |
| OAuth redirect mismatch | `GOOGLE_OAUTH_CALLBACK_URL` must match Google Console exactly |
| 401 on dashboard after workspace switch | Clear localStorage / re-login; verify JWT includes new `workspaceId` |
| Provider 429 errors | Circuit breaker will open; check `/reliability` page |

---

## Support

For compliance documentation see [DPA](./DPA.md) and [Subprocessors](./SUBPROCESSORS.md).
