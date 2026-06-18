# Workspace and projects

Last updated: May 2026

Workspaces represent customer organisations. Within a workspace, **projects** are the unit of AI workforce orchestration. **Workspace documentation** is tenant-wide knowledge separate from per-project state.

## Workspace hub (control plane)

Routes on `app.bokito.ai` (or `app.localhost`):

| Route | Purpose |
|-------|---------|
| `/` or `/workspaces` | Workspace list and create |
| `/billing` | Billing hub |
| `/account` | Account settings |
| `/support` | Support hub |

Creating a workspace requires a valid **subdomain** (unique, `[a-z0-9-]`, 3–63 chars). Cards show full tenant URL `https://<slug>.bokito.ai`. Opening a workspace navigates to the tenant host.

Branding (name, subdomain, logo, favicon, brand color): `/settings/branding` → `POST /workspaces/{id}/branding`.

## Project hub (`/projects`)

Tenant-scoped project list and cross-project views:

| Route | Purpose |
|-------|---------|
| `/projects` | Overview, recent activity |
| `/projects/communication` | Hub-wide agent communication |
| `/projects/docs[/:slug]` | **Workspace documentation** (see below) |
| `/projects/new` | Create project wizard |

Sidebar shows Overview, Communication, Documentation links plus **Background workers** (`ProjectHubBackgroundWorkersNav`) with per-project status derived from messages, budget, orchestration, and work logs.

## Per-project cockpit (`/project/:id/*`)

Horizontal tab navigation inside `ProjectShell`:

| Tab | Route | Purpose |
|-----|-------|---------|
| Overview | `/project/:id/overview` | Project summary |
| Orchestration | `/project/:id/orchestration` | PO wake frequency, autonomy, HITL sensitivity |
| Communication | `/project/:id/communication` | Project-scoped messages |
| Workforce history | `/project/:id/workforce` | Agent runs for this project |
| Run detail | `/project/:id/workforce/:workLogId` | Live event stream |
| Token usage | `/project/:id/usage` | Usage summary and budget |
| Notifications | `/project/:id/notifications` | Per-event notification matrix |
| Request a change | `/project/:id/request` | Change request submission |
| Settings | `/project/:id/settings` | Project configuration |

`WorkerStatusStrip` above tabs shows operational status (blocked, attention, healthy) from `deriveWorkerStatus`.

## Workspace documentation

Central tenant documentation at **`/projects/docs[/:slug]`** — not per-project.

### Data model

- `workspace_docs` – one root doc per tenant
- `workspace_doc_pages` – page tree (chapters as top-level pages)
- `workspace_doc_blocks` – block content (paragraphs, headings, lists, callouts)
- `workspace_doc_block_revisions` – revision history

API: `GET/POST/PATCH/DELETE /workspace/doc/pages`, batch block ops `POST /workspace/doc/pages/{id}/blocks`. See [10 – Data model and APIs](10-data-model-and-apis.md).

### UI behavior

- `WorkspaceDocNavContext` loads doc tree; seeds eight default chapters when empty (`workspace-doc-scaffold.ts`)
- `ProjectHubDocs` – block editor, page tree in left column, lock/unlock, history panel
- **Ask agent** queues `POST /workspace/doc/change-requests` for the active page
- Pages can be **locked** (`lock_action: lock|unlock` on patch); edits blocked when locked
- Flat top-level blocks only in the editor (no nested block UI)
- Optimistic concurrency via `content_version` / `expected_version` when column exists

### API caveats (operators)

Documented in `BOKITO_KNOWLEDGE.md`: optional `bool false` ignored by FastAPI (use enums like `lock_action`); avoid `|to_string`; nullable JSON columns on blocks table.

## Project configuration (backend)

| Feature | Tables / API |
|---------|----------------|
| Orchestration | `project_orchestration_config`, `GET/PATCH /projects/{id}/orchestration` |
| Notifications | `project_notification_preferences`, `GET/PATCH /projects/{id}/notifications/preferences` |
| Usage | `GET /projects/{id}/usage/summary`, `GET /projects/{id}/usage/budget` |

Patches live under `docs/archived/v1/` and `PROJECT-HUB-BACKEND.md`.

## Related docs

- [05 – Workforce and agents](05-workforce-and-agents.md)
- [03 – Dashboard product](03-dashboard-product.md)
- [README](README.md)
