# Workforce and agents

Last updated: May 2026

Bokito's **workforce** layer runs AI agents against projects: orchestrated work logs, human-in-the-loop decisions, indexing, and messaging.

## Concepts

| Term | Meaning |
|------|---------|
| **Agent** | Configured AI worker (prompt, tools, model) in FastAPI `agents` table |
| **Work log** | Single agent run instance (UUID); container auth token |
| **Message** | Workforce communication: `task_result`, `decision_request`, `status_update`, etc. |
| **PO agent** | Product-owner orchestrator that reads project/workspace Blueprint context and open change requests |

## Runtime worker plane

| Component | Location |
|-----------|----------|
| HTTP API | `https://worker.bokito.ai` (Caddy → `127.0.0.1:3300` on VPS) |
| Code | `apps/runtime/` |
| Queue | BullMQ + Redis on VPS |
| Agent execution | Docker containers from `packages/docker/agent-run` |
| Embeddings | Ollama on host (`nomic-embed-text-v2-moe`) |

FastAPI crons trigger runs: `POST {WORKER_BASE_URL}/agent/po/run` with `Authorization: Bearer {WORKER_INBOUND_SECRET}`.

Runtime calls FastAPI `/api/workforce` with `worker_api_key` in JSON bodies. Agent containers use `auth_token` = `work_log_id` in the body (Bearer optional on `auth = false` endpoints).

### Key worker endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/runs/start` | Start run |
| POST | `/runs/context` | Load run configuration |
| POST | `/runs/complete` | Complete run with status/tokens |
| POST | `/work_logs/{id}/events` | Append live events |
| POST | `/messages/worker` | Write workforce messages |
| POST | `/index/chunks` | Index content chunks |
| GET | `/projects/{id}/budget` | Budget check |
| POST | `/workspace/doc/reindex-page` | Coalesced doc reindex (15s debounce) |

Deploy: `scripts/deploy-runtime-vps.sh`, `scripts/vps-redeploy.py`.

## PO agent flow (V1)

1. Change request is created on project or workspace Blueprint
2. FastAPI may fire synchronous `POST .../agent/po/run` (10s timeout)
3. Runner loads context via `runs/context` (project name, scope, pending Blueprint request)
4. Agent tools: `log`, `read_doc_page`, `write_doc`, `write_decision_request`, `write_status_update`
5. Events stream to `/work_logs/{id}/events`; completion via `/runs/complete`

**Run reaper cron:** every 5 minutes, marks runs stuck in `running` >10 min as `failed`.

## Where to find runs in the UI

There is **no** global "all runs" page. Runs appear in:

1. **Per agent** – `/ai/agents/:agentId` and `/ai/agents/:agentId/runs/:workLogId`
2. **Per project** – `/project/:id/workforce` and `/project/:id/workforce/:workLogId`
3. **Hub overview** – recent runs on `/projects` and `/home` linking to project run detail

Legacy `/admin/runs/:workLogId` redirects via `AdminRunLegacyRedirect` to project-scoped URL when possible.

## Portal workforce APIs (user JWT)

Tenant-scoped read APIs include:

- `GET /work_logs` – list runs
- `GET /work_logs/{id}/events` – live detail
- `GET /messages` – filtered messages
- `GET /projects`, `PATCH /projects/{id}`

Live UI component: `LiveWorkLog` (`apps/dashboard/src/components/observability/LiveWorkLog.tsx`).

## MCP for external clients

Package: `packages/bokito-workforce-mcp` – stdio MCP server for workforce operations on FastAPI orchestrator and runtime API groups. Tenant-scoped via token per deployment.

## Crons and verification

- Cron list: [`docs/archived/v1/CRONS.md`](../../docs/archived/v1/CRONS.md)
- Smoke checklist: [`docs/archived/v1/VERIFICATION.md`](../../docs/archived/v1/VERIFICATION.md)
- Smoke project id (example): `7baa7578-2119-40a5-bbde-b1bb3e2ef27d` (`worker-smoke-v1`)

## Related docs

- [04 – Workspace and projects](04-workspace-and-projects.md)
- [09 – Infrastructure and deploy](09-infrastructure-and-deploy.md)
- [11 – Business rules and glossary](11-business-rules-and-glossary.md)
- [README](README.md)
