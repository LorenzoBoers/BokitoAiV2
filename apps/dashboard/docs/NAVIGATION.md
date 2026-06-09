# Portal navigation (IA)

The dashboard uses a two-layer shell: **primary rail** (icons) + **context sidebar** (text links). Configuration lives in [`src/components/layout/portal-nav.ts`](../src/components/layout/portal-nav.ts).

## Bokito admin rail order (`VITE_API_MODE=bokito`)

| Rail | Route | Purpose |
|------|-------|---------|
| Cockpit | `/home` | Ops command center: volume, awaiting decisions, autonomy metrics |
| Messages | `/messages` | Unified signals hub (external + internal); inline decision requests |
| Agenda | `/agenda` | Calendar and scheduled work |
| AI OS | `/os` | Canvas, Orchestra, agent library, Blueprint |
| Integrations | `/integrations/connected` | Connected apps, marketplace, MCP, API keys |
| Govern | `/govern` | Structural drafts, apply modes, Autonomy Posture |
| Settings (footer) | `/settings/profile` | Personal and workspace settings |

**Decisions** are not a separate rail or sidebar item. They appear as inline `DecisionRequest` cards inside Messages threads and in the **Awaiting decision** queue (`/messages/awaiting-decision?folder=internal`).

## Landing

- **Tenant admin** (`/` on subdomain): redirects to `/home` (Cockpit in bokito mode).
- **Tenant end-user** (`/`): project-aware redirect (0 → create, 1 → project overview, many → `/home`).
- **Control plane** (`/` without tenant): workspace hub.

## Messages (`/messages/*`)

Canonical paths:

- `/messages/:queue` — queue view with optional `?folder=external|internal|all`
- `/messages/:queue/t/:threadId` — thread detail
- `/messages/ch/:channelId/:queue` — channel-scoped queue

Legacy `/support/inbox/*` redirects to the equivalent `/messages/*` URL (query string preserved).

Context sidebar: [`InboxSidebarNav`](../src/components/inbox/InboxSidebarNav.tsx). Footer: **Messages settings** → `/settings/inbox`.

## AI OS (`/os`)

Context sidebar from [`getAiOsSidebarGroups`](../src/components/layout/portal-nav.ts):

- Canvas (`/os`)
- Orchestra (`/orchestra`)
- Agent library (`/os/agents`)
- Blueprint (`/os/docs`)

No **Decisions** link in the AI OS sidebar — use Messages **Awaiting decision** instead.

Project selector in the AI OS sidebar navigates to `/project/:id/overview` (not `/os/project/:id`).

## Govern (`/govern`)

Full-bleed page (no context sidebar title). Tabs: Drafts, Policy (Autonomy Posture + apply modes), Passports, Audit.

## Per-project cockpit (`/project/:id/*`)

Horizontal tabs via [`ProjectTabNav`](../src/components/project/ProjectTabNav.tsx):

- Overview, Orchestration, **Messages** (project-scoped Messages hub), **Agent runs**, Token usage, Notifications, Request a change, Settings

## Legacy redirects (selected)

| Old path | New path |
|----------|----------|
| `/support/inbox/:queue` | `/messages/:queue` |
| `/os/communication` | `/messages/awaiting-decision?folder=internal` |
| `/os/project/:projectId` | `/project/:projectId/overview` |
| `/communication` | `/messages?folder=internal` |
| `/database`, `/users/*`, `/data/*` | `/os` (bokito mode) |
| `/workforce/overview` | `/os` |

## Agent runs

1. **Per agent** — `/os/agents/:agentId` and run detail URLs.
2. **Per project** — `/project/:id/workforce`.
3. **AI OS canvas** — node detail panels link back to Messages when human approval is needed.

## Settings sidebar

Personal + Workspace groups. Workspace includes **Messages and channels** (`/settings/inbox`). Billing remains routable at `/settings/billing` but is not duplicated in the sidebar (company settings covers billing UI).
