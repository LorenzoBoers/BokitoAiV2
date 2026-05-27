# Portal navigation (IA)

The dashboard uses a two-layer shell: **primary rail** (icons) + **context sidebar** (text links). Configuration lives in [`src/components/layout/portal-nav.ts`](../src/components/layout/portal-nav.ts).

## Admin rail order

| Rail | Route | Purpose |
|------|-------|---------|
| Home | `/home` | Workspace overview (projects, inbox links, recent agent runs) |
| Project hub | `/projects` | Hub: Overview, Communication; Documentation section with page tree; Background projects list |
| Inbox | `/support/inbox/all` | Team inbox queues |
| Assistant | `/ai/assistent/...` | Widget, AI communication, and workforce agents |
| Integrations | `/integrations/connected` | Connected apps, marketplace, MCP, API keys |
| Data | `/database` | Coming soon (rail disabled; routes redirect to `/projects`) |
| Settings (footer) | `/settings/profile` | Personal and workspace settings only |

There is **no** dedicated Agents rail item. Agent management and per-agent run history live under **Assistant** → **Agents** (`/ai/agents`).

## Landing

- **Tenant admin** (`/` on subdomain): redirects to `/home`.
- **Tenant end-user** (`/`): project-aware redirect (0 → create, 1 → project overview, many → `/home`).
- **Control plane** (`/` without tenant): workspace hub.

## Context sidebars

- **Home**: no context sidebar (navigation is on the dashboard cards and quick actions).
- **Project hub** (`/projects`, `/projects/communication`, `/projects/docs[/:slug]`, `/project/:id/*`): context sidebar renders hub links — Overview, Communication, and Documentation — from [`getProjectHubSidebarGroups`](../src/components/layout/portal-nav.ts), then **Background workers** ([`ProjectHubBackgroundWorkersNav`](../src/components/layout/ProjectHubBackgroundWorkersNav.tsx)) with per-project operational status from [`ProjectHubNavContext`](../src/context/ProjectHubNavContext.tsx) and [`project-worker-status.ts`](../src/lib/project-worker-status.ts). Documentation page tree lives in the main content on [`ProjectHubDocs`](../src/pages/ProjectHubDocs.tsx) (`PageTree` `variant="minimal"`). On `/project/:id/*`, [`WorkerStatusStrip`](../src/components/workers/WorkerStatusStrip.tsx) appears above project tabs in [`ProjectShell`](../src/components/project/ProjectShell.tsx).
- **Per-project cockpit** (`/project/:id/*`): same hub sidebar (including background projects with the active project highlighted). Section navigation (Overview, Orchestration, Communication, Workforce history, Token usage, Notifications, Request a change, Settings) is horizontal in-page via [`ProjectTabNav`](../src/components/project/ProjectTabNav.tsx) inside [`ProjectShell`](../src/components/project/ProjectShell.tsx).
- **Inbox**: `InboxSidebarNav` + footer **Configure** (assistant + inbox settings).
- **Assistant**: Widget, AI communication, and **Agents** (`/ai/agents`). Agent detail and live run logs: `/ai/agents/:agentId` and `/ai/agents/:agentId/runs/:workLogId`.
- **Integrations**: Connected, marketplace, MCP, API (no sources here).
- **Data**: Unified links for `/database`, `/users/*`, `/data/sources`, `/data/imports-exports`; table list appears on `/database` routes.
- **Settings**: Personal + Workspace groups only.

## Agent runs (where to find them)

There is **no** global “all runs” page. Runs appear in three places:

1. **Per agent** — `/ai/agents/:agentId` (filtered history) and `/ai/agents/:agentId/runs/:workLogId` (live event stream via [`LiveWorkLog`](../src/components/observability/LiveWorkLog.tsx)).
2. **Per project** — `/project/:id/workforce` (project-scoped list) and `/project/:id/workforce/:workLogId` (run detail in [`ProjectWorkforceRunDetail`](../src/pages/ProjectWorkforceRunDetail.tsx)).
3. **Project hub overview** — `/projects` shows recent runs across projects; each link opens the project-scoped run detail URL.

Admin-only pages: [`AiAgents`](../src/pages/AiAgents.tsx), [`AiAgentDetail`](../src/pages/AiAgentDetail.tsx).

## Project hub IA

The `/projects` rail item opens the **Project hub**, a single landing surface
that pulls workspace-wide work into one place. Hub sections live in the context
sidebar; background projects are a collapsible list below them.

- **Overview** (`/projects`) — active projects, pending agent decisions, recent
  agent runs (links to `/project/:projectId/workforce/:workLogId`), and quick actions.
  The sidebar link uses `exact: true` so it deactivates as soon as the user
  navigates into another hub section.
- **Documentation** (`/projects/docs[/:slug]`) — tenant-wide workspace documentation
  (Notion-style page tree + block editor). Navigation lives in its own sidebar section (not a top hub tab):
  section label **Documentation** plus [`PageTree`](../src/components/doc/PageTree.tsx) with page CRUD.
  [`WorkspaceDocNavContext`](../src/context/WorkspaceDocNavContext.tsx) loads `GET /workspace/doc` and seeds
  eight default chapters when the tree is empty. Users can queue agent edits via **Ask agent**
  (`POST /workspace/doc/change-requests`).
- **Background projects** (sidebar) — vertical list of continuous agent work tracks (default 4 visible, **Show more** / **Show less** when there are more).
  Selecting a project opens `/project/:id/overview` in the main canvas with horizontal section tabs.
- **Communication** (`/projects/communication`) — pending agent messages
  (`status: 'awaiting_human'`) across all projects, deep-linking into each
  project's communication thread. Shows a `projectsAttention` badge.

Per-project pages no longer host documentation; they focus on agent
orchestration (PO wake cadence, HITL sensitivity, autonomy mode), notification
preferences, workforce history, token usage, and project-scoped communication.
Legacy `/project/:id/doc[/:slug]` and `/project/:id/pkb` paths redirect to
`/projects/docs`; `/project/:id/messages` redirects to `/project/:id/communication`.

## Legacy redirects

| Old path | New path |
|----------|----------|
| `/integrations/sources` | `/data/sources` |
| `/datasources` | `/data/sources` |
| `/settings/data/*` | `/users/*`, `/database`, or `/data/imports-exports` |
| `/settings/messenger` | Assistant default path |
| `/admin/runs` | `/projects` |
| `/admin/runs/:workLogId` | Resolved via [`AdminRunLegacyRedirect`](../src/pages/AdminRunLegacyRedirect.tsx) to project run detail when possible, else `/projects` |
| `/workforce` | `/ai/agents` |
| `/workforce/*` | `/ai/agents` |
| `/project/:id/doc[/:slug]` | `/projects/docs` (central docs) |
| `/project/:id/pkb` | `/projects/docs` |
| `/project/:id/messages` | `/project/:id/communication` |
| `/projects/list` | `/projects` |

## Navigation badges

Counts are loaded by [`NavBadgeContext`](../src/context/NavBadgeContext.tsx) (poll every 45s while the tab is visible; manual refresh after inbox read/unread actions).

| Surface | Badge meaning |
|---------|----------------|
| Rail **Inbox** | Unread threads in **mine** + **unassigned** (deduplicated by thread id) |
| Assistant sidebar **Agents** | Workforce messages with `status: awaiting_human` (admin only; `agentsAttention`) |
| Rail **Project hub** | Pending agent messages (`awaiting_human`), reused from the agents count |
| Rail **Home** | Sum of inbox unread + awaiting_human (muted style) |
| Rail **Messages** (end-user) | Same as inbox unread |
| Inbox submenu **Open / Mijn / Niet toegewezen** | Unread count per queue view |
| Project hub **Communication** tab | Same as Project hub rail badge |

UI: [`NavCountBadge`](../src/components/layout/NavCountBadge.tsx) on rail icons (absolute) and inbox links (inline pill). Cap display at `99+`.

## i18n

Labels: `apps/dashboard/src/locales/{en,nl}/nav.json` (`rail.*`, `sectionTitle.*`, `home.*`, `data.*`, `ai.agents.*`, `ai.group.agents`, `ai.links.agents`, `badges.*`, `projectHub.*`, `project.links.*`, `project.{communication,orchestration,notifications,workforce,usage}.*`, `workforce.runs.*`).
