# Production Cutover Checklist

Complete this checklist when promoting from staging to **production**. Pair with [DEPLOYMENT.md](./DEPLOYMENT.md), [STRIPE_PRODUCTION.md](./STRIPE_PRODUCTION.md), and [SSO.md](./SSO.md).

## Automated preflight

With production `.env` loaded:

```bash
# Core only (always)
make verify-prod-env

# Before enabling email
make verify-email

# Before enabling billing
make verify-stripe

# After deploy — HTTP smoke against live API
PRODUCTION_API_URL=https://api.yourdomain.com ./scripts/production-cutover-smoke.sh
PRODUCTION_API_URL=https://api.yourdomain.com ./scripts/production-cutover-smoke.sh --with-email --with-stripe
```

Optional GitHub Actions:

| Workflow | When |
|----------|------|
| [staging-smoke.yml](../.github/workflows/staging-smoke.yml) | Validate staging Stripe + billing endpoints |
| [gateway-smoke.yml](../.github/workflows/gateway-smoke.yml) | Full LLM chat pipeline (manual dispatch) |

---

## 1. Infrastructure

- [ ] Postgres 15+ with `pgvector` extension
- [ ] Redis 7+ with `maxmemory-policy noeviction`
- [ ] TLS certificates on load balancer / ingress
- [ ] `NODE_ENV=production` on all API instances
- [ ] Secrets in a manager (not `.env` in git)
- [ ] `./scripts/verify-production-env.sh --core` passes

## 2. Deploy

- [ ] `npx prisma migrate deploy` on production database
- [ ] Deploy API containers; wait for `GET /health/ready` → 200
- [ ] Deploy web containers with correct `NEXT_PUBLIC_API_URL`
- [ ] `./scripts/production-cutover-smoke.sh` passes

## 3. Transactional email (SMTP)

- [ ] `make verify-email` passes with production SMTP credentials
- [ ] Send test: password reset from login page
- [ ] Send test: team invite from Team page
- [ ] Confirm emails arrive (not spam folder)
- [ ] Local dev parity: `make email-smoke` with Mailhog

## 4. Stripe billing (live)

- [ ] Follow [STRIPE_PRODUCTION.md](./STRIPE_PRODUCTION.md) sections 1–7
- [ ] `sk_live_…` keys and live `price_…` IDs in secrets
- [ ] Live webhook endpoint with **new** `whsec_…` (do not reuse test secret)
- [ ] Complete one real small subscription end-to-end
- [ ] Customer Portal cancellation downgrades workspace to Free
- [ ] Staging validation first: [STRIPE_STAGING.md](./STRIPE_STAGING.md)

## 5. Enterprise SSO (real IdP)

- [ ] Workspace on **Enterprise** plan
- [ ] IdP metadata URL configured in Settings → SSO
- [ ] SP metadata URL registered in IdP (Okta / Azure AD / Google Workspace)
- [ ] ACS URL: `https://api.yourdomain.com/api/v1/auth/saml/acs?workspace=<slug>`
- [ ] Test login with a real IdP user (not `SAML_E2E_BYPASS`)
- [ ] Confirm JIT provisioning and MFA still apply when enabled
- [ ] Document IdP group → role mapping for support team

## 6. OAuth (Google)

- [ ] Production `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- [ ] Authorized redirect URI matches `OAUTH_REDIRECT_URI` exactly
- [ ] Test social login from production login page
- [ ] Disable `OAUTH_E2E_BYPASS` in production

## 7. Security hardening

- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` are unique 256-bit values
- [ ] `API_KEY_ENCRYPTION_SECRET` is 32+ characters
- [ ] `SAML_E2E_BYPASS` and `OAUTH_E2E_BYPASS` are **unset** or `false`
- [ ] `REQUIRE_EMAIL_VERIFICATION=true` if blocking unverified API keys
- [ ] Review [DPA.md](./DPA.md) and [SUBPROCESSORS.md](./SUBPROCESSORS.md) with legal

## 8. Observability

- [ ] Prometheus scraping `/metrics`
- [ ] Grafana dashboards provisioned
- [ ] Alert on API 5xx rate, Celery queue depth, Redis errors
- [ ] Stripe webhook delivery failures monitored

## 9. SDK & release

- [ ] `./scripts/release-preflight.sh vX.Y.Z` before tagging
- [ ] Tag `v*.*.*` triggers [release.yml](../.github/workflows/release.yml)
- [ ] `NPM_TOKEN` configured for `@smartroute/sdk` publish
- [ ] See [RELEASE.md](./RELEASE.md) and [NPM_PUBLISH.md](./NPM_PUBLISH.md)

## 10. Rollback plan

- [ ] Previous Docker image tags documented
- [ ] Database migration rollback procedure documented
- [ ] Stripe: revert to test keys in staging if checkout breaks
- [ ] IdP: disable SSO in workspace settings without deleting config

---

## Post-cutover (first 24 hours)

- [ ] Monitor error rates for 15 minutes after deploy, then at +1h and +24h
- [ ] Run `./scripts/production-cutover-smoke.sh --with-stripe` if billing enabled
- [ ] Confirm no budget/anomaly alert storms
- [ ] Support team has runbook links (this doc + DEPLOYMENT troubleshooting)
