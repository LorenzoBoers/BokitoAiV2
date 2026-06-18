# Dashboard product

Last updated: May 2026

The dashboard (portal) is the primary web application for tenant admins and operators. It uses a two-layer shell: a **primary rail** (icons) and a **context sidebar** (text links per section).

Full navigation reference: [`apps/dashboard/docs/NAVIGATION.md`](../../apps/dashboard/docs/NAVIGATION.md).

## Primary rail (admin)

| Item | Route | Purpose |
|------|-------|---------|
| Home | `/home` | Workspace overview: recent projects, inbox links, agent runs |
| Inbox | `/support/inbox/all` | Team inbox queues |
| Workspace | `/projects` | Project hub, communication, Blueprint |
| Workforce | `/workforce/agents` | Assistant, communication agent, PO agent, custom agents, background workstreams |
| Integrations | `/integrations/connected` | Connected apps, marketplace, MCP, API keys |
| Data | `/database` | Coming soon (disabled; redirects to `/projects`) |
| Settings | `/settings/profile` | Personal and workspace settings (footer) |

Assistant and agents are merged under **Workforce**. Legacy `/ai/*` paths remain as compatibility aliases.

## Landing behavior

| User | Host | Default landing |
|------|------|-----------------|
| Tenant admin | Tenant subdomain | `/home` |
| Tenant end-user | Tenant subdomain | Project-aware redirect (0 projects → create, 1 → project overview, many → `/home`) |
| Any user | Control plane (`app.*`) | Workspace hub `/` |

## Major modules

### Home (`/home`)

Dashboard cards for recent projects, inbox shortcuts, and recent agent runs. No context sidebar.

### Inbox (`/support/inbox/*`)

Queue-based team inbox with thread detail, assignment, and labels. Sidebar via `InboxSidebarNav`. Footer link to inbox settings.

### Workspace hub (`/projects`)

- **Overview** – project list, decisions, recent runs
- **Communication** – cross-project agent messages
- **Blueprint** – tenant-wide planning surface at `/projects/docs[/:slug]`
- **Background workstreams** – per-project operational status in sidebar

Per-project cockpit: `/project/:id/*` with tabs for Overview, Orchestration, Communication, Workforce history, Token usage, Notifications, Request a change, Settings.

### Workforce (`/workforce/*`, compatibility `/ai/*`)

- Assistant configuration (`/ai/assistent/internal|external/...`)
- Communication agent settings (`/ai/communicatie`)
- **Agents** – canonical list `/workforce/agents` (alias `/ai/agents`), detail `/ai/agents/:agentId`, live log `/ai/agents/:agentId/runs/:workLogId`
- **PO agents** – `/workforce/po`
- **Background workstreams** – `/workforce/background-workers`

### Integrations (`/integrations/*`)

Connected (default), Marketplace, MCP, API keys. See [06 – Integrations](06-integrations.md).

### Settings (`/settings/*`)

**Personal:** profile, notifications. **Workspace:** general, branding, members, billing (via hub), access. Product config (inbox, assistant) is not duplicated under settings subnav.

## Internationalization

Runtime language switching via `i18next` (`en` / `nl`). Locale files: `apps/dashboard/src/locales/{en,nl}/nav.json`. Preference stored in `localStorage` key `bokito-language`.

## Design system

Unified surfaces and spacing (May 2026 unification):

- Background hierarchy: `bg` → `bg-sidebar` → `bg-surface` → `bg-elevated`
- Shared primitives: `PageContent`, `PageIntro`, `EmptyState`, `LoadingBlock`
- Tokens in `apps/dashboard/src/index.css` and `tailwind.config.ts`

## Frontend API pattern

All FastAPI calls follow a centralized pattern:

1. **Env and group bases:** `apps/dashboard/src/lib/api.config.ts` (`VITE_BOKITO_API_URL`, `VITE_API_GROUP_*`)
2. **Route constants:** `apps/dashboard/src/api/routes/`
3. **Transport:** `apps/dashboard/src/lib/bokito-api.ts`

Do not hardcode full FastAPI origins in pages or components. See [`apps/dashboard/docs/API.md`](../../apps/dashboard/docs/API.md) and `.cursor/rules/frontend-api-env-pattern.mdc`.

## Build version

Login footer and user menu show `build: <version>` from `VITE_APP_VERSION`, set by `deploy.ps1` during static deploy.

## Legacy redirects (selected)

| Old path | New path |
|----------|----------|
| `/admin/runs` | `/workforce/agents` |
| `/workforce` | `/workforce/agents` |
| `/project/:id/doc` | `/projects/docs` |
| `/project/:id/messages` | `/project/:id/communication` |
| `/datasources`, `/database` | `/projects` (until Data module ships) |

## Related docs

- [04 – Workspace and projects](04-workspace-and-projects.md)
- [02 – Tenant and hosting](02-tenant-and-hosting.md)
- [README](README.md)
