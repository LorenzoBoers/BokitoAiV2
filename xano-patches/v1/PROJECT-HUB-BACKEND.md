# Project Hub backend (Xano)

Deploy these patches to the workforce API group (id 15) and integrations group (id 17) after creating the tables below in the Xano workspace.

## Tables

### Project hub config

See sections below for `project_orchestration_config` and `project_notification_preferences`.

### Workspace documentation (tenant-wide)

| Table | Notes |
|-------|--------|
| `workspace_docs` | One row per `tenant_id` (unique) |
| `workspace_doc_pages` | Page tree; `parent_page_id` for chapters |
| `workspace_doc_blocks` | Block content per page |
| `workspace_doc_block_revisions` | Audit trail per block op |
| `workspace_doc_change_requests` | PO agent change requests targeting a page |
| `workspace_doc_write_idempotency` | Cached agent batch responses keyed by idempotency_key |

Extend `index_chunks` with nullable `workspace_doc_id` and `source_type` values `workspace_doc_page` / `workspace_doc_page_summary` for RAG.

`workspace_doc_pages` projection columns: `content_version`, `rendered_markdown`, `rendered_plaintext`, `content_hash`, `last_indexed_at`.

Table definitions: `xano-patches/tables/workspace_*.xs`.

## Workforce API (`/workspace/doc/*`)

| File | Method | Path | API id (deployed) |
|------|--------|------|-------------------|
| workforce-workspace-doc-get.xs | GET | /workspace/doc | 289 |
| workforce-workspace-doc-pages-create.xs | POST | /workspace/doc/pages | 279 |
| workforce-workspace-doc-pages-patch.xs | PATCH | /workspace/doc/pages/{page_id} | 285 |
| workforce-workspace-doc-pages-delete.xs | DELETE | /workspace/doc/pages/{page_id} | 287 |
| workforce-workspace-doc-page-blocks-get.xs | GET | /workspace/doc/pages/{page_id}/blocks | 280 |
| workforce-workspace-doc-page-blocks-batch.xs | POST | /workspace/doc/pages/{page_id}/blocks | 290 |
| workforce-workspace-doc-revisions-list.xs | GET | /workspace/doc/pages/{page_id}/blocks/{block_id}/revisions | 281 |
| workforce-workspace-doc-change-requests-create.xs | POST | /workspace/doc/change-requests | 282 |
| workforce-workspace-doc-pages-projections-patch.xs | POST | /workspace/doc/worker/pages/{page_id}/projections | (worker) |
| workforce-workspace-doc-migrate.xs | POST | /workspace/doc/migrate-from-project | (optional) |

`GET /workspace/doc` returns `{ workspace_doc, pages }` (dashboard normalizes legacy `doc`). When `pages` is empty, the client seeds eight default chapters; when a page exists but has no blocks and its slug matches the scaffold, `ProjectHubDocs` seeds starter blocks on first open.

If starter-block seeding fails at runtime (`POST /workspace/doc/pages/{page_id}/blocks`), the dashboard now renders local scaffold blocks as a UI fallback so `/projects/docs/overview` still shows readable content while backend seed issues are being resolved.

**Live schema:** `workspace_doc_pages` / `workspace_doc_blocks` must not use PostgreSQL default `""` on enum, json, or optional uuid columns (inserts fail with `SQL 22P02`). Match `xano-patches/tables/workspace_*.xs`.

**Blocks GET:** sort by `position` only (`workspace_doc_blocks` has no `created_at`). Use `db.query` with `return = {type: "list", paging: {page: 1, per_page: 1000}}` (same pattern as project `doc_blocks` GET). Do not use `db.direct_query` with the logical table name — PostgreSQL returns `42P01 UNDEFINED TABLE`.

## Integrations worker API (`/workspace/doc/worker/*`)

| File | Method | Path | API id (deployed) |
|------|--------|------|-------------------|
| integrations-workspace-doc-worker-reindex-page.xs | POST | /workspace/doc/worker/reindex-page | 283 |
| integrations-workspace-doc-worker-tree.xs | POST | /workspace/doc/worker/tree | 284 |
| integrations-workspace-doc-worker-blocks.xs | POST | /workspace/doc/worker/blocks | 291 |

User block batch enqueues reindex: `POST {WORKER_BASE_URL}/workspace/doc/reindex-page` with `WORKER_INBOUND_SECRET` and body `{ workspace_doc_id, tenant_id, page_id }`. Runtime coalesces rapid edits (15s) before indexing. Locked pages reject user and agent batch writes server-side. Batch accepts optional `expected_version` for optimistic concurrency.

## Deploy

From repo root (requires `XANO_METADATA_API_KEY` in `.env`):

```bash
node scripts/push-workspace-doc-apis.mjs
```

This updates GET doc, POST blocks batch, worker reindex/tree, and (after first create) worker blocks (291). Other workforce workspace doc endpoints were pushed separately; re-run `scripts/push-xano-api.mjs <api_id> <path>` for one-off updates.

### XanoScript notes (meta API)

When pushing via the Metadata API:

- Use `foreach ($list) { each as $item { ... } }` (not `foreach ($list as $item)`).
- Prefer separate `conditional { if ... }` blocks per op type instead of long `elseif` chains inside `foreach`.
- Use `db.del` (not `db.delete`) for row removal.
- Use inline `db.edit` `data = { ... }` objects instead of `data = $patch` variables.
- Do not use variable or response keys named `doc` in workspace doc XanoScript (Xano can coerce `doc` / `$doc.*` to integer `1`). Use names like `$workspace_doc_row`, `$workspace_doc_id`, and response field `workspace_doc` instead of `doc`. Read UUIDs with `($workspace_doc_rows|first)|get:"id"`.
- `GET /workspace/doc` uses `try_catch` around `workspace_docs` insert and re-queries to survive parallel first loads.

## Other project hub patches

| File | Method | Path |
|------|--------|------|
| workforce-projects-usage-budget.xs | GET | /projects/{id}/usage/budget |
| workforce-projects-orchestration-get.xs | GET | /projects/{id}/orchestration |
| workforce-projects-orchestration-patch.xs | PATCH | /projects/{id}/orchestration |
| workforce-projects-notification-prefs-get.xs | GET | /projects/{id}/notifications/preferences |
| workforce-projects-notification-prefs-patch.xs | PATCH | /projects/{id}/notifications/preferences |
| workforce-projects-usage-summary.xs | GET | /projects/{id}/usage/summary |
| workforce-projects-workstreams-list.xs | GET | /projects/{id}/workstreams | 303 |
| workforce-projects-workstreams-create.xs | POST | /projects/{id}/workstreams | 299 |
| workforce-projects-workstreams-patch.xs | PATCH | /projects/{id}/workstreams/{workstream_id} | 300 |
| workforce-projects-po-agent-patch.xs | PATCH | /projects/{id}/po-agent | 301 |
| workforce-projects-delete.xs | DELETE | /projects/{id} (body: `confirm_name` must match project name) | 302 |
| workforce-runs-complete.xs | POST | /runs/complete (token counters) |
| task-po-heartbeat.xs | task | per-project orchestration dispatch |

Messages list already filters by `project_id`; ensure the `messages` table exposes `project_id` in API responses.

## Worker status summary (optional, phase 2)

The dashboard currently derives per-project worker state client-side (`project-worker-status.ts`, `ProjectHubNavContext`) from:

- `GET /messages?status=awaiting_human` (grouped by `project_id` and `message_type`)
- `GET /work_logs?status=running` and recent logs for last-run failed
- `GET /projects/{id}/orchestration` and `GET /projects/{id}/usage/budget` per project

To reduce N+1 polling, add a bulk endpoint:

| Proposed | Method | Path |
|----------|--------|------|
| workforce-projects-worker-summary-bulk.xs | GET | `/projects/worker-summary` |

Response shape per project:

```json
{
  "items": [
    {
      "project_id": "uuid",
      "blocking_count": 1,
      "attention_count": 0,
      "budget_blocked": false,
      "has_running_work_log": false,
      "last_run_failed": false,
      "continuous_enabled": true,
      "next_po_wake_at": "2026-05-27T08:00:00Z"
    }
  ]
}
```

Blocking count = `decision_request` + `token_limit_reached` with `status=awaiting_human` and `resolved_at` null or in the past.
