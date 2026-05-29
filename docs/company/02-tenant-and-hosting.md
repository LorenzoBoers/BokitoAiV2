# Tenant and hosting

Last updated: May 2026

Bokito is **multi-tenant**: each customer organisation runs on its own subdomain. Authentication and workspace selection happen on a shared **control plane**; day-to-day product work happens on the **tenant host**.

## Control plane vs tenant hosts

| Host | Production | Local dev | Role |
|------|------------|-----------|------|
| Control plane | `app.bokito.ai` | `app.localhost:5174` | Login, workspace hub (`/workspaces`), billing, account |
| Tenant | `<slug>.bokito.ai` | `<slug>.localhost:5174` | Dashboard product: inbox, projects, docs, agents |

**Flow:**

1. User opens a workspace from `/workspaces` on the control plane.
2. Browser navigates to `https://<slug>.bokito.ai/home` (admins) or project-aware landing (end users).
3. Unauthenticated visits to a tenant host redirect to `https://app.bokito.ai/login?return_to=<tenant-url>`.

Workspace hub routes (`/workspaces*`) are **control-plane only**. If opened on a tenant host, the app redirects to the app host.

Implementation: [`apps/dashboard/src/lib/host-routing.ts`](../../apps/dashboard/src/lib/host-routing.ts).

## The `bokito` tenant

The internal Bokito organisation uses subdomain slug **`bokito`**.

| Environment | URL |
|-------------|-----|
| Production | `https://bokito.bokito.ai` |
| Local dev | `http://bokito.localhost:5174` |

Other seeded tenants in workspace 1 include `chargecars`, `bakermat-design`, `bourgondienadvies`, and `demo-organisation`. Each requires a unique subdomain (3–63 chars, `[a-z0-9-]`).

Subdomain is stored on `organisation.livechat_settings.subdomain` and validated on create/update via `POST /workspaces/{id}/branding`.

## Data model

| Concept | Storage | Notes |
|---------|---------|-------|
| Organisation | `organisation` table | Tenant config, branding, livechat settings |
| Account | `account` table | Legacy business/account layer; linked via `organisation_id` |
| Membership | `tenant_membership` | `user_id`, `tenant_id`, `role`, `status` |
| User context | `user.organisation_id` | Current tenant for API scoping |

`GET /auth/me` returns `memberships[]`, `current_tenant`, and normalized `tenant = { id, slug, name, logo? }`. Optional input `tenant_subdomain` selects tenant context explicitly.

On a tenant host, `WorkspaceContext` locks to the workspace whose slug matches the host subdomain; cross-tenant switching on that host is ignored.

## Authentication

### Login and session

- Dashboard login: email + password via `POST /auth/login`.
- Same-origin auth contract: `/api/auth/*` (login, refresh, me, logout) with HttpOnly refresh cookie.
- Access token stays in memory / `sessionStorage` on the tenant origin.
- Refresh cookie: `bokito_refresh_token` with domain `.bokito.ai` (prod) or `.localhost` (dev).

### Cross-host session handoff

`sessionStorage` is **not shared** between `app.localhost` and `bokito.localhost` (different origins). When navigating from control plane to tenant host:

1. Login completes on app host.
2. Redirect URL includes a one-time fragment: `__bokito_at__=<accessToken>`.
3. Tenant host reads the hash on hydrate, stores the token locally, clears the fragment with `history.replaceState`.

Used from [`Workspaces.tsx`](../../apps/dashboard/src/pages/Workspaces.tsx) and [`Login.tsx`](../../apps/dashboard/src/pages/Login.tsx).

**Note:** Xano `api:auth` may not expose `/refresh`; the frontend can skip server refresh when missing (`bokito_skip_server_auth_refresh` in sessionStorage).

### Protected routes

`ProtectedRoute` sends unauthenticated users to `/login?return_to=...` with open-redirect validation. Bare `localhost` is not a valid tenant return target.

## Cloudflare routing

### Wildcard DNS

Zone `bokito.ai` uses a proxied wildcard A record so `*.bokito.ai` resolves. Without it, new tenant subdomains return `DNS_PROBE_FINISHED_NXDOMAIN`.

Verify: `curl -sI https://bokito.bokito.ai/` should return HTTP 200 with header `X-Tenant-Slug: bokito`.

### `bokito-tenant-router`

Worker: [`cloudflare-workers/bokito-tenant-router/src/index.js`](../../cloudflare-workers/bokito-tenant-router/src/index.js)

| Request path | Proxied to |
|--------------|------------|
| `/api/{group}/...` | Xano as `/api:{group}/...` (`BOKITO_API_ORIGIN`) |
| Everything else | Xano static host (`BOKITO_STATIC_ORIGIN`), `Host` preserved |

Browser cookies on `.bokito.ai` are forwarded to Xano on API calls from tenant subdomains.

### `bokito-app-passthrough`

More specific route `app.bokito.ai/*` can use a passthrough worker so the control plane serves the correct static artifact (`bokitoapp-prod-*`) instead of an outdated `widget-prod-*` upstream.

## Troubleshooting runbook

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| **No tenant access** | User lacks active `tenant_membership` for subdomain | Check membership status; UI shows access denied (not login loop) |
| **Login loop on tenant** | `/auth/me` missing matching membership or cookie not sent | Verify `bokito_refresh_token` on `.bokito.ai`; check `tenant_slug` in response |
| **Empty workspace list** | Subdomain mismatch or inactive membership | Confirm `organisation.livechat_settings.subdomain` matches host |
| **NXDOMAIN on tenant URL** | Missing wildcard DNS or Worker route | Add Cloudflare wildcard; deploy `bokito-tenant-router` |
| **API 400 on tenant POST** | Static host answering instead of API proxy | Fix worker API routing for `/api/*` |
| **Wrong portal build on app.bokito.ai** | Worker upstream points to old static host | Update worker vars or use `bokito-app-passthrough`; compare `ETag` with direct Xano host |

## Related docs

- [03 – Dashboard product](03-dashboard-product.md)
- [09 – Infrastructure and deploy](09-infrastructure-and-deploy.md)
- [10 – Data model and APIs](10-data-model-and-apis.md)
- [README](README.md)
