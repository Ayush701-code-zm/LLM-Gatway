#!/usr/bin/env bash
# ===========================================================
# SmartRoute AI — Development Environment Setup
#
# Usage:
#   ./scripts/dev-setup.sh
#
# What this script does:
#   1. Checks prerequisites (Node.js, Python 3.11+, Docker, npm)
#   2. Creates .env from .env.example if missing
#   3. Installs npm dependencies + Python API venv
#   4. Starts infrastructure (Postgres + Redis + Grafana + Prometheus)
#   5. Waits for services to be healthy
#   6. Runs Prisma migrations
#   7. Generates Prisma client
#   8. Seeds the database (model registry + dev user)
# ===========================================================

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${BLUE}ℹ  $1${NC}"; }
success() { echo -e "${GREEN}✓  $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠  $1${NC}"; }
error()   { echo -e "${RED}✗  $1${NC}"; exit 1; }

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     SmartRoute AI — Dev Setup         ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════╝${NC}"
echo ""

# ── Prerequisites ──────────────────────────────────────────────

info "Checking prerequisites…"

command -v node >/dev/null 2>&1 || error "Node.js is not installed. Install v20+: https://nodejs.org"
command -v npm  >/dev/null 2>&1 || error "npm is not installed."
command -v python3 >/dev/null 2>&1 || error "Python 3 is not installed. Install 3.11+: https://python.org"
command -v docker >/dev/null 2>&1 || error "Docker is not installed. Install: https://docs.docker.com/get-docker/"

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  error "Node.js 20+ required. Current version: $(node --version)"
fi

PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)
if [ "$PYTHON_MAJOR" -lt 3 ] || { [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 11 ]; }; then
  error "Python 3.11+ required. Current version: $PYTHON_VERSION"
fi

success "Node.js $(node --version) ✓"
success "npm $(npm --version) ✓"
success "Python $PYTHON_VERSION ✓"
success "Docker $(docker --version | cut -d' ' -f3 | tr -d ',') ✓"

# ── .env file ─────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f ".env" ]; then
  info "Creating .env from .env.example…"
  cp .env.example .env

  # Generate secure secrets
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWT_REFRESH=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  API_KEY_SECRET=$(openssl rand -hex 16 2>/dev/null | head -c 32 || node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

  # Replace placeholder secrets
  sed -i.bak "s/change-me-to-a-256-bit-random-secret/${JWT_SECRET}/" .env
  sed -i.bak "s/change-me-to-another-256-bit-random-secret/${JWT_REFRESH}/" .env
  sed -i.bak "s/change-me-32-char-aes-secret-here/${API_KEY_SECRET}/" .env
  rm -f .env.bak

  success ".env created with generated secrets"
  warn "Add your LLM API keys to .env:"
  warn "  OPENAI_API_KEY=sk-..."
  warn "  ANTHROPIC_API_KEY=sk-ant-..."
  warn "  GOOGLE_GENERATIVE_AI_API_KEY=AIza..."
else
  success ".env already exists"
fi

# ── npm install ────────────────────────────────────────────────

info "Installing npm dependencies…"
npm install --prefer-offline 2>&1 | tail -3
success "npm dependencies installed"

info "Installing Python API dependencies…"
(cd apps/api && python3 -m venv .venv && .venv/bin/pip install -q -e ".[dev]")
success "Python API venv ready (apps/api/.venv)"

# ── Infrastructure ─────────────────────────────────────────────

info "Starting infrastructure services (Postgres, Redis, Prometheus, Grafana)…"
if ! docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis prometheus grafana 2>&1 | grep -E "(Starting|Started|healthy|Error|error|Creating|Created)" || true; then
  warn "docker compose returned a non-zero exit code — check output above"
fi

# Fail fast if compose file is invalid or containers did not start
if ! docker compose -f docker-compose.yml -f docker-compose.dev.yml ps postgres 2>/dev/null | grep -qE 'Up|running'; then
  error "PostgreSQL container did not start. Run: docker compose -f docker-compose.yml -f docker-compose.dev.yml logs postgres"
fi

# ── Wait for healthy ───────────────────────────────────────────

info "Waiting for PostgreSQL to be ready…"
MAX_RETRIES=30
RETRIES=0
until docker exec "$(docker ps -qf 'name=postgres')" pg_isready -U smartroute -d smartroute 2>/dev/null; do
  RETRIES=$((RETRIES + 1))
  if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
    error "PostgreSQL did not become ready. Check: docker logs \$(docker ps -qf 'name=postgres')"
  fi
  sleep 2
done
success "PostgreSQL ready"

info "Waiting for Redis to be ready…"
RETRIES=0
REDIS_CID="$(docker compose -f docker-compose.yml -f docker-compose.dev.yml ps -q redis 2>/dev/null || true)"
until [ -n "$REDIS_CID" ] && docker exec "$REDIS_CID" redis-cli ping 2>/dev/null | grep -q PONG; do
  RETRIES=$((RETRIES + 1))
  if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
    error "Redis did not become ready. Check: docker compose -f docker-compose.yml -f docker-compose.dev.yml logs redis"
  fi
  REDIS_CID="$(docker compose -f docker-compose.yml -f docker-compose.dev.yml ps -q redis 2>/dev/null || true)"
  sleep 1
done
success "Redis ready"

# ── Migrations ─────────────────────────────────────────────────

info "Running Prisma migrations…"
cd packages/database
export DATABASE_URL="$(grep '^DATABASE_URL=' "$REPO_ROOT/.env" | cut -d= -f2- | tr -d '"')"
export DIRECT_URL="$(grep '^DIRECT_URL=' "$REPO_ROOT/.env" | cut -d= -f2- | tr -d '"')"
npx prisma migrate deploy 2>&1 | grep -v "^$" | grep -E "(Applying|Applied|No pending|error|Error|successfully)" | head -10 || true
success "Migrations applied"

# ── Generate Prisma client ─────────────────────────────────────

info "Generating Prisma client…"
npx prisma generate 2>&1 | tail -3
success "Prisma client generated"

# ── Seed ──────────────────────────────────────────────────────

info "Seeding database…"
npm run db:seed 2>&1
success "Database seeded"

cd "$REPO_ROOT"

# ── Done ───────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            Setup Complete! 🚀             ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo "  Next: run 'make dev' to start FastAPI (:3001) + Next.js (:3000)"
echo ""
echo "  Services:"
echo "    API        → http://localhost:3001"
echo "    API Docs   → http://localhost:3001/docs"
echo "    Web        → http://localhost:3000"
echo "    Grafana    → http://localhost:3002  (admin / admin)"
echo "    Prometheus → http://localhost:9090"
echo ""
echo "  Dev login:"
echo "    Email    : admin@smartroute.dev"
echo "    Password : admin123"
echo ""
