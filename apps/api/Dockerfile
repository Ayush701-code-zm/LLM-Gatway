# ===========================================================
# SmartRoute AI — API (FastAPI/Python) — Production Dockerfile
# Build from repo root:
#   docker build -f apps/api/Dockerfile -t smartroute-api:latest .
# ===========================================================

FROM python:3.12-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      libxml2-dev \
      libxmlsec1-dev \
      libxmlsec1-openssl \
      pkg-config \
      gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1


FROM base AS builder

COPY apps/api/pyproject.toml ./apps/api/
COPY apps/api/smartroute ./apps/api/smartroute
RUN pip install --upgrade pip && pip install ./apps/api[dev]


FROM base AS release

RUN addgroup --system --gid 1001 appgroup \
 && adduser  --system --uid 1001 --ingroup appgroup apiuser

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY apps/api/smartroute ./smartroute
COPY apps/api/pyproject.toml ./pyproject.toml

USER apiuser

EXPOSE 3001

HEALTHCHECK \
  --interval=30s \
  --timeout=10s \
  --start-period=40s \
  --retries=3 \
  CMD curl -sf http://localhost:3001/health/live || exit 1

CMD ["uvicorn", "smartroute.main:app", "--host", "0.0.0.0", "--port", "3001"]
