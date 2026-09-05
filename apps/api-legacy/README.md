# Archived Express/TypeScript API (pre-FastAPI migration)

This directory contains the original Node.js/Express backend. The active API is now at `apps/api/` (Python/FastAPI).

Production Docker image: `apps/api/Dockerfile`

To run legacy tests:

```bash
make test-api-legacy
# or
npm run test --workspace=@smartroute/api-legacy
```
