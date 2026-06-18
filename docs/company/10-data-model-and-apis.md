# Data model and APIs

Last updated: May 2026

FastAPI is the system of record for auth, tenant data, livechat, workforce, integrations, and static hosting. Platform table definitions: [`docs/archived/v1-platform-tables.md`](../../docs/archived/v1-platform-tables.md).

## API groups

| Group | Canonical | Typical use |
|-------|-----------|-------------|
| Authentication | `auth` | Login, `/auth/me`, tenant docs RBAC |
| App | `app` | Workspaces, branding, legacy email callbacks |
| Workforce | `workforce` | Projects, work logs, messages, workspace docs |
| Integrations | `integrations` | OAuth, connections, MCP, central OAuth callbacks |
| Livechat | `livechat` | Widget/mobile chat, SSE stream |
| Logs | `logs` | Audit / event logs |
| Bakermat | `bakermat` | Design configurator (separate product line) |

Frontend builds URLs as `{origin}/api/{group}/...` (proxied to `/api:{group}/...` on FastAPI).

**Example base:** `https://api.bokito.nl`

## Tenant scoping

Most domain tables include `tenant_id` (= `organisation.id` UUID).

Auth layer also uses:

- `account_id` (int) on some legacy tables (`user`, email OAuth)
- `tenant_membership` for multi-tenant user access
- `organisation.livechat_settings.subdomain` for host routing

API handlers typically resolve tenant from `$auth` user + membership or `organisation_id`.

## Core domains

### Auth and tenant

| Table | Purpose |
|-------|---------|
| `user` | Portal users |
| `organisation` | Tenant configuration |
| `account` | Account/business layer |
| `tenant_membership` | User–tenant roles |
| `auth_handoff` | Cross-host auth (if used) |

### Livechat (canonical)

| Table | Purpose |
|-------|---------|
| `conversation`, `message` | Chat sessions |
| `customer` | End users |
| `bot_agent`, `bot_agent_tool` | Agent config |
| `tool_registry` | Tool definitions |

Legacy `agent_conversation` / `agent_message` removed; use conversation/message.

### Workforce

| Table | Purpose |
|-------|---------|
| `projects` | Workforce projects |
| `agent`, `agent_session` | Agent definitions and sessions |
| `work_log` (via API) | Run instances |
| `messages` | Workforce messaging |
| `index_chunks` | Vector index (repo, docs) |

PKB (`pkb_sections`) is legacy-only and removed from active runtime/workforce contracts.

### Per-project Blueprint context (compatibility path)

| Table | Purpose |
|-------|---------|
| `project_docs` | One doc root per project |
| `doc_pages`, `doc_blocks` | Page tree + blocks |

Hub editing is centralized in **workspace Blueprint** (`/projects/docs`), while project docs remain agent context and audit history.

### Workspace documentation (tenant-wide)

| Table | Purpose |
|-------|---------|
| `workspace_docs` | One root per tenant |
| `workspace_doc_pages` | Pages (tree via `parent_page_id`, `position`) |
| `workspace_doc_blocks` | Block content (`block_type`, `text` json, `props` json) |
| `workspace_doc_block_revisions` | Edit history |
| `workspace_doc_write_idempotency` | Agent write idempotency keys |

Page fields include `is_locked`, `content_version`, projection fields (`rendered_markdown`, `rendered_plaintext`, `content_hash`, `last_indexed_at`) when migrated.

**Schema notes:** `parent_block_id`, `text`, `props` must be nullable for top-level/empty blocks. Avoid PostgreSQL default `""` on json/enum columns.

### Integrations

| Table | Purpose |
|-------|---------|
| `integration_providers` | Marketplace catalog |
| `integration_connections` | Tenant connections |
| `integration_hosts` | Brand logos |
| `integration_bindings` | Project-level bindings |
| `github_connections` | GitHub OAuth (legacy dual-write possible) |
| `email_oauth_connection` | Outlook/Gmail |

### Scraped tenant docs (auth API)

Separate from workspace docs:

| Table | Purpose |
|-------|---------|
| `doc` | Documentation source (scraped site root) |
| `doc_page`, `doc_section` | Scraped pages and sections |

Tenant-scoped via `organisation_id`; RBAC: admin write, authenticated read.

### Custom database builder

| Table | Purpose |
|-------|---------|
| `custom_table`, `custom_field`, `custom_record`, `custom_view` | No-code DB feature (Data module stub in UI) |

## Workspace doc API surface (workforce)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/workspace/doc` | Doc root + pages |
| POST/PATCH/DELETE | `/workspace/doc/pages` | Page CRUD |
| GET/POST | `/workspace/doc/pages/{id}/blocks` | Read / batch write blocks |
| POST | `/workspace/doc/change-requests` | Agent edit queue |
| PATCH | `/workspace/doc/pages/{id}/projections` | Worker projection writeback |

Worker (integrations group): `/workspace/doc/worker/*`.

## Legacy vs canonical (audit summary)

Removed or deprecated after dependency checks:

- `agent_conversation`, `agent_message` → use `conversation`, `message`
- `tool`, `agent_tool` → use `tool_registry`, `bot_agent_tool`
- `knowledge_base` → use `doc` / `doc_section`
- `pkb_sections` → legacy migration artifact only; new requests use `doc_change_requests` / `workspace_doc_change_requests`

Empty tables are not automatically deleted; verify no API references before removal.

## Related docs

- [04 – Workspace and projects](04-workspace-and-projects.md)
- [06 – Integrations](06-integrations.md)
- [02 – Tenant and hosting](02-tenant-and-hosting.md)
- [README](README.md)
