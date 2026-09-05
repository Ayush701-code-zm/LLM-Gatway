# Enterprise SSO (SAML)

SmartRoute supports SP-initiated SAML 2.0 login for **Enterprise** workspaces.

## Setup

1. Upgrade workspace to **Enterprise** (Billing → Settings).
2. Open **Settings → Enterprise SSO (SAML)**.
3. Paste your IdP **metadata URL** — the API fetches the SSO endpoint and X509 certificate automatically.
4. Enable SSO and copy the **SP metadata URL** into your IdP (Okta, Azure AD, Google Workspace, etc.).

## Login flow

1. User enters workspace **slug** on the login page (optional field).
2. If SSO is enabled, **Sign in with SSO** appears.
3. User authenticates at the IdP; assertion is posted to `/api/v1/auth/saml/acs`.
4. API validates the assertion and redirects to **`/saml/callback`** with JWT tokens (or MFA challenge).
5. User is JIT-provisioned as a workspace **MEMBER** if new, then lands on the dashboard.

Set a custom **workspace slug** at registration (or edit it in **Settings → Gateway settings**) so users can discover SSO on the login page. Reserved slugs (`admin`, `api`, `login`, `saml`, etc.) are rejected.

MFA still applies after SAML if enabled on the account.

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/auth/saml/discover?workspace=slug` | Check if SSO is enabled |
| `GET` | `/api/v1/auth/saml/login?workspace=slug` | Start SP-initiated login |
| `POST` | `/api/v1/auth/saml/acs?workspace=slug` | Assertion consumer (IdP POST) |
| `GET` | `/api/v1/auth/saml/metadata?workspace=slug` | SP metadata XML |
| `GET/PATCH` | `/api/v1/workspaces/current/sso` | Admin SSO configuration |

## Local testing

Use a SAML test IdP such as [SAMLtest.id](https://samltest.id/) or Okta dev tenant. Point metadata URL to your IdP and ACS URL to `http://localhost:3001/api/v1/auth/saml/acs?workspace=<slug>`.

**Local E2E:** After `npm run db:seed`, workspace slug **`acme-enterprise`** is seeded as an Enterprise workspace with stub IdP config — the login page shows **Sign in with SSO** when that slug is entered.

**Playwright:** Set `SAML_E2E_BYPASS=true` on the API (done automatically in `./scripts/e2e-ci.sh`). ACS accepts `SAMLResponse=e2e-test-assertion:<email>|<name>` — see `e2e/saml.spec.ts`. Never enable this in production.

**Google OAuth E2E:** Set `OAUTH_E2E_BYPASS=true` on the API (also set in `./scripts/e2e-ci.sh`). Callback accepts `code=e2e-test-oauth:<email>|<name>` — see `e2e/oauth.spec.ts`. Never enable this in production.

See also [SCIM.md](./SCIM.md) for automated provisioning.
