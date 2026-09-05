# ===========================================================
# SmartRoute AI — Web (Next.js 15) — Production Dockerfile
#
# Uses Next.js standalone output mode for minimal images.
# Enable it in next.config.ts:  output: 'standalone'
#
# Build from repo root:
#   docker build -f apps/web/Dockerfile -t smartroute-web:latest .
# ===========================================================

# ── Stage 1: Base ────────────────────────────────────────────
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat dumb-init
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1


# ── Stage 2: Dependencies ────────────────────────────────────
FROM base AS deps

COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json          ./apps/web/
COPY packages/shared/package.json   ./packages/shared/

RUN npm ci --ignore-scripts --include=dev


# ── Stage 3: Build ───────────────────────────────────────────
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build shared constants/types first
RUN npm run build --workspace=packages/shared

# Next.js production build (requires NEXT_PUBLIC_* vars at build time)
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build --workspace=apps/web


# ── Stage 4: Runtime image ───────────────────────────────────
FROM base AS release

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs

WORKDIR /app

# Standalone output includes all necessary node_modules automatically
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone  ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static      ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public            ./apps/web/public

USER nextjs
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]

HEALTHCHECK \
  --interval=30s \
  --timeout=10s \
  --start-period=20s \
  --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
