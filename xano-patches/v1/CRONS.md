# Xano scheduled tasks (v1 workforce)

Production-active cron tasks in the Xano workspace. Each task is defined in
`xano-patches/v1/task-*.xs` and lives in the platform `tasks/` collection.

| Cron name | Schedule | Source | Purpose |
| --- | --- | --- | --- |
| `po_heartbeat_dispatcher` | every 60 minutes | `task-po-heartbeat.xs` | For each project with `autonomous_mode=true` and a PO agent, fire `POST {WORKER_BASE_URL}/agent/po/run`. Safety net so PO runs at least once per hour even if no new Blueprint request arrives. |
| `run_reaper` | every 5 minutes | `task-run-reaper.xs` | Mark `work_logs` rows still in `status=running` after 10 minutes as `failed` and append a `reaped_by_timeout` error event. Removes zombie rows from the run list. |
| `tokens_reset_hourly` | hourly | (legacy) | Reset `projects.token_used_this_hour=0`. |
| `tokens_reset_daily` | daily | (legacy) | Reset `projects.token_used_today=0`. |
| `decision_unsnooze_hourly` | hourly | (legacy) | Wake deferred `decision_request` messages whose `resolved_at < now`. |

## How a change request reaches the PO

The PO agent does **not** rely on `po_heartbeat_dispatcher` for fresh user
input. The path is synchronous-on-write:

1. User submits a change request from `apps/dashboard/src/pages/ChangeRequest.tsx`.
2. Browser calls `POST /api:workforce/projects/{project_id}/doc/change-requests` (or workspace equivalent).
3. Xano inserts the `doc_change_requests` / `workspace_doc_change_requests` row, then within the same handler calls `api.request POST
   {WORKER_BASE_URL}/agent/po/run` with `Authorization: Bearer
   {WORKER_INBOUND_SECRET}` and a 10s timeout.
4. The runtime worker accepts the dispatch and enqueues a BullMQ job that
   spawns the PO agent container.
5. The PO agent reads Blueprint context (`runs/context`, doc map) and writes a
   `status_update` or `decision_request` message back to the user.

Expected end-to-end latency from submit to user-visible message: **a few
seconds** when worker capacity is free, up to ~30s under cold-start
(Anthropic + Docker spawn).

If the synchronous dispatch fails (worker unreachable, secret rotation,
`api.request` timeout) the request row remains `pending`, so
`po_heartbeat_dispatcher` picks it up on its next 60-minute tick.

## Required environment variables

- `WORKER_BASE_URL` — e.g. `https://worker.bokito.ai`
- `WORKER_INBOUND_SECRET` — shared secret in `Authorization: Bearer ...`
- `XANO_WORKER_API_KEY` — used by runtime → Xano POST bodies

These are configured via the Xano environment variable manager at the tenant
scope and are referenced as `$env.WORKER_BASE_URL` etc. in XanoScript.

## Verifying a cron has fired

Use the Xano task runner UI or query the table that backs `tasks`:

1. Open `Tasks` in the workspace.
2. Click the task name.
3. Inspect "Recent runs" — there must be at least one entry in the last 5
   minutes for `run_reaper` and at least one entry in the last 60 minutes
   for `po_heartbeat_dispatcher`.

A green run with no error means the task body executed; an "external request"
sub-step inside `po_heartbeat_dispatcher` shows the HTTP response from
`/agent/po/run`.
