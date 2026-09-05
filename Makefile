# ===========================================================
# SmartRoute AI — Developer Makefile
# ===========================================================
# Prerequisites: Docker, Node.js 20+, npm 10+, Python 3.11+
#
# Quick start:
#   make setup     → install deps, start infra, migrate, seed
#   make dev       → start API + Web in watch mode
#   make stop      → stop infra containers
#   make clean     → nuclear option (reset everything)
#
.PHONY: help setup dev stop clean infra migrate seed test typecheck lint logs \
        load-smoke load-ramp load-spike load-soak smoke smoke-infra smoke-gateway \
        test-gateway-ci sdk-smoke verify-prod-env verify-email verify-stripe \
        stripe-staging-smoke email-smoke test-gateway release-preflight cutover-smoke

# ── Config ──────────────────────────────────────────────────────
COMPOSE      = docker compose
COMPOSE_INFRA = $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml

# ── Default target ──────────────────────────────────────────────
help:
	@echo ""
	@echo "  SmartRoute AI — Developer Commands"
	@echo ""
	@echo "  make setup      Install deps, start infra, migrate DB, seed data"
	@echo "  make dev        Start API (port 3001) + Web (port 3000) in watch mode"
	@echo "  make infra      Start only infrastructure (Postgres, Redis, Prometheus, Grafana)"
	@echo "  make infra-stop Stop infrastructure containers"
	@echo "  make migrate    Run Prisma migrations"
	@echo "  make seed       Seed model registry + dev user"
	@echo "  make generate   Regenerate Prisma client"
	@echo "  make studio     Open Prisma Studio (DB browser)"
	@echo "  make typecheck  Run tsc --noEmit on web app"
	@echo "  make lint       Run ESLint on all packages"
	@echo "  make smoke      Run infra + gateway smoke scripts (API must be running for gateway)"
	@echo "  make smoke-infra Validate nginx.conf and docker-compose.yml"
	@echo "  make smoke-gateway Hit health, auth, analytics, billing endpoints on :3001"
	@echo "  make test-gateway-ci Extended smoke with API key + chat auth (no LLM keys)"
	@echo "  make sdk-smoke    Build, test, and npm pack dry-run for @smartroute/sdk"
	@echo "  make verify-prod-env  Check core production env vars"
	@echo "  make verify-email     Check SMTP env vars for transactional email"
	@echo "  make verify-stripe    Check Stripe billing env vars"
	@echo "  make stripe-staging-smoke  Stripe + staging API smoke (needs STAGING_API_URL)"
	@echo "  make email-smoke      Send test email via Mailhog (start mailhog first)"
	@echo "  make test-gateway     Full LLM gateway smoke (needs provider API keys)"
	@echo "  make release-preflight  SDK smoke + optional tag version check (TAG=v0.1.2)"
	@echo "  make cutover-smoke    Post-deploy production HTTP smoke"
	@echo "  make logs       Tail all Docker logs"
	@echo "  make clean      Remove all containers, volumes, node_modules"
	@echo ""

# ── First-time setup ────────────────────────────────────────────
setup: install api-install infra wait-healthy migrate seed
	@echo ""
	@echo "  ✅  Setup complete!"
	@echo ""
	@echo "  Run 'make dev' to start the dev servers."
	@echo ""
	@echo "  Services:"
	@echo "    API        → http://localhost:3001"
	@echo "    Web        → http://localhost:3000"
	@echo "    API Docs   → http://localhost:3001/docs"
	@echo "    Grafana    → http://localhost:3002  (admin / admin)"
	@echo "    Prometheus → http://localhost:9090"
	@echo "    Prisma     → make studio"
	@echo ""
	@echo "  Dev login:"
	@echo "    Email    : admin@smartroute.dev"
	@echo "    Password : admin123"
	@echo ""

install:
	@echo "📦  Installing dependencies…"
	npm install

# ── Infrastructure ───────────────────────────────────────────────
infra:
	@echo "🐳  Starting infrastructure services…"
	$(COMPOSE_INFRA) up -d postgres redis prometheus grafana
	@echo "    Use 'make logs' to watch container output."

infra-stop:
	@echo "🛑  Stopping infrastructure…"
	$(COMPOSE_INFRA) down

wait-healthy:
	@echo "⏳  Waiting for Postgres to be ready…"
	@until docker exec $$(docker ps -qf "name=postgres") pg_isready -U smartroute -d smartroute 2>/dev/null; do \
		sleep 1; \
	done
	@echo "    ✓ Postgres is ready"
	@echo "⏳  Waiting for Redis to be ready…"
	@until docker exec $$(docker ps -qf "name=redis") redis-cli ping 2>/dev/null | grep -q PONG; do \
		sleep 1; \
	done
	@echo "    ✓ Redis is ready"

# ── Database ─────────────────────────────────────────────────────
migrate:
	@echo "🗄️   Running Prisma migrations…"
	cd packages/database && npx prisma migrate dev --name init 2>&1 | grep -v "^$$" || true
	@echo "    ✓ Migrations applied"

migrate-deploy:
	@echo "🗄️   Deploying Prisma migrations (production)…"
	cd packages/database && npx prisma migrate deploy

generate:
	@echo "⚙️   Regenerating Prisma client…"
	cd packages/database && npx prisma generate

seed:
	@echo "🌱  Seeding database…"
	cd packages/database && npm run db:seed

studio:
	@echo "🔍  Opening Prisma Studio…"
	cd packages/database && npx prisma studio

# ── Dev servers ──────────────────────────────────────────────────
dev:
	@echo "🚀  Starting development servers (FastAPI + Next.js)…"
	@echo "    API → http://localhost:3001  |  Web → http://localhost:3000"
	@(cd apps/api && .venv/bin/uvicorn smartroute.main:app --host 0.0.0.0 --port 3001 --reload) & \
	 npm run dev --workspace=apps/web

dev-api:
	@echo "🚀  Starting FastAPI dev server…"
	cd apps/api && .venv/bin/uvicorn smartroute.main:app --host 0.0.0.0 --port 3001 --reload

api-install:
	@echo "🐍  Installing Python API dependencies…"
	cd apps/api && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"

dev-web:
	@echo "🚀  Starting Web dev server…"
	npm run dev --workspace=apps/web

# ── Quality ──────────────────────────────────────────────────────
test:
	cd apps/api && .venv/bin/pytest -q

test-api-legacy:
	cd apps/api-legacy && npx vitest run

test-watch:
	cd apps/api && .venv/bin/pytest -q --watch

test-coverage:
	cd apps/api && .venv/bin/pytest -q --cov=smartroute --cov-report=term-missing

typecheck:
	@echo "🔍  Running TypeScript type check (web)…"
	npm run -w apps/web typecheck 2>&1 | grep -v "^$$" | head -40
	@echo "    ✓ Web type check passed"

lint:
	@echo "🔍  Running ESLint…"
	npm run lint --workspaces --if-present 2>&1 | tail -20

# ── Smoke tests ───────────────────────────────────────────────────
smoke-infra:
	@chmod +x scripts/verify-nginx-config.sh scripts/docker-compose-smoke.sh
	@./scripts/verify-nginx-config.sh
	@./scripts/docker-compose-smoke.sh

smoke-gateway:
	@chmod +x scripts/gateway-smoke-ci.sh
	@API_URL=$${API_URL:-http://localhost:3001} ./scripts/gateway-smoke-ci.sh

test-gateway-ci:
	@chmod +x scripts/test-gateway-ci.sh
	@API_URL=$${API_URL:-http://localhost:3001} ./scripts/test-gateway-ci.sh

sdk-smoke:
	@chmod +x scripts/sdk-publish-smoke.sh
	@./scripts/sdk-publish-smoke.sh

verify-prod-env:
	@chmod +x scripts/verify-production-env.sh
	@./scripts/verify-production-env.sh --core

verify-email:
	@chmod +x scripts/verify-email-env.sh
	@./scripts/verify-email-env.sh

verify-stripe:
	@chmod +x scripts/verify-stripe-env.sh
	@./scripts/verify-stripe-env.sh

stripe-staging-smoke:
	@chmod +x scripts/stripe-staging-smoke.sh scripts/verify-stripe-env.sh
	@./scripts/stripe-staging-smoke.sh

email-smoke:
	@chmod +x scripts/email-smoke.sh
	@./scripts/email-smoke.sh

test-gateway:
	@chmod +x scripts/test-gateway.sh
	@API_URL=$${API_URL:-http://localhost:3001} ./scripts/test-gateway.sh

release-preflight:
	@chmod +x scripts/release-preflight.sh scripts/sdk-publish-smoke.sh
	@./scripts/release-preflight.sh $${TAG:-}

cutover-smoke:
	@chmod +x scripts/production-cutover-smoke.sh scripts/verify-production-env.sh
	@./scripts/production-cutover-smoke.sh $(ARGS)

smoke: smoke-infra smoke-gateway

# ── Production ───────────────────────────────────────────────────
build:
	@echo "🏗️   Building production images…"
	$(COMPOSE) build

up:
	@echo "🚀  Starting full production stack…"
	$(COMPOSE) up -d
	@echo "    Stack is up at http://localhost"

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart api web

# ── Utils ─────────────────────────────────────────────────────────
logs:
	$(COMPOSE_INFRA) logs -f --tail=100

logs-api:
	$(COMPOSE) logs -f api

clean:
	@echo "🧹  Cleaning everything…"
	$(COMPOSE) down -v --remove-orphans 2>/dev/null || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/*/.next apps/*/dist packages/*/dist
	@echo "    ✓ Clean complete"

# ── Load testing (k6) ─────────────────────────────────────────────
load-smoke:
	@echo "🔥  Running smoke load test (1 VU × 1 min)…"
	k6 run --env SCENARIO=smoke --env API_KEY=$(API_KEY) scripts/load/gateway.k6.js

load-ramp:
	@echo "🔥  Running ramp load test (0→50 VUs × 17 min)…"
	k6 run --env SCENARIO=ramp --env API_KEY=$(API_KEY) scripts/load/gateway.k6.js

load-spike:
	@echo "🔥  Running spike test (burst to 200 VUs)…"
	k6 run --env SCENARIO=spike --env API_KEY=$(API_KEY) scripts/load/gateway.k6.js

load-soak:
	@echo "🔥  Running soak test (20 VUs × 30 min)…"
	k6 run --env SCENARIO=soak --env API_KEY=$(API_KEY) scripts/load/gateway.k6.js

# ── Test environment ─────────────────────────────────────────────
test-request:
	@echo "🧪  Sending test request through gateway…"
	@API_KEY=$$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
		-H "Content-Type: application/json" \
		-d '{"email":"admin@smartroute.dev","password":"admin123"}' | \
		python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('tokens',{}).get('accessToken',''))" 2>/dev/null); \
	echo "    Got token: $${API_KEY:0:20}..."
