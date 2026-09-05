# Enterprise SCIM Provisioning

SCIM 2.0 user provisioning is available on the **Enterprise** plan.

## Setup

1. **Settings → SCIM provisioning** → Enable SCIM.
2. Copy the **bearer token** (shown once) and **base URL** (`/scim/v2`).
3. In your IdP (Okta, Azure AD, etc.), configure SCIM with:
   - **SCIM base URL**: `https://api.yourdomain.com/scim/v2`
   - **Authentication**: Bearer token (`sr_scim_…`)

## Supported operations

| Method | Path | Description |
|---|---|---|
| `GET` | `/scim/v2/ServiceProviderConfig` | Capability discovery |
| `GET` | `/scim/v2/Users` | List workspace members |
| `POST` | `/scim/v2/Users` | Provision user (creates account + MEMBER role) |
| `GET` | `/scim/v2/Users/:id` | Get user |
| `PATCH` | `/scim/v2/Users/:id` | Deactivate (`active: false` removes membership) |

## Token rotation

Use **Rotate token** in Settings to invalidate the previous bearer token and issue a new one.

## Dashboard API

| Method | Endpoint | Description |
|---|---|---|
| `GET/PATCH` | `/api/v1/workspaces/current/scim` | Enable/disable and manage token |

Provisioning events are recorded in the audit log with `via: scim`.
