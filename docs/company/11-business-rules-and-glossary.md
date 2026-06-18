# Business rules and glossary

Last updated: May 2026

Platform-wide rules, standard operating procedures, and terminology.

## Tenant isolation

- Every customer organisation is a **tenant** with isolated data scoped by `tenant_id` / `organisation_id`.
- Cross-tenant access is not allowed by default; APIs enforce membership and organisation match.
- Integrations (`integration_connections`), projects, docs, and index chunks are tenant-scoped.
- Agents and widgets validate `tenant_subdomain` on session start when provided.

## Roles and RBAC

| Role | Typical capabilities |
|------|---------------------|
| **Admin** | Workspace settings, member management, tenant doc writes, integrations, full project config |
| **User** | Read tenant docs, participate in inbox, view assigned projects |

Tenant-scoped auth docs (scraped `doc` tables): only **admin** may create/update/archive; authenticated users read within tenant.

Dashboard admin detection: `useIsAdmin()` hook (tenant role).

## Standard operating procedures

### Authentication

- Login on control plane; product work on tenant subdomain.
- Use `return_to` for post-login redirect; never open redirect to external domains.
- Cross-host navigation uses one-time `__bokito_at__` token hash when cookie/session cannot be shared.

### Documentation edits

- Workspace doc pages can be **locked** to prevent edits; unlock before batch block writes.
- Use `lock_action: lock|unlock` on page patch (not bare `is_locked: false`).
- Block batch writes reject locked pages with 403.

### OCR and documents

- OCR processing is **asynchronous** after file upload.
- Agents may only read buckets explicitly granted to them.

### Integrations

- OAuth redirect URIs must match provider console exactly.
- Revoke connections via `DELETE /integrations/connections/{id}`; clean up synced data per product rules.

### Deploy

- Deploy API changes before relying on new frontend API routes.
- Run `deploy.ps1` for portal; verify `build:` string on login after deploy.
- Deploy runtime separately on VPS; confirm `WORKER_BASE_URL` reachable from FastAPI crons.

### UI data sources

- Dashboard combines **live FastAPI APIs** with **mock or UI-only state** where backend is not yet implemented (check feature-specific docs before assuming persistence).

## Glossary

| Term | Definition |
|------|------------|
| **Tenant** | Customer organisation; identified by UUID and subdomain slug |
| **Organisation** | FastAPI table holding tenant configuration and branding |
| **Account** | Legacy business/account entity linked to organisation |
| **Workspace** | UI concept mapping to tenant; hub at `/workspaces` on control plane |
| **Control plane** | Shared app host (`app.bokito.ai`) for login and workspace selection |
| **Tenant host** | Subdomain origin (`<slug>.bokito.ai`) for product UI |
| **Project** | Workforce unit with repo, orchestration, messages, and optional per-project docs |
| **Work log** | Single agent run (UUID); live events and container auth |
| **PO agent** | Product-owner orchestrator agent for change queue processing |
| **HITL** | Human-in-the-loop; `decision_request` messages awaiting human action |
| **Workspace docs** | Tenant-wide block documentation at `/projects/docs` |
| **PKB** | Project knowledge base (legacy sections; migrating to block docs) |
| **MCP** | Model Context Protocol server exposing tools to agents |
| **Static host** | FastAPI-hosted SPA build for portal (`bokitoapp-prod-*`) |

## Stub and roadmap modules

Not fully live in the portal (redirect or coming soon):

| Module | Status |
|--------|--------|
| **Data** (`/database`) | Rail disabled; routes redirect to `/projects` |
| **Analytics** | Redirect to `/projects` |
| **Some messenger agent settings** | UI state only; save not fully wired |
| **SMTP/IMAP email** | Concept UI only |

Future items documented in `BOKITO_KNOWLEDGE.md` section 13 (roadmap): expanded analytics, data module, additional agent types.

## When to update documentation

| Change type | Update |
|-------------|--------|
| New feature or workflow | `BOKITO_KNOWLEDGE.md` (agent log) + relevant `docs/company/` chapter |
| Navigation change | `apps/dashboard/docs/NAVIGATION.md` + [03 – Dashboard product](03-dashboard-product.md) |
| New integration provider | `INTEGRATIONS.md` + [06 – Integrations](06-integrations.md) |
| Schema migration | `docs/archived/v1-platform-tables.md` + [10 – Data model and APIs](10-data-model-and-apis.md) |

## Related docs

- [02 – Tenant and hosting](02-tenant-and-hosting.md)
- [`BOKITO_KNOWLEDGE.md`](../../BOKITO_KNOWLEDGE.md)
- [README](README.md)
