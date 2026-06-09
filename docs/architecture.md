# Bokito AI OS Architecture

This document describes the Intelligence Stack backbone implemented in `apps/api` (FastAPI) and `apps/dashboard` (bokito mode).

**Product intent (north star for features and agents):** [`CORE_INTENT.md`](CORE_INTENT.md)

## Intelligence Stack layers

The product maps to Salim Ismail's Intelligence Stack as **conceptual lanes** on the OS canvas and in Cockpit metrics — not as separate top-level navigation items.

| Layer | Backend | Frontend |
|-------|---------|----------|
| Sensing | `Signal`, `GET/PATCH/POST /api/signals/*` (inbox-parity), `POST /api/signals/inbound` | Messages hub (`/support/inbox/*`, `/messages`) |
| Interpretation | `interpretation.triage_signal`, `POST /api/signals/{id}/triage` | Inbox triage fields |
| Orchestration | `Agent`, `Workstream`, `AgentLoop`, agenda scheduler | AI OS canvas, Orchestra |
| Integration | `IntegrationConnection`, `McpServer`, MCP HTTP client | Integrations |
| Learning | `Feedback`, `EvalScore`, heuristic guardrails | Cockpit metrics |
| Govern & Assure | `AuditEvent`, `PlatformChange`, passports | `/govern` |

## Platform self-maintenance

Agents propose structural changes through tools (`create_agent`, `update_agent`, `create_workstream`, `update_workstream`, `register_mcp_server`, `connect_integration`, `propose_integration`, `add_graph_node`, `connect_graph_nodes`, `write_blueprint`). Update tools snapshot the current entity into `before_json` so diffs and rollback work; `propose_integration` always routes to a human decision. PO agents are additionally restricted to workstreams within their own project (`agent_can_access_project`).

Every mutation flows through `propose_platform_change()`:

1. **Scope check** — `platform_access.py` (`platform:agent:create`, `platform:graph:edit`, …)
2. **Apply mode** — `resolve_apply_mode()` returns `draft`, `yolo`, or `decision`
3. **Draft queue** — `PlatformChange` with `before_json` / `after_json` snapshots
4. **Apply** — `platform_apply.py` writes domain + syncs canvas overlay
5. **Audit** — `AuditEvent` for propose / accept / reject / yolo / rollback

### Apply mode matrix (defaults)

| Resource type | Default mode |
|---------------|--------------|
| agent, workstream, integration, mcp_server | draft |
| blueprint_block | draft |
| canvas_node layout | yolo (tenant-configurable) |

Configure per tenant: `PUT /api/govern/apply-modes` with `platform_apply_modes` map.

Configure per agent: `autonomy_level` (`manual` / `approval` / `auto`) and `apply_modes_json` overrides.

## Draft lifecycle

```
propose → pending_review → accept → applied (version N+1)
                       └→ reject → discarded
propose → applied_yolo (when yolo mode)
propose → decision → DecisionRequest → approve → accept PlatformChange
```

Rollback: `POST /api/govern/changes/{id}/rollback` (or `/restore`) reverts accepted changes where supported.

## Messages hub (Signal-first)

External email/chat/widget threads and internal agent threads share one `Signal` entity. The dashboard Messages hub (`Communication.tsx`) lists threads via `GET /api/signals` when `VITE_API_MODE=bokito` (`USE_SIGNAL_INBOX`).

- **Folders (UI):** `?folder=external|internal|all` — not separate tables
- **Queues (views):** `all_open`, `mine`, `unassigned`, `pending`, `closed`, `pinned`, `awaiting_decision`, `updates`, `results`
- **Decision cards:** `SignalMessage.kind=decision_request` renders inline in thread timeline; resolve via `POST /api/signals/{id}/messages/{msgId}/resolve`
- **Legacy redirects:** `/messages`, `/communication`, `/os/communication`, `/project/:id/communication` → Messages hub with folder/queue filters
- **Migration:** `scripts/migrate_inbox_to_signals.py` copies legacy `inbox_threads` → `signals`; seed ingests demo decisions into internal Signal threads

## Decisions (unified)

`WorkforceMessage` is removed. Workforce `/api/workforce/messages` reads from `DecisionRequest`.

Approving a decision:

- Executes bound tool via `execute_tool()` when `action_type` is a tool name
- Accepts linked `PlatformChange` when `platform_change_id` is set
- Records audit entry

## Orchestration execution

Long-running background orchestration uses **segment jobs** (ARQ when Redis available; inline fallback in dev/tests).

| Entity | Role |
|--------|------|
| `RuntimeProfile` | Reusable model/tools/autonomy preset (`planner` \| `executor` \| `judge`) |
| `AgentTask` | Durable task; links to internal `Signal` thread |
| `WorkstreamStep` | Binds `agent_id` + optional `runtime_profile_id`; handoff between agents |
| `AgentRun` | Segment execution record with checkpoint + runtime snapshot |
| `EvalCheckpoint` | Self-eval after segment (`rubric`, `tool_assert`, `llm_judge`) |
| `TaskArtifact` | Structured outputs per task |

API: `/api/orchestration/*` (tasks, runtime profiles, workstream steps, run events, automation templates).

Workstream runs create an `AgentTask` and advance steps automatically after eval pass. Set `BOKITO_MOCK_EXECUTION=true` for mock LLM steps in tests.

Token usage is written to `UsageLedger` per segment.

## MCP adapter

`call_mcp_tool` uses mock responses for `mock://` URLs and HTTP JSON-RPC POST for live server URLs.

## Learning loop

1. Users submit `POST /api/learning/feedback`
2. Admin runs `POST /api/learning/process` and `POST /api/learning/eval/compute`
3. Eval scores feed Cockpit; guardrails may tighten `ActionPolicy.mode` when escalation rate is high

No ML fine-tuning in V1 — heuristic only.

## API quick reference

See `apps/dashboard/docs/API.md` for frontend route patterns.

Backend groups (bokito mode, same-origin `/api/*`):

- `/api/govern/*` — audit, passports, changes, apply-modes, **posture** (`GET/PUT /api/govern/posture`)
- `/api/signals/*` — unified sensing
- `/api/learning/*` — feedback and eval
- `/api/notifications/decisions/*` — decision approve/reject
- `/api/workforce/messages/*` — decision list (compat shape)
- `/api/orchestration/*` — agent tasks, runtime profiles, workstream orchestration, run events
