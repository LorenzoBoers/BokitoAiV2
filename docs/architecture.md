# Bokito AI OS Architecture

This document describes the Intelligence Stack backbone implemented in `apps/api` (FastAPI) and `apps/dashboard`. The dashboard runs in a single mode against the FastAPI backend (the FastAPI stack is fully sunset).

**Product intent (north star for features and agents):** [`CORE_INTENT.md`](CORE_INTENT.md)

## Intelligence Stack layers

The product maps to Salim Ismail's Intelligence Stack as **conceptual lanes** on the OS canvas and in Cockpit metrics — not as separate top-level navigation items.

| Layer | Backend | Frontend |
|-------|---------|----------|
| Sensing | `Signal`, `GET/PATCH/POST /api/signals/*` (inbox-parity), channel webhooks (`/api/channels/...`) | Messages hub (`/messages`) |
| Interpretation | `interpretation.triage_signal`, `POST /api/signals/{id}/triage` | Inbox triage fields |
| Orchestration | `Agent`, `Workstream`, `AgentLoop`, `Trigger` scheduler | Agents, Automations |
| Integration | `IntegrationConnection`, `McpServer`, MCP HTTP client | Integrations |
| Learning | `Feedback`, `EvalScore`, heuristic guardrails | Cockpit metrics |
| Govern & Assure | `AuditEvent`, `PlatformChange`, passports | `/govern` |

## Tool layer (unified registry + allowance policy)

All governed capabilities live in `apps/api/app/tools/`:

- `registry.py` — `ToolSpec` (name, category, schema, handler) registered into one registry. Categories: `messaging`, `workspace`, `agents`, `channels`, `triggers`, `integrations`, `govern`.
- `policy.py` — allowance engine. Each category has a slider `deny | ask | allow`.
- `builtin.py` — built-in tool implementations (messaging, workspace docs, platform mutations, MCP client).
- `executor.py` — `execute_tool()`: the **single execution path** for every tool call.

Two consumers, one implementation:

1. **Internal agents** — `AgentLoop` gets tool definitions from the registry (filtered by passport `tools_json`) and calls `execute_tool()`.
2. **External MCP clients** — `POST /api/mcp` (JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`) authenticated with scoped `ApiToken`s (`bok_...`, SHA-256 stored, managed at `GET/POST/DELETE /api/govern/tokens`). Calls run with `trust="api"`.

### Allowance resolution (per call)

1. Ungated/read-only tools → allow
2. Tenant posture preset → category defaults (`manual` = ask everywhere; `assisted` = messaging/workspace allow, rest ask; `autonomous` = allow except integrations ask)
3. Tenant category sliders (`tool_allowances` in settings, `PUT /api/govern/allowances`)
4. Agent passport `autonomy_level`: `manual` caps allow→ask; `auto` lifts ask→allow
5. Per-tool override (`tool_overrides`, `PUT /api/govern/tool-overrides`; "Voortaan automatisch oppakken" writes `allow`)
6. Trust clamp: `external` (widget/visitor) sessions never auto-mutate — allow→ask, and `agents/channels/triggers/integrations/govern` are denied outright

Outcomes: **deny** → audited error; **ask** → inline `DecisionRequest` (platform tools additionally record a pending `PlatformChange`); **allow** → execute + audit. Decision approval re-runs the tool with `approved=True`.

## Platform self-maintenance

Agents propose structural changes through registry tools (`create_agent`, `update_agent`, `create_workstream`, `update_workstream`, `register_mcp_server`, `connect_integration`, `propose_integration`, `add_graph_node`, `connect_graph_nodes`, `write_doc`). Update tools snapshot the current entity into `before_json` so diffs and rollback work; `propose_integration` always routes to a human decision. PO agents are additionally restricted to workstreams within their own project (`agent_can_access_project`).

Platform mutations flow through `propose_platform_change(mode=...)` where the allowance engine already resolved the mode:

1. **Scope check** — `platform_access.py` (`platform:agent:create`, `platform:graph:edit`, …)
2. **`mode="apply"`** — applied immediately via `platform_apply.py` (status `applied_yolo`), audit + versioned rollback record
3. **`mode="ask"`** — pending `PlatformChange` + inline `DecisionRequest`; approval applies the change
4. **Audit** — `AuditEvent` for propose / accept / reject / apply / rollback

## Change lifecycle

```
ask → pending_review → accept → applied (version N+1)
                   └→ reject → discarded
allow → applied_yolo (immediate, with rollback record)
```

Rollback: `POST /api/govern/changes/{id}/rollback` (or `/restore`) reverts accepted changes where supported.

## Gateway control plane

All live data flows over one WebSocket endpoint: `GET /api/ws` (`app/gateway/`).

- **Protocol:** client `connect` / `sub` / `unsub` / `ping`; server `connected` / `sub_ok` / `event` / `pong`. Event frames: `{type: "event", event, topics, data, ts}` with event one of `message`, `thread`, `agent.run`, `decision`, `notification`, `presence`.
- **Topics:** `threads`, `runs`, `decisions`, `notifications`, `presence` (operator-wide), `run:<id>`, `signal:<id>` (scoped). Widget principals may only subscribe to their own `signal:<id>` threads (Contact / owner check).
- **Auth:** dashboard JWT or widget session token via `?access_token=` or a `connect` frame; `device` identifies the client surface.
- **Fanout:** in-process + Redis pub/sub (`bokito:gateway:events`) so ARQ workers and multiple web workers reach WS clients; degrades to single-process without Redis.
- **Publishers:** `app/gateway/publish.py` — called from signal services (messages, thread updates, triage), decision creation/resolution, run event logging, and notification creation.
- **Clients:** dashboard `lib/gateway.ts` (reconnecting singleton; LiveWorkLog, NavBadgeContext, useThreads), chat widget `RealtimeClient`. The orchestration run-events SSE endpoint was removed; `POST .../stream-chat` fetch-SSE remains only for in-flight token streaming of a reply.

## Messages hub (Signal-first)

`Signal`/`SignalMessage` is the **only** conversation model. The legacy `Conversation`, `InboxThread`, and `EmailThread` stacks (models, routers, services, tables) were removed in the Bokito OS Phase 1 restructure; a one-time startup migration (`app/db/schema_patch.py::_migrate_legacy_threads_to_signals`) copies legacy rows into `signals`/`signal_messages` and drops the old tables.

Channel layer (`app/models/channel.py`):

- `ChannelAccount` — tenant-owned connection to an external surface (email mailbox, widget, Slack workspace). Replaces `EmailAccount`.
- `Contact` — external participant identity per channel (customer email, anonymous widget visitor, Slack user) with `approved`/`pending`/`blocked` status for pairing/allowlists.

Channel → Signal mapping:

| Channel | Signal fields |
|---------|---------------|
| `assistant` (logged-in personal assistant chat) | `owner_user_id` |
| `widget` (anonymous visitor) | `contact_id` |
| `email` | `channel_account_id` (+ `contact_email`) |
| `internal` (agent/task threads) | `agent_id` / `task_id` |

- **Folders (UI):** `?folder=external|internal|all` — not separate tables
- **Queues (views):** `all_open`, `mine`, `unassigned`, `pending`, `closed`, `pinned`, `awaiting_decision`, `updates`, `results`
- **Decision cards:** `SignalMessage.kind=decision_request` renders inline in thread timeline; resolve via `POST /api/signals/{id}/messages/{msgId}/resolve`. `DecisionRequest.signal_id` is the only thread link (`conversation_id` removed)
- **Chat APIs:** `/api/chat/*` and `/api/livechat/*` keep their contracts but persist to Signal threads (`/api/widget` was removed in favor of `/api/livechat`); inbound email processing runs through the `process_inbound_signal` worker task
- **Legacy redirects:** `/messages`, `/communication`, `/os/communication`, `/project/:id/communication` → Messages hub with folder/queue filters

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
| `AgentTask` | **The one Task ledger**: orchestration job, project queue item, or human task (`origin`: manual \| chat \| inbound \| trigger \| queue \| delegation; `assignee_kind`: agent \| human; `scheduled_for` for planned/dormant tasks) |
| `Agent` | One passport: model/tools/autonomy live on the agent (RuntimeProfile is folded in; presets are data) |
| `WorkstreamStep` | Binds `agent_id`; handoff between agents |
| `AgentRun` | Segment execution record with checkpoint + runtime snapshot |
| `EvalCheckpoint` | Self-eval after segment (`rubric`, `tool_assert`, `llm_judge`) |
| `TaskArtifact` | Structured outputs per task |

API: `/api/orchestration/*` (tasks, workstream steps, run events).

Workstream runs create an `AgentTask` and advance steps automatically after eval pass. Set `BOKITO_MOCK_EXECUTION=true` for mock LLM steps in tests.

Token usage is written to `UsageLedger` per segment.

### Task ledger (lazy promotion)

Plain chat Q&A stays Run-only. `app/services/task_ledger.py` promotes a run to a Task at its first real-work tool call (mutating/gated tools and all module tools; pure replies excluded) and `settle_run_task` mirrors the run's terminal status back at every finalize site. Non-heartbeat trigger fires always carry a Task. Scheduled Tasks (`scheduled_for`) are woken by the trigger-scheduler tick (`process_due_scheduled_tasks`): agent tasks enqueue a run segment, human tasks flip to `awaiting_human` and notify.

Agents self-schedule through governed tools: `schedule_task` (plan a Task for later, for self, a peer, or a human) and `schedule_wake` (create a Trigger: once / cron / interval). Both are gated + mutating, so posture and allowances apply.

### Module backbone (generic)

`ModuleInstall` anchors per-tenant module state. `call_module_verb(slug, verb, args)` (`app/modules/dispatch.py`) routes to provider packages by convention (`app.modules.{slug}.router`); tools auto-register from `ModuleSpec.tool_cards` as `{slug}_{verb}` (read / propose / apply). Writes need `MODULE_WRITES_ENABLED` (env, comma-separated slugs) + the tenant's `writes_enabled` pref. Accounting is the first provider; banking (GoCardless read-only) proves the backbone needs zero shared-code edits per module.

### Agent resource scopes

`AgentScope` generalizes the module roster pattern: per-agent allowlists per resource kind (`project` \| `knowledge` \| `channel`) with `can_write` per row; no rows = unrestricted. Enforced centrally in `execute_tool` (out-of-scope project calls are denied and audited). Channel AI mode (`suggest|auto|off`) is a **view over the Govern messaging allowance**: `deny` → off, `ask` clamps auto → suggest, `allow` passes the channel mode through — one policy engine.

## Triggers and routing (scheduler)

`Trigger` (`app/models/trigger.py`) is the single schedulable entity, replacing orchestra `Task` (orchestra_tasks), `AutomationTemplate`, and agenda wake events (all dropped by schema patch with a one-time data migration).

- **Kinds:** `cron` (5-field expression, minimal parser in `services/triggers.py`) | `interval` (minutes) | `heartbeat` | `webhook` (fired externally via `POST /api/hooks/{trigger_id}` with a per-trigger shared secret)
- **Firing (`fire_trigger`):** workstream-bound triggers start an `AgentTask`; otherwise the resolved agent (explicit `agent_id` or `agent_role` fallback) runs one `AgentLoop` chat turn with the trigger instructions
- **Heartbeat:** the prompt embeds all `heartbeat`-kind workspace docs as a checklist; an agent reply of exactly `HEARTBEAT_OK` is suppressed, anything else is posted to an internal Signal thread so it surfaces in Messages. New tenants seed a disabled 30-minute heartbeat trigger
- **Scheduler:** in-process loop (`services/trigger_scheduler.py`, 60s tick, `TRIGGER_SCHEDULER_ENABLED`) plus an ARQ job (`process_due_triggers_job`); replaced the agenda scheduler
- **API:** `GET/POST /api/triggers`, `PATCH/DELETE /api/triggers/{id}`, `POST /api/triggers/{id}/run`, public `POST /api/hooks/{id}`
- **UI:** Automations page (`/automations`) Triggers tab (list, enable/disable, run now, delete)

`ChannelBinding` (`app/models/channel.py`) gives deterministic inbound routing (`services/routing.py`): most specific enabled binding wins — contact > channel account > channel-wide (by `priority`), falling back to the tenant's active assistant agent. Used by the inbound signal worker, widget chat, livechat stream, and assistant chat. API: `GET/POST /api/channels/bindings`, `DELETE /api/channels/bindings/{id}`.

## Channel adapters (email + Slack)

`apps/api/app/channels/` normalizes every external surface into the Signal model:

- **`base.py`** — `InboundMessage` (provider-agnostic dataclass) and `ingest_inbound()`: resolves or creates the `Contact`, applies pairing rules, dedupes by `external_id`, then creates or extends the `Signal` thread and enqueues agent processing. `BlockedContactError` rejects blocked senders.
- **`email.py`** — `normalize_inbound()` for generic email webhook payloads; `send_via_provider()` delivers outbound mail (mock, Gmail API, Outlook Graph via the account's OAuth tokens).
- **`slack.py`** — `verify_signature()` (Slack signing secret, v0 HMAC), `normalize_inbound()` for Events API messages, `send_message()` via `chat.postMessage`.
- **`outbound.py`** — `deliver_outbound()`: picks the adapter from the signal's channel + `ChannelAccount` and returns a send status; `reply_to_thread` and the email send endpoint both route through it.

**Contact pairing:** `ChannelAccount.settings_json.require_pairing` puts first-time senders in `pending` — their threads are held from agent processing until an operator approves the contact (`PATCH /api/channels/contacts/{id}`); `blocked` contacts are rejected at the webhook.

**Webhook endpoints:** `POST /api/channels/email/inbound/{account_id}` (shared-secret auth) and `POST /api/channels/slack/events/{account_id}` (signature verification + `url_verification` handshake). Channel account + contact CRUD lives under `GET/POST/PATCH/DELETE /api/channels/accounts` and `/api/channels/contacts`.

## Frontend consolidation (single mode)

The dashboard has one API mode: same-origin `/api/*` to FastAPI (Vite dev proxy via `VITE_BOKITO_API_URL`; same origin in production). `lib/bokito-api.ts`, `VITE_API_MODE`, and all `isBokitoMode()` branching were removed; transport is `lib/api.ts` (REST) + `lib/gateway.ts` (WS).

Navigation is eight sections: **Home** (Cockpit), **Messages**, **Agents**, **Workspace**, **Automations**, **Integrations**, **Govern**, **Settings**. The Project hub, Custom DB, AI OS canvas pages, Orchestra page (renamed Automations), and legacy duplicate pages were deleted (~35 pages removed).

## Native mobile app (Expo)

`apps/mobile` is an Expo (expo-router) client on the same gateway protocol as the dashboard:

- **Auth:** `POST /api/auth/login`; the access token is persisted in `expo-secure-store` and the session bootstraps via `GET /api/auth/me`
- **Gateway:** WS client connects to `/api/ws?access_token=...&device=mobile`, subscribes to `threads`, `signal:<id>`, and `decisions` topics, and reconnects with backoff + automatic re-subscribe
- **Surfaces:** Assistant tab (Signal-backed chat via `/api/chat/conversations*`), Messages tab (unified inbox via `/api/signals` with Open/Mine/Unassigned/Decisions views), Decisions tab (`/api/notifications/decisions` approve/reject), thread detail with inline decision cards (`POST /api/signals/{id}/messages/{mid}/resolve`) and a reply composer
- **Push:** Expo push tokens register via `POST /api/push/subscribe` with an `expo:` endpoint prefix; `services/push.py` delivers `expo:` endpoints through the Expo push API and everything else through web push (VAPID)
- **Retired:** the `apps/messenger` PWA and the entire `packages/messenger-ui` package are deleted; the native app and the `apps/chat-widget` embed replace them

## Workspace (markdown memory, persona, skills)

`WorkspaceDoc` (`app/models/workspace.py`) replaces the Blueprint stack: tenant-scoped markdown files with a stable `path` (e.g. `memory.md`, `skills/triage.md`) and a `kind` (`doc | memory | persona | skill | daily_log | heartbeat`). Frontmatter (`---` header) is parsed into `frontmatter_json`. Every write re-chunks the body into `DocChunk` rows (per-heading sections, embeddings stored as JSON) used by hybrid retrieval (0.6 vector + 0.4 keyword).

- **API:** `GET/POST /api/workspace/docs`, `GET/PATCH/DELETE /api/workspace/docs/{id}`, `POST /api/workspace/search`
- **Agent tools:** `list_docs`, `read_doc`, `write_doc` (governed: `workspace_doc` PlatformChange, `platform:doc:write` scope), `search_index`
- **Context assembly (`AgentLoop._build_system_prompt`):** persona doc + long-term memory + compact skills list (frontmatter `name`/`description` only; the agent reads the body on demand via `read_doc`) + hybrid-search hits for the current query
- **Thread compaction (`services/assistant_threads.py`):** past 40 LLM-eligible messages on a Signal thread, older turns are summarized into `Signal.compact_summary` (last 12 stay verbatim); durable facts are flushed to `memory.md` before summarizing
- **Bootstrap:** new tenants seed `persona.md`, `memory.md`, `company.md`, `heartbeat.md`; the schema patch migrates legacy `blueprint_*` content into `workspace_docs` and drops the old tables
- **UI:** `/workspace` (`WorkspaceDocs.tsx`) — kind-grouped doc list, markdown editor/viewer, search

## MCP adapter

`call_mcp_tool` uses mock responses for `mock://` URLs and HTTP JSON-RPC POST for live server URLs.

## Learning loop

1. Users submit `POST /api/learning/feedback`
2. Admin runs `POST /api/learning/process` and `POST /api/learning/eval/compute`
3. Eval scores feed Cockpit; guardrails may tighten the tenant autonomy posture when escalation rate is high

No ML fine-tuning in V1 — heuristic only.

## API quick reference

See `apps/dashboard/docs/API.md` for frontend route patterns.

Backend groups (bokito mode, same-origin `/api/*`):

- `/api/govern/*` — audit, passports, changes, **allowances** (`GET/PUT /api/govern/allowances`, `PUT /api/govern/tool-overrides`), **posture** (`GET/PUT /api/govern/posture`), **tokens** (`/api/govern/tokens`)
- `/api/mcp` — tenant-scoped MCP server (JSON-RPC over HTTP, `bok_...` bearer tokens)
- `/api/signals/*` — unified sensing
- `/api/workspace/*` — markdown docs (memory, persona, skills) + hybrid search
- `/api/learning/*` — feedback and eval
- `/api/notifications/decisions/*` — decision approve/reject
- `/api/workforce/messages/*` — decision list (compat shape)
- `/api/orchestration/*` — agent tasks, runtime profiles, workstream orchestration, run events
- `/api/triggers`, `/api/hooks/{id}`, `/api/channels/bindings` — scheduler and inbound routing
