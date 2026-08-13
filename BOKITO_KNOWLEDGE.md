# Bokito Platform – Product Knowledge Base

> **Levend document.** Elke keer dat nieuwe informatie wordt geleerd over hoe het Bokito platform werkt — qua features, workflows, SOPs, configuraties of business rules — wordt dit bestand bijgewerkt.
>
> **English company handbook:** structured docs for onboarding and ops live in [`docs/company/README.md`](docs/company/README.md).

### Repo-scope (bokitoAiV2)

Deze repository bevat `apps/dashboard` (portal), `apps/chat-widget`, `apps/api` (FastAPI backend), `apps/mobile` (Expo), en `packages/shared`. Lokale dev: `docker compose -f docker-compose.dev.yml up`, daarna `uvicorn` in `apps/api` en `npm run dev` in `apps/dashboard`. Zie `README.md` en `docs/architecture.md`.

**Stack:** FastAPI + SQLModel + Postgres/pgvector + Redis/arq. Dashboard in bokito mode (`VITE_API_MODE=bokito`) proxied `/api/*` naar de API. Geen externe BaaS-backend meer in deze repo.

**Deploy:** één Hostinger VPS (`31.97.45.44`) draait de hele stack via Docker Compose + Caddy (`docker-compose.prod.yml`: postgres/pgvector, redis, api, worker, web). Live op `bokito.ai` / `app.bokito.ai` / `api.bokito.ai` (Cloudflare proxied A-records → VPS). Details + cutover: sectie 17. Widget bundle: `/chat-widget/bokito-chat.js` (één bundle; `data-auth-mode` bepaalt visitor vs logged-in). Livechat API: `/api/livechat/*`.

**Tenant routing:** alle hosts (`bokito.ai`, `app.bokito.ai`, `api.bokito.ai`, `*.bokito.ai`) gaan rechtstreeks naar de VPS-Caddy → FastAPI; de oude Cloudflare Workers (`bokito-tenant-router`, `bokito-app-passthrough`) zijn verwijderd. Control-plane = `app.bokito.ai`; cross-host session-handoff via URL-fragment `__bokito_at__=<accessToken>` (`lib/host-routing.ts`, host-driven via `VITE_APP_CONTROL_PLANE_HOST`/`VITE_TENANT_ROOT_DOMAIN`).

**Zichtbare build-versie in UI:** Login toont onderaan `build: <versie>`; `VITE_APP_VERSION` wordt bij productie-builds gezet.

---

## 1. Platform Overzicht

Bokito is een AI-platform waarmee bedrijven (voornamelijk SMBs) AI-agents kunnen inzetten voor dagelijkse operaties. Het platform bestaat uit vier applicaties:

| App | Type | Primaire gebruiker |
|---|---|---|
| **Dashboard (portal)** | React webapp | Admin / operations manager |
| **Mobiele app** | Expo (React Native) | Eindgebruiker / medewerker |
| **Chat widget** | TypeScript + Vite IIFE embed | Websitebezoeker / klant |
| **Website** | Statische marketing site | Potentiële klant |

Op de marketing website (`apps/website`) tonen de hoofdnavigatie (Navbar) tijdelijk geen links naar `/pricing` en `/kennisbank`; die pagina’s blijven bereikbaar via directe URL.

Tech stack: React + TypeScript + Vite + Tailwind (`apps/dashboard`). Backend: FastAPI (legacy portal APIs) plus **Bokito AI OS** Python/FastAPI backend (`apps/api`) for V1 migration. The former `apps/messenger` PWA and shared `@bokito/messenger-ui` package are deleted (2026-07); the embeddable widget is `apps/chat-widget`.

### Bokito AI OS (V1, 2026-06)

**Product north star (why and how to align features):** [`docs/CORE_INTENT.md`](docs/CORE_INTENT.md). **Market positioning:** [`docs/POSITIONING.md`](docs/POSITIONING.md) — one-liner: *The inbox, the agents, and the approvals — finally in one system.*

- **Backend:** `apps/api` — FastAPI + SQLModel + Alembic + Postgres/pgvector + Redis/arq workers.
- **Auth:** signup (tenant+owner), invite/accept, staff-login + switch-tenant, roles `owner|admin|member`, JWT with `staff` claim, subdomain tenant routing (`*.bokito.ai`).
- **Workspace sessions (2026-07, cycle 1):** the JWT `tenant_id` is the single source of truth for the active workspace. `POST /api/auth/switch-workspace` re-scopes the token for any member with a membership (staff may enter any tenant, logged in `StaffAccessLog`); `POST /api/app/workspaces` returns a `session.access_token` scoped to the new tenant which the dashboard adopts with a full reload; `User.last_tenant_id` is persisted on signup/login/switch/create/invite-accept so login and refresh land in the last-used workspace (staff refresh honors it even without a membership). Frontend: `AuthContext.switchWorkspaceTenant`/`adoptWorkspaceSession` store the token in sessionStorage and `window.location.assign('/')`; `WorkspaceContext.switchWorkspace` only mutates local state when the target equals the JWT tenant. Fresh-tenant bootstrap is clean (assistant + personal agent, 4 workspace docs, runtime profiles, disabled heartbeat trigger — no demo project/orchestrator/workstream, no pre-created threads). Recurring triggers reuse one internal Signal thread via `Trigger.signal_id` (fallback: tenant `operations_signal_id`). Onboarding: `GET /api/app/onboarding` computes a checklist (company doc filled, first assistant chat, channel connected, team invited) from live data; the Communication empty state renders `OnboardingChecklist` until complete. Integrity tooling: `apps/api/tests/test_tenant_isolation.py` + `scripts/ops/audit-tenant.py` (cross-tenant FK audit + per-tenant row counts).
- **Backend consolidation (2026-07, cycle 2):** canonical stacks only — orchestration lives fully under `/api/orchestration/*` (settings, workstreams CRUD, tasks, runs); the legacy `/api/orchestra` router, `AgentProfile`/`WorkstreamRun`/`WorkstreamStepRun` models and `orchestra_runner.py` are deleted (tables dropped by `schema_patch`). `/api/widget`, `/api/settings/llm-keys` and legacy `/api/email/threads*` are removed; `/api/livechat` is the only widget API and `/api/signals` the only inbox API. `settings_orchestra.py` became `inbox_settings.py` (inbox settings, feedback, notification prefs only). Notifications are wired end-to-end: `GET /api/notifications` + `POST /{id}/read` + `POST /read-all`, dashboard `NotificationContext` fetches from the API and subscribes to gateway `notification` events. **Reliability:** the in-process API scheduler (`trigger_scheduler.py`, 60s tick) is the canonical scheduler for triggers and runs the learning cycle hourly for `learning_enabled` tenants; the ARQ worker only handles queued jobs + mailbox polling cron. Redis enqueue failures and scheduler heartbeat are recorded in `services/runtime_health.py` and exposed via `GET /api/health/ready` (`runtime` field). **Security:** in-memory rate limiting (`middleware/rate_limit.py`) on login/signup/refresh/password-reset, `POST /api/hooks/{id}` and livechat session start; refresh tokens stored as SHA-256 digests (O(1) lookup, `Session.refresh_token_hash` indexed); prod validator also enforces `WORKER_INBOUND_SECRET` strength and complete OAuth client-id/secret pairs; mock OAuth and `POST /api/email/mock/inbound` are disabled in production. Smoketest: `scripts/dev/smoketest-core-flows.py` (13 checks: health, signup, onboarding, refresh, mailbox connect, mock inbound, trigger thread reuse, decisions, rate limit). **Open finding:** the mobile app still consumes `/api/notifications/decisions*` as its decisions list; those endpoints stay until mobile migrates to signal-based decisions.
- **IA + UX system (2026-07, cycle 3):** the rail has 7 items in 3 groups — Control (Cockpit, Communication, Contacts, Agenda), Agent (Agents, Knowledge), Settings. Cockpit merges Overview/Activity/Usage as inner tabs (`/cockpit`, `/cockpit/activity`, `/cockpit/usage`, component `CockpitTabs`); Knowledge = `WorkspaceDocs` at `/knowledge` (Skills page merged in); Personal settings merge Profile + Access & security into one "Profile & security" page; Members page no longer has the localStorage-only Teams UI. Legacy routes redirect (`/overview`, `/activity`, `/usage`, `/skills`, `/workspace[/:docId]`, `/home`, `/os/docs*`). Dead UI removed: mock data files, home widgets, `LlmKeysSettings`, `os-api.ts`, Billing/Support stub pages (uit portal-nav), "Coming soon" chips op New conversation, `href="#"`-links op Workspaces. Rail/topbar/command palette are i18n-driven via `nav.json` keys `tabs.*`, `tabGroups.*`, `topbar.*`, `palette.*` (EN base + NL). Inbox composer/timeline strings are English (EN base). Self-service signup lives at `/signup` (`authSignup` in `lib/api.ts`, `AuthContext.signup`); the onboarding checklist is dismissible per tenant (localStorage key `bokito-onboarding-dismissed:{tenantId}`). **Cycle 4 cleanup (2026-07):** the dashboard EN base is complete — `CompanyConfig`, `MemberManagement`, `InboxSettings`, `ResetPassword`, `ThreadDetail`, `form-validation`, `agentSteps` and integration/MCP descriptions were converted from hardcoded Dutch to English. The fake "brand scanner" banner on Company config (simulated scan with hardcoded colors) and the dead "Wijzigen" subdomain button were removed. The orphaned `/onboarding` 3-step wizard (route, `Onboarding.tsx`, `OnboardingStep1-3`, unused `FIELD_TYPE_META`) was deleted; the dismissible onboarding checklist in Communication is the only onboarding surface. **Known post-MVP items:** full NL translations exist only for the i18n namespaces (nav, communication, common); other pages are EN-only (consistent, no per-page mixing). Mobile still uses `/api/notifications/decisions*`; assistant-chat E2E with a live LLM is not covered by automated tests.
- **Communication UX + user management (2026-07, cycles 8-11):** Decision resolution writes no extra chat messages — the resolved state lives on the `DecisionRequest` (status + chosen option) plus a `decision_{action}` SignalEvent; `/api/chat` messages carry `kind` and an embedded server-driven `decision` payload (id/status/title/options/chosen_option_id) so `DirectChatPanel` renders one card that survives reload, and `system_event` messages render as subtle dividers. **User management:** transactional mail via `services/transactional_mail.py` (SMTP_* env vars; without SMTP_HOST mail is logged and non-production auth responses expose `dev_token`/`dev_link`); invites store `invited_by_user_id`, mail an accept link, and the Members page has Copy-invite-link + revoke (`DELETE /api/app/workspaces/{id}/invites/{inviteId}`); `/accept-invite?token=` is a public dashboard page (`GET /api/auth/invite-info` preview; existing accounts must confirm their current password — the invite token alone never grants a session; duplicate memberships are guarded). Member management: `PATCH/DELETE /api/app/workspaces/{id}/members/{memberId}` (UUID or numeric id) with a single-owner model — promoting to owner demotes the previous owner to admin, the last owner can't be demoted/removed, self-removal is blocked. Canonical roles are `owner|admin|member` in the frontend too (`USER_ROLES`; the old `editor|viewer` mapping that gave members zero permissions is gone). Email change via `PATCH /api/auth/profile` flips `email_verified` off and sends a verification link; `POST /api/auth/delete-account` (password-confirmed) anonymizes the user (FK-safe), deletes sole-member workspaces and blocks when the user is the last owner of a shared workspace; the 2FA stub row is removed and the duplicate `/api/auth/auth/*` routes are gone (frontend `authRoutes.session` now hits the canonical paths). **Mentions & inline agents:** messages use `@[Name](user:123)` / `@[Name](agent:uuid)` markup (`lib/mentions.ts`); ReplyComposer has an @-popover (members via shared `useMembers` hook + agents), chips render via `.mention-chip`; backend `notify_mentions` in `signal_threads.py` creates per-user `Notification` rows (kind `mention`, respects the `mentions` pref) and assignment via `patch_thread` notifies the new assignee (kind `assignment`, `assigned-to-me` pref, no self/duplicate notifications). `GET /api/notifications` is now a personal feed (own rows + tenant broadcasts). `POST /api/signals/{id}/invoke-agent` (`agent_id`, `instruction`, `output: note|reply_suggestion`) runs the agent over the thread transcript; notes land as internal `SignalMessage` (+ `agent_invoked` event), suggestions reuse `create_reply_suggestion`; the dashboard auto-invokes agents that are @-mentioned in a note. **Ask assistant grounding:** conversations created with `context_signal_id` (POST `/api/chat/conversations`) get the live source-thread transcript injected into the LLM history each turn (`context_thread_transcript`); Draft with AI has an optional guidance popover (instruction reaches `POST /api/signals/{id}/draft`). Verification: `tests/test_user_management.py`, `test_mentions_notifications.py`, `test_invoke_agent.py`, `test_ask_grounding.py`; live scripts `scripts/dev/e2e-usermgmt-c9.py` and `e2e-mentions-agents-c1011.py`.
- **Completeness sprint (2026-08, cycles 28-32):** Five implement-test-repeat cycles toward the first accountancy client. **Security + email correctness:** `GET /uploads/files/{tenant}/{file}` requires auth (Bearer or refresh cookie for browser subresources) with tenant match and path-traversal guards; server-side attachment reads bypass HTTP via `storage._local_file_for_url`. Ingest persists RFC `Message-ID`/`References` (Gmail headers, Graph `internetMessageId`); replies thread via those headers (Gmail) or the Graph `/messages/{id}/reply` endpoint (Outlook — Graph rejects manual `In-Reply-To`). `/api/email/send` delivers `cc`/`bcc`/`body_html`/attachments end-to-end; Outlook and Gmail attachments are downloaded at sync (`_hydrate_attachments`, 15MB cap) and served from uploads. **Microsoft SSO:** `GET /api/auth/microsoft/start` (public) + shared OAuth callback with `flow="login"` — `OAuthState.tenant_id` is nullable, `services/sso.provision_sso_user` finds-or-creates a passwordless user (`password_hash=""`) + workspace, mints refresh cookie; password endpoints guard passwordless accounts (initial password set allowed without current). Frontend: `MicrosoftSignInButton` on Login/Signup, `sso=connected` return handling in AuthContext, `sso_error` reasons mapped. One Entra app serves SSO + mailbox (see `docs/PRODUCTION_READINESS.md`). **Prod hardening:** boot fails when `LLM_MODE != live` or `BOKITO_MOCK_EXECUTION` set; mock MCP servers refused at install/test/call; GitHub mock repos/branches and mock OAuth disabled in prod; `BJORN_LUNDEN_MCP_URL` env feeds the BL catalog entry. Email sync polls each selected folder with per-folder cursors (`settings.sync_cursors`; Graph well-known folders, Gmail label ids). Rate limits on email sync/uploads/MCP install/invoke-agent; audit events for mailbox connect/disconnect, MCP install, role changes. **UI/UX:** notifications bell mounted in `ShellTopbar`; error-vs-empty states fixed (Activity, Members, Cockpit slices with partial-failure banner, onboarding checklist retry, ThreadDetail mention loads, AgentModelCard); remaining hardcoded Dutch strings converted to EN (mcp-remote-providers, theme-toggle, form-validation, staff-api, email-api); HelpCenters got skeletons/empty states/busy buttons. Onboarding checklist is email-first: new `email` step (real Outlook/Gmail account) ahead of company/assistant/channel/team; company step links `/settings/branding`. **Notifications + roles:** per-user prefs rows `assigned-to-me` / `mentions` / `decisions` each with desktop+email channels — email channel sends via `services/notification_mail.py` (SMTP through `transactional_mail`, link to thread); desktop-off+email-on skips the in-app row but still mails. `GET /api/push/vapid-public-key` returns 503 when VAPID unset (no mock key). Owner/admin required for workforce force-wake, `GET /api/govern/tokens`, and MCP install. Command palette searches live threads (`/api/signals?search=`) and contacts (`/api/channels/contacts?search=`) with debounce. **Verification:** `tests/test_email_fidelity.py`, `test_sso_login.py`, `test_prod_hardening.py`, `test_notification_email.py`, `test_role_tightening.py` (262+ tests green); end-to-end dry run `apps/api/scripts/smoke_cycle32.py` (SSO wiring, email-first onboarding, BL MCP connect, inbound → decision card → free-text resolve → reply with cc, palette search, prefs). Operator go-live steps: `docs/PRODUCTION_READINESS.md`.
- **Prod deploy ops (2026-08):** The Deploy workflow (CI on `master` → build GHCR images → deploy-staging → deploy-production via `appleboy/ssh-action`) currently **cannot reach the VPS**: GitHub runners get `dial tcp <vps>:22: i/o timeout` (June 30 run also failed), so pushes alone do not update prod. Working manual path from a machine with the deploy key (`~/.ssh/bokito_vps_deploy`, root@31.97.45.44): update `/opt/bokito` checkout, build images on the VPS itself (`docker build` needs BuildKit — buildx v0.32.1 was installed to `/usr/local/lib/docker/cli-plugins/`; the legacy builder silently produces broken images because the Dockerfiles use `RUN --mount`), then swap `BOKITO_API_IMAGE`/`BOKITO_WEB_IMAGE` in `.env.prod` (snapshot to `.rollback.prod.env` first) and `docker compose -p bokito --env-file .env.prod -f docker-compose.deploy.yml -f docker-compose.vps.yml up -d --pull never`. GHCR pulls from the VPS are denied (no packages-scoped token on the server; local `gh` token lacks `read:packages`). Prod env facts: Microsoft OAuth pair set (client `f44d9848-…`, tenant `common`), `LLM_MODE=live` + Anthropic key set, `WORKER_INBOUND_SECRET` added 2026-08-13 (new boot validator requires it), SMTP/VAPID/`BJORN_LUNDEN_MCP_URL` still unset. Staging runs `ENVIRONMENT=staging` with mock LLM (prod validators don't apply). Ruff is pinned to 0.15.17 in `apps/api` dev deps so CI (pip, fresh install) matches local lint.
- **Dev mock mailbox connect (2026-08):** When Microsoft/Google OAuth creds are absent in dev, the mock connect flow (`/api/email/oauth/start` and the integrations variant) seeds placeholder credentials `{"access_token": "mock-access-token", "mock": true}` via `ensure_email_account(seed_mock_credentials=True)` so the mailbox lists as `connected` instead of contradicting the "connected" success banner. `email_sync.sync_account` returns `mock_skipped` for mock creds and `send_via_provider` store-only "sends"; production never seeds mock creds (mock paths already 503 there). Live check: `apps/api/scripts/dev/smoke_outlook_connect.py`.
- **Unified inbox:** `GET /api/inbox` aggregates conversations (all channels), open decisions, email threads.
- **Chat:** multi-thread conversations, rename/delete, human takeover/release, inline decision cards, message feedback into `FeedbackQueue`.
- **Policy (Phase 3, 2026-06):** unified tool layer in `apps/api/app/tools/` — `registry.py` (ToolSpec + categories), `policy.py` (allowance engine), `builtin.py` (all tools), `executor.py` (single execution path). Each tool category (`messaging|workspace|agents|channels|triggers|integrations|govern`) has an allowance slider `deny|ask|allow` stored in tenant settings (`tool_allowances`, `tool_overrides`). Resolution layers: posture preset → category slider → agent passport (`autonomy_level` manual caps at ask, auto lifts ask→allow) → per-tool override ("Voortaan automatisch oppakken" writes `tool_overrides`) → trust clamp (external/widget sessions never auto-mutate; agents/channels/triggers/integrations/govern denied entirely). Legacy `ActionPolicy`/`ActionWhitelistEntry`/apply-modes deleted (tables dropped by `schema_patch`).
- **Workspace (Phase 4, 2026-06):** markdown memory replaces the Blueprint stack. `WorkspaceDoc` (tenant-scoped, file-style `path` like `skills/triage.md`, kinds `doc|memory|persona|skill|daily_log|heartbeat`, frontmatter parsed into JSON) + `DocChunk` (per-section embedding chunks, JSON-stored vectors) power hybrid (vector + keyword) retrieval. API: `GET/POST /api/workspace/docs`, `GET/PATCH/DELETE /api/workspace/docs/{id}`, `POST /api/workspace/search`. Agent tools: `list_docs`, `read_doc`, `write_doc` (governed via `workspace_doc` PlatformChange + `platform:doc:write` scope), `search_index` (hybrid search). Agent context = persona doc + long-term memory (`memory.md`) + compact skills list (SKILL.md pattern: only name/description injected, body read on demand) + RAG hits. **Thread compaction:** when a Signal thread exceeds 40 LLM-eligible messages, older turns are summarized into `Signal.compact_summary` (last 12 stay verbatim) and durable facts are flushed to `memory.md` first. Tenant bootstrap seeds `persona.md`, `memory.md`, `company.md`, `heartbeat.md`. Dashboard: markdown editor/viewer at `/workspace` (`WorkspaceDocs.tsx`, kind-grouped list, search, frontmatter display). Legacy `blueprint_*`/`index_chunks` tables migrate to `workspace_docs` and are dropped by `schema_patch`.
- **Tenant introspection (2026-07):** Agents receive a compact live `## Tenant snapshot` block in `build_workspace_context` (agents, projects, enabled triggers with schedule/last status, open decisions/tasks/internal threads, connected integrations/MCP — target ~800 chars). Read-only tools in `builtin.py` (gated=False, mutating=False): `get_tenant_overview`, `list_recent_activity`, `list_tasks`, `get_usage_summary`, `list_threads` — implemented in `services/tenant_introspection.py` and reusing `cockpit_summary` / `usage_breakdown`. Default assistant system prompt nudges the model to call these before claiming lack of info. **Roadmap gaps:** strategy/project docs under `strategy/` are not auto-injected (agents must `read_doc` / `search_index`); default-tenant `company.md` can still be a one-line stub; `platform:read` scope exists for future tighter gating of these reads.
- **Orchestra foundation:** superseded in cycle 2 — Workstream(+steps) remain as definitions, execution is `RuntimeProfile` + `AgentTask`/`AgentRun` under `/api/orchestration/*` (see Backend consolidation above).
- **Triggers + routing (Phase 5, 2026-06):** one `Trigger` model (`triggers` table) replaces orchestra `Task` (orchestra_tasks), `AutomationTemplate`, and the Agenda stack (`agenda_calendars`/`agenda_events`, `/api/agenda/*`, dashboard `/agenda/:view` — all deleted; schema patch migrates enabled schedules into triggers and drops the tables). Kinds: `cron` (5-field expr) | `interval` (minutes) | `heartbeat` | `webhook` (public `POST /api/hooks/{id}`, per-trigger secret revealed once at creation). Firing: workstream-bound triggers start an `AgentTask`; otherwise the resolved agent (`agent_id` or `agent_role` fallback) runs one `AgentLoop` turn with the instructions. Heartbeat wakes embed all `heartbeat`-kind workspace docs as checklist; a reply of exactly `HEARTBEAT_OK` is suppressed, anything else posts to an internal Signal thread (Messages). In-process scheduler `TRIGGER_SCHEDULER_ENABLED` (default on, 60s tick) + ARQ `process_due_triggers_job`. API: `GET/POST /api/triggers`, `PATCH/DELETE /api/triggers/{id}`, `POST /api/triggers/{id}/run`. UI: Orchestra page Triggers tab. Tenant bootstrap seeds a disabled 30-min heartbeat trigger. **ChannelBinding** (`channel_bindings`) routes inbound signals deterministically: most specific enabled binding wins (contact > channel account > channel-wide, by priority), fallback = active assistant agent; used by the inbound worker, widget, livechat, and assistant chat (`services/routing.py`). API: `GET/POST /api/channels/bindings`, `DELETE /api/channels/bindings/{id}`.
- **Cockpit:** `GET /api/cockpit/summary` KPIs including time saved estimate and latest `EvalScore` autonomy metric.
- **Intelligence Stack (2026-06 restructure):** Product backbone mapped to Salim Ismail layers — visible in OS Graph pipeline UX (hybrid IA), not as separate rail items per layer.
  - **SENSING:** unified `signals` table + inbox-parity `GET/PATCH/POST /api/signals/*` (assign, pin, reply, queues including `awaiting_decision` and `outbound`, folder filters). Email mailbox drill-down uses `email_connection_id` (numeric id from `EmailAccount` UUID) and `Signal.email_account_id`. Sync status in bokito mode: `GET /api/signals/sync-status`. Dashboard Messages hub uses `signals-api.ts` when `VITE_API_MODE=bokito`. Seed creates Signal-only demo threads (no duplicate legacy `inbox_threads`). Legacy `inbox_threads` migrate via `scripts/migrate_inbox_to_signals.py`; `create_decision_request` ingests into internal Signal threads.
  - **INTERPRETATION:** `interpretation.py` applies category/urgency/impact/summary/certainty on triage; respects tenant inbox settings when present.
  - **GOVERN & ASSURE:** `AuditEvent` log (`GET /api/govern/audit`), agent passports (`GET /api/govern/passports` with `permission_scopes_json` + role defaults), `PlatformChange` draft queue (`GET /api/govern/changes`, accept/reject, `POST .../rollback`), **allowance sliders** (`GET/PUT /api/govern/allowances`: `deny|ask|allow` per tool category, plus per-tool `PUT /api/govern/tool-overrides`), **Autonomy Posture** presets (`GET/PUT /api/govern/posture`: `manual|assisted|autonomous` — sets the category defaults; default `assisted`; autonomous keeps `integrations` at `ask`), and **API tokens** (`GET/POST/DELETE /api/govern/tokens`, SHA-256 stored, optional category scopes) for the MCP server. Dashboard **Govern** page at `/govern` (pending drafts, allowance sliders, API tokens, passports, audit tail, posture cards).
  - **Platform self-maintenance:** orchestrator/workstream agents propose structural edits via registry tools (`create_agent`, `update_agent`, `create_workstream`, `update_workstream`, `register_mcp_server`, `connect_integration`, `propose_integration`, `add_graph_node`, `connect_graph_nodes`, `write_doc`). The allowance engine resolves `deny|ask|allow` up front; `propose_platform_change(mode="apply"|"ask")` then either applies immediately (status `applied_yolo`, audit + rollback record) or creates a pending `PlatformChange` + inline `DecisionRequest`. Scopes enforced via `platform_access.py`; update tools capture a `before` snapshot; `propose_integration` always escalates to a human decision; PO agents may only mutate workstreams in their own project.
  - **MCP server (Phase 3):** `POST /api/mcp` — tenant-scoped MCP server (JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`) authenticated with `Authorization: Bearer bok_...` API tokens from Govern. Exposes the exact same governed tool registry as internal agents (`trust="api"`); token scopes optionally restrict tool categories. Cursor/IDE clients connect with the streamable HTTP transport URL `http://host/api/mcp`.
  - **LEARNING:** `Feedback` + `EvalScore` models; `POST /api/learning/feedback`, `POST /api/learning/process`, `POST /api/learning/eval/compute`, `GET /api/learning/eval`. Heuristic eval (autonomy rate, escalation rate, CSAT proxy) — no ML fine-tuning.
  - **Orchestration (2026-06):** Background agent tasks via `/api/orchestration/*`. Canonical entities: `RuntimeProfile` (model/tools preset per planner|executor|judge), `AgentTask` (durable work unit linked to internal `Signal` thread), `EvalCheckpoint` (rubric|tool_assert|llm_judge), `TaskArtifact` (step outputs). `AgentRun` extended with `task_id`, `step_id`, `parent_run_id`, `segment_index`, `runtime_snapshot_json`, `checkpoint_json`. Workstream steps bind `agent_id` + optional `runtime_profile_id`; runner enqueues ARQ segment jobs (`run_agent_task_segment`) or runs inline when Redis unavailable / `BOKITO_MOCK_EXECUTION=true`. `POST /api/workforce/trigger-agent` and `POST /api/triggers/{id}/run` invoke the dispatcher (no empty runs). Multi-agent handoff: each step runs a different agent/model; outputs pass via `handoff_template` + `context_json.step_outputs`. SSE: `GET /api/orchestration/runs/{id}/events/stream` (EventSource cannot set headers, so `get_current_auth` also accepts an `?access_token=` query token). Cost/context governance: each segment emits a `context_usage` `RunEvent` (context window %, tokens, cents) and the runner accumulates `context_json.cost_cents`; when a profile's `max_cost_cents` is exceeded the task is paused with `pause_reason="budget_exceeded"` (resume via `POST /tasks/{id}/resume`). Automation templates install per tenant: `POST /api/orchestration/automation-templates/{id}/install` creates an `orchestra_tasks` row (interval schedule) from the template; `GET /api/orchestration/automations` lists installed ones and `POST /api/orchestration/automations/{id}/run` triggers immediately. Messages hub: `ThreadDetail` shows an inline `OrchestrationPanel` (status, resume/cancel, context+cost meters, artifacts) when a thread's signal has a linked `AgentTask` (`GET /tasks?signal_id=`). Orchestra admin page exposes Templates, Automations, and Runtime profiles tabs. Cancel walks the `parent_run_id` tree. Bootstrap seeds planner/executor/judge profiles + demo **Ops Triage Pipeline** workstream per tenant.
  - **Decisions:** unified on `DecisionRequest`; `/api/workforce/messages` is a compat layer; approve executes tools or accepts linked `PlatformChange`.
  - **Real OAuth (2026-06):** authorization-code flow for GitHub, Google (Gmail) and Microsoft (Outlook), gated on env credentials with mock fallback. `app/services/oauth_providers.py` builds authorize URLs, exchanges codes, refreshes tokens and fetches identity; `app/services/oauth_flow.py` persists a one-shot `OAuthState` row (`oauth_states`) and on callback stores tokens into `ChannelAccount.credentials_json` (email) or `IntegrationConnection.credentials_json` (github/integration). Single redirect URI for all providers: `GET /api/integrations/oauth/callback` (302s back to the dashboard return URL with the same success/error params the frontend already parses). Start endpoints (`/api/email/*/oauth/start`, `/api/integrations/oauth/start`, `/api/github/oauth/start`) try `start_real_oauth` first and fall back to `mock_authorize_url` when a provider's client id/secret are empty. Env: `PUBLIC_API_URL`, `PUBLIC_APP_URL`, `{GITHUB,GOOGLE,MICROSOFT}_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_TENANT`. GitHub repos/branches return live data via the stored token (fallback to mocks). Google project `bokito-ai` already has an OAuth client "Bokito Email Integration" to reuse — just add `{PUBLIC_API_URL}/api/integrations/oauth/callback` to its redirect URIs and set `GOOGLE_OAUTH_CLIENT_ID/SECRET`. **Provisioned creds (2026-06, in `apps/api/.env`, untracked):** Google client `582551847741-42p5…` (reused "Bokito Email Integration"; a new client secret was added — the original Xano secret + redirect `…/api:integrations/oauth/google/callback` are preserved, and `…/api/integrations/oauth/callback` for both `https://api.bokito.ai` and `http://localhost:8000` were added). Microsoft Entra app "Bokito AI OS" `9743ee3e-…` created (multitenant + personal accounts, `tenant=common`, Web redirect = localhost callback; Graph `Mail.ReadWrite`/`Mail.Send`/`User.Read`/`offline_access` are consented dynamically at sign-in via the v2.0 endpoint, no pre-registered API permissions needed). GitHub OAuth App "Bokito AI OS" `Ov23liGBw1CHjPSIWWEU` created with the localhost callback, **but its client secret is still pending** — GitHub gates secret generation behind a sudo "Verify via email" step that requires manual inbox confirmation, so `GITHUB_OAUTH_CLIENT_SECRET` must be generated by hand and pasted into `.env`.
  - **Inbound email sync (2026-07 audit hardening):** `app/services/email_sync.py` uses `ChannelAccount.sync_cursor` for incremental sync — Gmail `historyId` via `users.history.list`, Outlook Graph inbox `delta`/`deltaLink` — with full-fetch fallback when the cursor is empty or stale. Dedup remains on provider message id. `last_sync_at` stays in `settings_json`. Send path (`channels/email.send_via_provider`) refreshes on 401 like sync. Mailbox polling runs on the **ARQ worker cron** (`sync_email_mailboxes_job`, every minute, gated by `EMAIL_SYNC_ENABLED`); the in-process API `trigger_scheduler` only fires due triggers (no duplicate email poll). Settings list (`GET /api/email/accounts`) hides `mock` providers and derives status from credentials (`connected` / `needs_auth` / `paused` / `error`) instead of coercing mock→gmail or treating `is_enabled` as connected. Seed no longer creates a phantom `support@bokito.ai` mock mailbox.
  - **Email AI suggestions MVP (2026-07):** Suggest-only inbound email flow. Worker `process_inbound_signal` skips when `Signal.ai_paused` or per-mailbox `ChannelAccount.settings_json.ai_config.suggestions_enabled` is false. For email, the AgentLoop runs with an **empty toolset** (no `create_decision_request` / `send_email`) and `persist_inbound_agent_reply` creates a single inline `DecisionRequest` ("Suggested reply" with Send / Edit / Escalate). Approve Send runs builtin `send_email` → `deliver_outbound`. Escalate pauses AI on the thread (`ai_paused=true`) and writes an escalated system event. Resolve API accepts `option_id` + edited `body`/`subject`. Dashboard `DecisionRequestMessage` + mobile `MessageBubble` send `option_id`; Edit prefills the reply composer. Settings: `/settings/channels` (mailboxes) and `/settings/communication` (AI toggles; dirty-state save). Prod ops: `scripts/ops/vps-set-microsoft-oauth.py`; Entra redirect `https://app.bokito.ai/api/integrations/oauth/callback`. Local live-data bridge: `scripts/dev/prod-tunnel.ps1` + `scripts/dev/api-live.ps1` + `apps/api/.env.prodbridge`.
  - **Live chat human takeover (2026-06):** widget threads support staff↔visitor chat end-to-end. `POST /api/signals/{id}/takeover` and `/release` toggle `Signal.ai_paused` (serialized as `ai_paused` on threads). When paused, the widget SSE stream (`livechat_stream.widget_stream_events`) stores the visitor message and returns a human-handoff `done` event instead of running the AI. Staff replies via `/api/signals/{id}/reply` publish on the `signal:{id}` gateway topic; the widget (`gatewayFrameToWidgetEvent`) now renders outbound `role=user` messages as a human agent bubble (`sender_type=agent`). Dashboard `ThreadDetail` shows a Take over / Hand back to AI toggle for `widget`/`chat`/`assistant`/`email` channels (`useThreadDetail.toggleTakeover`).
  - **Still pending:** Gmail push / Graph webhook subscriptions (polling covers MVP); production SMTP for auth mail; encrypt OAuth tokens at rest; autonomous auto-reply mode.
  - **Wiring pass (2026-06):** dashboard features that previously 404'd are now wired to existing models. Path fixes: integrations router de-duplicated to `/api/integrations/*`; GitHub router moved to `/api/github/*`; workspaces/invites/members use app-scoped helpers (`appScopedGet/Post/Patch/Delete` → `/api/app/*`). Email send accepts the full compose DTO (reply when `thread_id`, else new outbound thread). Mailbox settings, signature, AI-config persist into `ChannelAccount.settings_json`; disconnect hard-deletes the account; all email handlers + OAuth start live on the `/email` router. **Routing rules:** `EmailRoutingRule` table (`email_routing_rules`) + CRUD at `/api/email/routing-rules`; evaluated in `services/signals.apply_email_routing` on inbound signals (merges labels into `tags_json`, resolves numeric `assign_to_user_id` → `User.id`). **Knowledge base:** `/api/kb/*` (collections + documents + keyword search) backed by `WorkspaceDoc` (`kind` `kb_collection`/`kb_doc`, metadata in `frontmatter_json`). **Auth mail:** `AuthToken` table (`auth_tokens`, kinds `password_reset`/`email_verify`, single-use, prior unused tokens invalidated) + `User.email_verified`; endpoints `/auth/password-reset-request`, `/auth/password-reset`, `/auth/verify-email`, `/auth/resend-verification`. Non-production responses include `dev_token`/`dev_link` (logged) so flows work without SMTP. **Workforce:** `force-rescan` fires due triggers for the tenant (`process_due_triggers(tenant_id)`); `maintenance-run` calls `clear_stale_runtime` (resets stale active agents to standby, fails long-running runs). **Settings:** workspace save/delete persist via `Tenant.settings_json` (incl. `require_2fa`); `delete_workspace` cascade-deletes tenant-scoped rows; messenger module toggles persist inside `MessengerAppearance` branding JSON. **Legacy `/email/messages*`:** removed from dashboard — orphaned `components/communication/*` deleted; inbox uses Signals API + `/email/threads`. **Auth UI:** `/verify-email?token=…` page + profile resend when `email_verified` is false; `/auth/me` exposes `email_verified`. **Nav badges:** `GET /api/signals/badge-counts` replaces four thread-list fetches.
- **Widget:** the only widget API is `/api/livechat/*` (`session/start`, `stream-chat`, `stream-chat-continue`, `attachment`, `me`, `user/*`, `customer/conversations`, `conversation` POST/GET + `conversation/{id}/messages`); the embed is `apps/chat-widget/dist/bokito-chat.js`, served at `/chat-widget/bokito-chat.js`. `packages/messenger-ui` is fully deleted (2026-07, cycle 6); its API types were inlined into `apps/dashboard/src/lib/bokito-api.ts`.
- **Gateway reconnect (2026-07, cycle 7):** the dashboard gateway client only resets its reconnect backoff after the server's `connected` frame (not on socket open) and backs off to the max delay on an `unauthorized` error frame; an expired JWT no longer causes a 1-second reconnect storm against `/api/ws`.
- **Mobile:** native Expo app at `apps/mobile` on the gateway protocol (see Fase 7 section).
- **Dashboard bokito mode:** `VITE_API_MODE=bokito`; Vite proxies `/api/*` to FastAPI. Frontend API bases: `APP_API_BASE=/api` (signals, etc.), `APP_SCOPED_API_BASE=/api/app` (custom-db). Rail: Cockpit, **Messages** (`/messages`, unified thread-lijst), **AI OS** (`/os`), Integrations, **Govern** (`/govern`), Settings. Orchestra lives under AI OS sidebar (`/orchestra`), not as its own rail item.
- **Agent setup (2026-06):** Admins/owners can create company worker agents from the UI (`AiAgents` page "New agent" dialog: name, role `assistant|communication|builder|orchestra`, model picker from the workspace catalog, optional system prompt) via `POST /api/workforce/agents`, and edit a company agent's name + system prompt on the detail page (`AgentInstructionsCard`) via `PATCH /api/workforce/agents/{id}`. Both are admin-gated; `create_agent`/`update_agent` validate the chosen model against the catalog + tenant allowlist. The workforce serializer now exposes `system_prompt`, `chat_access`, and `kind`. Per-agent model rebind stays at `PATCH /api/workforce/agents/{id}/model`.
- **AI OS section:** Single rail item replaces separate Projects and Workforce. **Unified workspace graph canvas** at `/os` (React Flow): draggable nodes for orchestrators, workstreams, repos/sources, and tools with many-to-many edges (`routed_by`, `uses_repo`, `uses_tool`). Overlay tables `os_canvas_nodes` / `os_canvas_edges` store positions and links; domain entities stay in existing tables. Auto-seed on first load from projects/workstreams/repos/integrations. API: `GET/POST/PATCH/DELETE /api/workforce/os/nodes`, `POST/DELETE /api/workforce/os/edges`, `GET /api/workforce/os/graph`. Legacy `/os/project/:id` redirects to `/os`. Drill-in keeps `/project/:id/*` detail pages. Canonical agent URLs: `/os/agents`; legacy `/projects`, `/workforce`, `/ai/agents` redirect to `/os` paths. Single `bokito-chat` embed in `main.tsx` (no messenger-ui FAB). Open workspace → `/home`; one membership skips picker; unified inbox tabs (Conversations | Decisions). Branding save: `appearance_json` + `widget_favicon` on `POST /api/auth/workspaces/{id}/branding`; persona `GET/PUT /api/persona`; notification prefs `GET/PATCH /api/user/notification-preferences`. Primary seed `admin@bokito.ai`. Inbox, Blueprint, integrations, projects, workforce, and settings APIs as below. Stale SQLite: `apps/api/DEV_DATABASE.md`; `init_db()` runs `apply_column_patches` (auto-adds missing columns from SQLModel metadata + manual overrides) so `scripts/seed.py` works without deleting `dev.db` when the API is stopped.
- **Local dev:** `docker compose -f docker-compose.dev.yml up`; seed `admin@bokito.ai` / `bokito-test-password`. Dashboard: `npm run dev -w bokito-dashboard` on `http://127.0.0.1:5174` with Vite proxy to FastAPI.
- **Tests:** pytest (59+ tests, mock LLM); covers govern, platform changes, signals, learning, decisions, notification preferences, branding `appearance_json`, livechat SSE. CI: `api` (ruff + pytest), `dashboard` build, `mobile` typecheck, `e2e` (Playwright: dashboard login/cockpit/inbox/integrations). Local: `npm run verify:bokito` (api tests + dashboard build) and `npm run verify:bokito:e2e`.
- **Legacy removed (production track):** `apps/runtime`, `packages/docker`, `platform-patches`, `apps/messenger` (PWA, vervangen door de native Expo-app in `apps/mobile`) — niet meer actief in de V1 FastAPI-lijn.

**Chat widget (`apps/chat-widget`):** TypeScript/Vite IIFE (`bokito-chat`, `src/widget-main.ts`) for portal preview, team embed, and external sites. Build: `npm run build` in `apps/chat-widget` → `dist/bokito-chat.js`. Dashboard Vite (and production Caddy) serve the flat path `/chat-widget/bokito-chat.js` from `dist/`. Livechat: Vite proxies `/api/livechat/*` to FastAPI (`session/start`, theme from `livechat_settings.appearance`). `POST stream-chat` and `stream-chat-continue` return SSE (`data: {"t":"..."}` chunks and `{"type":"done","content":"..."}`). The widget is the **only** external embed path; there is no parallel messenger-ui embed.

**Broncode (GitHub):** monorepo onder [github.com/BokitoAI/Bokito-AI](https://github.com/BokitoAI/Bokito-AI) (`origin`).

### Competitive landscape (2026-06)

| Competitor | Shape | Bokito contrast |
|------------|-------|-----------------|
| OrchStack, Beam | AI OS + runtime + govern | Bokito leads with unified Messages + inline decisions |
| Relevance AI, Lindy | Visual multi-agent / flows | No unified external+internal inbox |
| Agentforce, Copilot Studio | Enterprise ecosystem agents | Not SMB standalone ops core |
| Front, Intercom | Inbox / chat support | Customer-only; no agent OS or structural govern |
| n8n | Dev workflow canvas | No Govern posture or Messages hub |

Full table: [`docs/POSITIONING.md`](docs/POSITIONING.md).

### Autonomy posture (2026-06)

Tenant preset on Govern **Policy** tab: `manual` | `assisted` (default) | `autonomous`. Sets the per-category allowance defaults via `GET/PUT /api/govern/posture` (changing posture resets explicit category overrides). **Autonomous** keeps `integrations` at `ask` so external connects always need human approval. Per-category fine-tuning via the allowance sliders; per-tool pins via tool overrides.

---

## 2. Dashboard – Pagina's & Features

### Frontend API-laag (portal)
- Build-time omgeving en FastAPI API-groep-bases staan in `apps/dashboard/src/lib/api.config.ts` (`VITE_BOKITO_API_URL`, `VITE_API_GROUP_*`, same-origin paden `/api/{canonical}/...` via de Vite-proxy of productie-workers).
- Relatieve paden per groep (bijv. `/workspaces`, `/inbox/threads`, `/triggers`, `/auth/refresh` op de auth-base) staan centraal in `apps/dashboard/src/api/routes/` (`auth.routes.ts`, `app.routes.ts`, `integrations.routes.ts`, `workforce.routes.ts`) en in `apps/dashboard/src/api/url.ts` voor query-strings. Featurecode en `lib/*-api.ts` importeren daaruit; `lib/bokito-api.ts` blijft transport (fetch, headers, cookies).
- Deze `src/api/**` bestanden horen **gecommit** te zijn: stonden ze alleen lokaal (niet op `origin/master`), dan herstelt `git fetch` ze niet na een revert; paden zijn dan te reconstrueren uit dezelfde strings die voorheen in `lib/bokito-api.ts`, `lib/custom-db-api.ts`, `lib/email-api.ts`, `lib/inbox-api.ts`, `lib/workforce-api.ts` en workspace/members pages stonden.
- Richtlijn voor agents: `.cursor/rules/frontend-api-env-pattern.mdc` en `apps/dashboard/docs/API.md`.

### 2.1 Login (`/login`) en Signup (`/signup`)
- **Self-service signup (juli 2026):** `/signup` (pagina `Signup.tsx`) maakt een nieuw account + workspace via `POST /api/auth/signup` (`email`, `password`, `tenant_slug`, `tenant_name`, `display_name`). De workspace-URL (slug) wordt automatisch afgeleid van de bedrijfsnaam en is handmatig aanpasbaar. Na signup is de gebruiker direct ingelogd (zelfde `LoginResponse`-contract als login, refresh-cookie gezet) en landt in een lege workspace met onboarding-checklist. Loginpagina linkt naar `/signup` via "Create account".
- E-mail + wachtwoord login via FastAPI `POST /auth/login`
- Dashboard auth gebruikt een same-origin auth-contract op `/api/auth/*` (`login`, `refresh`, `me`, `logout`) met cookie-gebaseerde sessieflow
- Dashboard auth-client gebruikt een fallbackpad naar directe FastAPI auth-endpoints (`//api/auth/*`) wanneer de same-origin auth-proxy niet beschikbaar is (bijv. 404/502 of netwerkfout), zodat login niet blokkeert op proxy-availability.
- Refresh token hoort in een `HttpOnly` cookie; access token blijft alleen in runtime memory (niet in `localStorage`)
- Bij laden probeert de portal eerst `POST /api/auth/refresh` en daarna `GET /api/auth/me` om de sessie te herstellen
- `GET /auth/me` levert tenantcontext in een stabiel object: `tenant = { id, slug, name }` en kan optioneel een logo-URL bevatten (bijv. `logo`, `logo_url` of gelijkwaardig op `tenant`, `account` of `organisation`)
- Frontend normaliseert auth-velden naar 1 intern model (`user.tenant`) zodat tenantdata herbruikbaar is in meerdere modules; `user.tenant.logo` is de eerste beschikbare logo-URL uit die objecten, anders `null`
- De tenantkaart linksboven in de dashboard-sidebar gebruikt de ingelogde tenant uit `user.tenant` (logo, naam + slug); zonder logo-URL valt de UI terug op `/bokito-logo.svg`
- `ProtectedRoute` bewaakt alle routes en stuurt ongeauthenticeerde gebruikers naar `/login?return_to=...`; na login gaat de gebruiker terug naar dezelfde interne URL (met open-redirect validatie)
- Cross-host login returns zijn alleen geldig voor bekende control-plane of tenant-hosts; bare `localhost` is geen tenant-host en wordt genegeerd als `return_to` om app.localhost/login-lussen te voorkomen
- **Microsoft browser-login (OAuth) buiten deze repo:** de portal-login in `apps/dashboard` is alleen e-mail/wachtwoord. Zie je een Microsoft-fout `invalid_request` … `redirect_uri` is not valid, dan komt de `redirect_uri` in de authorize-URL **letterlijk** overeen met wat je in Entra onder **Web redirect URIs** zet (geen varianten). Voorbeeld: staat alleen `https://api.bokito.ai/api/auth/callback/microsoft` geregistreerd, maar de client stuurt `.../callback/azure-ad`, dan faalt de flow; voeg die tweede URI toe **of** pas de client aan naar de geregistreerde URI. Dit staat los van mailbox/Graph-OAuth op FastAPI (`MICROSOFT_REDIRECT_URI` → `/api/integrations` OAuth-callback); elke app registration heeft een eigen client-id en redirect-lijst.

---

### 2.2 Dashboard Home (`/`)
- Welkomstbericht voor de ingelogde gebruiker
- **4 KPI-kaarten**: Gesprekken, Actieve gebruikers, Gem. responstijd, Tokens gebruikt (elk met trend %)
- **ActivityFeed**: scrollbare lijst van recente platform-events (agent tool calls, nieuwe gesprekken, gebruikersacties, systeemmeldingen) met avatar, actie, doel en relatieve timestamp
- **QuickActions**: 4 snelkoppelingen — Nieuw gesprek, Agent beheren, Analytics bekijken, Organisatie instellen

---

### 2.3 Cloud Agents (`/cloud-agent`)
Beheer van FastAPI-hosted agents die op de achtergrond draaien.

- **Toggle-view**: kaartweergave of lijstweergave
- **AgentCard / AgentRow**: naam, model, status (actief/gepauzeerd/deploying), regio, laatste deploy, 24h request count, P50 latency, tools, systeemprompt preview
- **AgentDetailModal**: volledig detail modal — alle metrics, embed URL, tools, volledige systeemprompt
- **"Nieuwe cloud agent" knop** (in ontwikkeling)

Bekende mock agents: Bokito Support (claude-sonnet-4), Sales Assistant (claude-sonnet-4), Internal Ops (claude-3-5-haiku), Website v3 Draft (claude-opus-4)

---

### 2.4 Agent Canvas (`/agent-canvas`)
Visuele workflow builder voor het ontwerpen van agent-pipelines.

- **Toolbar**: node-types toevoegen (Agent, Schedule, Webhook, Kennisbank, Workflow), zoom in/uit, reset
- **Canvas**: token-gedreven dot-grid achtergrond die meeschakelt met dark/light mode, pan (drag) en zoom (scroll, 0.3x–2.5x), nodes zijn versleepbaar
- **Node types**: `agent`, `cron`, `webhook`, `knowledge`, `repo`, `slack`, `crm`, `email` — elk met icoon, accentkleur en statusdot
- **Edges**: SVG bezier-verbindingen met subtielere dash-flow en lagere glow/contrast voor een rustiger beeld; kleurgecodeerd per verbindingstype
- **Node hover tooltip**: compactere, token-gedreven tooltip + actieknoppen (Run, Config, Logs) voor betere leesbaarheid in light en dark
- **EventLog** (rechts, 224px): live events feed met token-gedreven achtergronden en tekstkleuren (geen hardcoded dark-only kleuren)
- **ScheduleTimeline** (onderbalk): 24-uurs tijdlijn met geplande agent-runs als gekleurde dots, "NU"-indicator en theme-aware styling

---

### 2.5 Webchat Configuratie (`/webchat`)
Volledig configureerbare chat widget, live preview inbegrepen.

**Configuratiepanelen (links):**
- **Uiterlijk**: botnaam, tagline, avatar (initialen + kleurpicker), accent/bubbel/achtergrondkleur, font, widgetbreedte (300-480px slider)
- **Begroeting**: welkomstbericht, inputplaceholder, typing-indicator toggle, geschiedenis-toggle, startvragen (max 5, toevoegen/verwijderen)
- **Launcher**: positie (bottom-right/left met visuele preview), label-toggle, auto-open toggle, labeltekst
- **Systeem**: model selector (gpt-4o, gpt-4o-mini, gpt-4-turbo, claude-3-5-sonnet, claude-3-haiku), temperatuur slider (0-1, labels: Precies tot Creatief), taal (NL/EN/Auto), systeemprompt textarea
- **Embed code**: script-tag + iFrame snippet, beide met kopieerknop. Attributen: `data-agent-slug`, `data-bot-name`, `data-primary-color`, `data-position`

**Live preview (rechts):** Volledig interactief widget-preview dat real-time meebeweegt met alle instellingen.

---

### 2.5.1 Instellingen (`/settings`)
- Hoofdingang via **Instellingen** onderaan de primaire rail; `/settings` redirect naar `/settings/profile`.
- Subnav-blokken: **Communicatie** (e-mail, inbox), **Workspace**, **Mijn organisatie** (bedrijfsconfiguratie; team/kennisbank nog disabled), **Account** (profiel).
- Integratiebeheer (marketplace, verbindingen, MCP, API-sleutels) staat niet meer onder Instellingen; zie §2.6.
- Legacy redirects: `/settings/integrations` → `/integrations/marketplace`, `/settings/mcp` → `/integrations/mcp`; `/company-config` → `/settings/company-config`.

---

### 2.6 Integraties (`/integrations/*`)
Eigen hoofdmenu-item **Integraties** in de primaire rail. Subnavigatie via context-sidebar (Connected-first):

| Route | Doel |
|-------|------|
| `/integrations/connected` | **Standaardlanding**: actieve koppelingen per type (Communication, Repository, MCP); beheren en ontkoppelen |
| `/integrations/marketplace` | **Marketplace**: providers ontdekken en nieuwe verbinding starten (niet primair beheer) |
| `/integrations/mcp` | MCP: tab **Externe servers** (install-tabel + modal) en tab **Bokito-client** (preview) |
| `/integrations/api` | Developer API-sleutels (verborgen in nav tot live) |

`/integrations` en legacy `/integrations/connections` redirecten naar `/integrations/connected`.

Gedeelde **type-segmentatie** (`IntegrationKindNav`): All | Communication | Repository | MCP op Connected en Marketplace, gesynchroniseerd via `?kind=inbox|repository|mcp`.

- **Marketplace UX**: kaartraster per **applicatie** (`integration_hosts`, bijv. één kaart **GitHub** met host-logo). **Connect** opent een hub-modal met **koppelingstypen** = catalogusproducten (`integration_providers`, bijv. repository-indexering + GitHub MCP). Per type: detailstap en setup (OAuth/API-key/remote MCP). URL `?connect=` accepteert host-slug (`github`) of offer-static-id (`github-mcp`). Frontend: `integration-applications.ts`, `ApplicationCard`, `ApplicationHubDialog`. Setup via `integration-setup.ts` + **`apps/dashboard/src/lib/integrations/registry.ts`**; OAuth via `integration-oauth-flow.ts`.
- **Integratiedata-model (schaalbaar)**: `integration_hosts` (merk, logo) → `integration_providers` (product/slug, auth, capabilities, `host_id`) → `integration_connections` (tenant-config, credentials) → `integration_bindings` (gebruik, bijv. `mcp_server`, `project_repo`). E-mail blijft deels parallel op `email_oauth_connection`.
- **Documentatie in de portal**: `/integrations/docs` (sidebar onder Integraties) — uitleg remote MCP OAuth en catalogus voor admins.
- **Developer docs**: `apps/dashboard/docs/INTEGRATIONS.md` — checklists voor nieuwe MCP-, repo-OAuth- en inbox-OAuth-providers; FastAPI-deploy en smoke tests. FastAPI-deploylijst: `docs/archived/v1/INTEGRATIONS-PLATFORM.md`.
- **Connected UX**: secties per type, summary-cards bij filter All, CTA **Integratie toevoegen** naar Marketplace (behoudt actief `?kind=`). E-mail: **Mailboxen beheren** naar `/settings/inbox` (label **Mailboxen** in settings-nav).
- **Catalogus**: `GET /integrations/providers` uit `integration_providers` (seed: github, outlook, gmail, bjorn_lunden_mcp, custom_mcp, plus remote MCP OAuth slugs in `docs/archived/v1/integration-providers-seed.md`). Marketplace groepeert providers per host; fallback-metadata in `integrations-data.ts` en `mcp-remote-providers.ts`. Platform-tabellen (`integration_hosts`, `integration_providers`, `integration_connections`, `integration_bindings`, `github_connections`) en list-endpoints (API ids 307–312) zijn live op FastAPI workspace 1. Core hosts + providers seeden via `node scripts/seed-integration-providers.mjs` (hosts eerst, daarna providers met `host_id`).
- **Host-logo's**: tabel `integration_hosts` bevat merklogo's (FastAPI image-velden `logo` / `logo_dark`). Providers verwijzen via `host_id`. De portal gebruikt `IntegrationHostLogo`: FastAPI-URL indien geupload, anders officiële merk-SVG's in `apps/dashboard/public/brands/` (vendor sites, Wikimedia, Simple Icons met merkkleur). Zie `public/brands/README.md`. Host **shopify** toegevoegd (`shopify_mcp`, coming_soon, per-store OAuth).
- **Verbindingen**: `integration_connections` per tenant, meerdere rijen per provider (bijv. meerdere GitHub-accounts). Lijst: `GET /integrations/connections?provider=`. OAuth: `GET /integrations/oauth/start?provider=` + callback `GET /integrations/oauth/callback`. API-key: `POST /integrations/connections`. Intrekken: `DELETE /integrations/connections/{id}`.
- **GitHub (legacy + nieuw)**: `GET /github/connections` (lijst, API 310), `GET /github/connection` (legacy enkelvoud, API 311), `DELETE /github/connection` (API 312), `GET /github/repos?connection_id=`, repo koppelen via `PATCH /projects/{id}/repo` met `connection_id` + `integration_bindings` type `project_repo`. Worker: `POST /integrations/worker/credentials` (fallback `POST /github/worker/token`). Frontend `listGithubConnections` gebruikt primair `/github/connections` (geen extra fallback naar `integrations/connections?provider=github`).
- **E-mail**: blijft op `email_oauth_connection`; marketplace start OAuth vanuit de setup-modal (`startOAuthConnection` met marketplace return URL). Mailboxbeheer (mappen, handtekening) blijft op `/settings/inbox`.
- **MCP**: `POST /integrations/mcp/install`, `GET /integrations/mcp/bindings` voor tenant `mcp_server_ids`. Providers: `bjorn_lunden_mcp` (platform MCP server id 8), `custom_mcp` (URL + auth in connection metadata). Marketplace setup-modal gebruikt gedeeld `McpConnectionForm`; `/integrations/mcp` blijft volledige beheer-UI.
- **Remote MCP OAuth** (vendor-hosted): elf marketplace-providers (Notion, Linear, Atlassian, Slack, Asana, ClickUp, Sentry, Stripe, GitHub MCP, Microsoft Graph MCP, Higgsfield) met `auth_type: mcp_remote_oauth`. Higgsfield MCP: hosted op `https://mcp.higgsfield.ai/mcp`, streamable HTTP + OAuth via Higgsfield-account (AI-beeld- en videogeneratie). Start: `GET /integrations/mcp/oauth/start?provider=`; callback: `GET /integrations/mcp/oauth/callback`; PKCE/token exchange via runtime (`apps/runtime/src/mcp-oauth/`). Verbindingen in `integration_connections.credentials` (access/refresh token + `mcp_remote_url`); binding `config.mode=remote_oauth`. Agents: `POST /integrations/worker/mcp-credentials`. Token refresh: `POST /integrations/mcp/oauth/refresh` (cron). Registry: `apps/dashboard/src/lib/integrations/registry.ts` + `mcp-remote-providers.ts`. Seed/deploy: `integration-providers-seed.md`, `INTEGRATIONS-PLATFORM.md`. GitHub repo-OAuth en Outlook/Gmail blijven apart.
- **Index**: unified `index_chunks` met `source_type` o.a. `repo_file`, `tenant_doc_section`; runtime `POST /index/tenant-docs` voor doc-secties.

---

### 2.6b Project Hub (`/projects`, `/project/:id/*`)
Workforce-projecten hebben een dedicated hub met sidebar-navigatie.

- **Admin rail**: Home, **Projecten** (`/projects`), Inbox, Assistent, Integraties, Data, **Agenten** (`/admin/runs`).
- **Routes**: `/projects` (lijst), `/projects/new` + `/projects/new/:projectId/connect` (create wizard stap 2: GitHub OAuth of "Set it up for me" coming soon), `/project/:id/overview|doc|doc/:pageSlug|request|messages|settings`. Legacy `/project/:id/pkb` redirect naar `/project/:id/doc`.
- **Home redirect**: bij precies één project gaat `/` naar `/project/{id}/overview`.
- **Repo status**: projectkaarten en header tonen `repo_index_status` (none, pending, queued, indexing, ready, error).
- **GitHub OAuth flow**: tenant-scoped `integration_connections` (+ legacy `github_connections` dual-write); meerdere GitHub-accounts per tenant; project wizard kiest account + repo/branch → `PATCH /projects/{id}/repo` met `connection_id` → `POST /projects/{id}/repo/reindex`.
- **Integrations API**: zie §2.6; project repo worker via `POST /integrations/worker/credentials` en `POST /github/worker/index-status`.
- **Runtime**: `POST /repo/reindex` op worker clone/pull via OAuth token, enqueuet per bestand naar index queue; clones onder `REPO_CLONE_DIR` (default OS temp `bokito-repos`).
- **Index search**: `POST /index/search` sorteert chunks op pgvector cosine (`<=>`) i.p.v. `updated_at`.
- **Shell + UI**: alle `/project/:id/*`-pagina's wrappen content in `components/project/ProjectShell.tsx`. De shell rendert de slanke `ProjectContextBar` (projectnaam + repo-status badge + acties Details/Request a change/Connect code; de volledige `autonomous_scope` staat alleen op `/project/:id/settings`). De legacy `ProjectHeader` is verwijderd. `Layout.tsx` levert al `px-5 pb-5 pt-2.5`, dus pagina's voegen geen eigen `p-6` meer toe. Alle vlakken gebruiken `Card` (`border-border/80 bg-bg-surface/95 rounded-2xl`) i.p.v. de oude `border-border-subtle bg-surface-raised`-utilities.
- **Sidebar nav**: `SectionSidebar` voegt op `/project/:id/doc[/...]` een tweede groep `Pages` (NL: `Pagina's`) toe met de doc-tree (`PageTree variant="sidebar"`). De Documentation-link blijft actief op alle `doc/:slug`-routes via een custom `isLinkActive`. De doc-tree wordt 1x per project geladen door `ProjectDocNavProvider` (in `ProjectLayout`); zowel de sidebar als de doc-pagina lezen daaruit.
- **AppHeader breadcrumb**: voor project-routes toont de header `{project.name} / {section}`, en op doc-routes wordt de actieve pagina-titel toegevoegd (`{project} / Documentation / {page}`). Project- en doc-context worden via `useOptionalProjectContext()` + `useOptionalProjectDocNav()` gelezen zodat de header geen eigen fetches doet.
- **Doc-canvas**: `ProjectDoc.tsx` is een single-column canvas zonder eigen sidebar/right rail (tree zit nu in de `SectionSidebar`). Top toolbar: `kind`-eyebrow + page title + acties **History** (opent een Radix `Dialog` met `RevisionPanel variant="embedded"`) en **Request a change**. Lege/foutstaten: empty scaffold-CTA, friendly retry-card bij API-404 (geen ruwe HTTP-paths in UI), locked-page hint via i18n. Page-strings staan in `locales/{en,nl}/nav.json` onder `project.{contextBar,overview,messages,settings,request,list,doc}`.

### 2.6c Project Documentation System (block-based, replaces `pkb_sections`)
Elk project heeft één centrale documentatie als Notion-stijl block-based hub. Vervangt het oude `pkb_sections` model. Docs zijn de single source of truth voor wat een project is en waar het heen gaat; agents lezen ze op elke run en schrijven er direct in met volledige audit trail.

- **Datamodel** (zie `docs/archived/v1-platform-tables.md`): `project_docs` (1 per project) → `doc_pages` (boom van pagina's; `kind` ∈ overview/vision/features/brand/tech/marketing/operations/roadmap/log/notes/custom; `is_locked` blokkeert agent-writes) → `doc_blocks` (Notion-blocks: heading_1/2/3, paragraph, bullet/numbered/to_do, quote, callout, divider, code, image, embed, link_to_page, toggle, table; `text` is array van inline runs `{text, bold, italic, underline, strike, code, color, link}`; `props` is type-specific). Audit: `doc_block_revisions` (op=create/update/delete/move; before/after JSON; actor_type=user|agent; actor_label; required `change_note` voor agents). Inbox: `doc_change_requests` (vervangt `pkb_sections.layer=change_queue`; status pending/in_progress/implemented/blocked/rejected).
- **PRD scaffold seed**: `POST //api/workforce/projects` (project create) zaait nu `project_docs` + 8 standaardpagina's (Overview, Vision and audience, Features and scope, Brand and voice, Tech stack, Marketing, Operations, Roadmap), elk met heading_1 + callout + paragraph startblokken. Niets is gelocked; gebruiker kan vrij hernoemen, toevoegen of verwijderen. Pagina-`kind` matcht de scaffold zodat agents kunnen anchoren.
- **Workforce API** (user-auth, alle onder `//api/workforce`): `GET /projects/{id}/doc` (root + page tree, geen blocks), `POST /projects/{id}/doc/pages`, `PATCH /projects/{id}/doc/pages/{page_id}`, `DELETE /projects/{id}/doc/pages/{page_id}` (soft delete via `archived_at`), `GET /projects/{id}/doc/pages/{page_id}/blocks`, `POST /projects/{id}/doc/pages/{page_id}/blocks` (batch op-array `[{op:create|update|delete|move, ...}]`; schrijft blocks + revisions atomisch en triggert `WORKER_BASE_URL/doc/reindex-page` voor embedding), `GET /projects/{id}/doc/pages/{page_id}/revisions?block_id=…`, `POST /projects/{id}/doc/change-requests` (vervangt legacy PKB change_queue POST; zelfde PO heartbeat dispatch), `GET /projects/{id}/doc/change-requests`.
- **Integrations API** (worker-auth via `WORKER_INBOUND_SECRET` body-token): `POST //api/integrations/doc/worker/blocks` (agent batch ops, `actor_type=agent`, `change_note` verplicht), `POST //api/integrations/doc/worker/reindex-page` (worker fetch van blocks voor embedding), `POST //api/integrations/doc/worker/tree` (project page tree voor doc-map opbouw).
- **Frontend**: `/project/:id/doc/:pageSlug` rendered via `apps/dashboard/src/pages/ProjectDoc.tsx` met `components/doc/PageTree.tsx` (sidebar; lucide icoon per page kind), `components/doc/BlockEditor.tsx` (contentEditable per block; debounced auto-save via diff → batch op API; `@dnd-kit` reorder; slash-style block-type dropdown; agent-edited blocks krijgen `ActorBadge` (kleine accent-stip links)), `components/doc/RevisionPanel.tsx` (audit list met one-click revert per revision). Transport: `apps/dashboard/src/lib/doc-api.ts` + `lib/doc-blocks.ts` (`buildBlockTree`, `diffBlockLists`, `newBlockId`). `ChangeRequest.tsx` schrijft nu naar `doc_change_requests` en accepteert optionele `target_page_id` via `location.state` zodat de "Request a change"-knop op een doc-pagina automatisch de juiste pagina koppelt.
- **Runtime + agent tools**: `apps/runtime/src/docs/{client.ts,reindex.ts,block-utils.ts,doc-map.ts}` doen reindexing (per block één `index_chunks` row met `source_type=doc_block`, `source_ref=<page_slug>#<block_id>`; één samenvatting per pagina met `source_type=doc_page_summary`) en doc-map opbouw. `dispatcher.ts` accepteert `POST /doc/reindex-page` (Bearer secret). `runner.ts` stopt een compacte plain-text doc-map (pagina-titels + headings) in elke `RUN_CONFIG_JSON.platform.doc_map`; agent-loop voegt die toe aan het system prompt. Agent tools (`packages/docker/agent-run/agent-loop.js`): `write_doc` (page_id + change_note + ops; logt revisions met agent als actor) en `read_doc_page` (huidige block list ophalen). De oude `read_pkb` / `update_pkb_section` tools zijn verwijderd; het PO heartbeat-pad blijft identiek (een nieuwe change_request triggert dezelfde `/agent/po/run`).
- **Workspace documentatie (project hub):** parallel datamodel `workspace_docs` / `workspace_doc_pages` / `workspace_doc_blocks` / `workspace_doc_block_revisions` (tenant-scoped, geen `project_id`). UI: `/projects/docs[/:slug]` via `WorkspaceDocNavContext`, `ProjectHubDocs`, `docScope=workspace`. API: `/workspace/doc/*` (workforce) en `/workspace/doc/worker/*` (integrations). Zie `docs/archived/v1/PROJECT-HUB-BACKEND.md`.
- **Migratie**: `docs/archived/v1/MIGRATE-pkb-to-docs.md` beschrijft het one-shot pad: bootstrap missing scaffolds, map `pkb_sections.layer = current_state|intended_state` rows als blocks onder de juiste `kind`-pagina (default Overview), map `change_queue` rows naar `doc_change_requests`. Oude pkb-rijen blijven leesbaar voor één release; daarna wordt de tabel gedropt. Deprecated XS files (`workforce-pkb-create.xs`, `-list.xs`, `-worker-list.xs`, `-worker-update.xs`) en frontend `lib/pkb-api.ts` + `pages/Pkb.tsx` zijn al verwijderd.

---

### 2.7 Bronnen (`/integrations/sources`)
Onder **Integraties** als **Bronnen** (legacy redirect van `/datasources`); geen koppelingenbeheer op deze pagina.

**Bovenste sectie: geindexeerde documentatie (primair)**
- Haalt tenant-scoped docs op via `GET /docs` (auth API); lege staat wanneer nog geen bronnen geindexeerd zijn.
- Cards tonen docnaam, bron-URL en status **Actief voor agents** (read-only weergave).

**Onderste sectie: verbonden integraties (alleen-lezen)**
- Component `ConnectedIntegrationsPreview`: compacte chips voor verbonden GitHub-accounts, e-mail-tellingen, geinstalleerde MCP.
- Geen connect/disconnect op deze pagina; CTA **Beheer in Integraties** → `/integrations/marketplace`.

**Tenant-scoped dataflow**
- Frontend haalt docs op via auth API-contract `GET /docs` (zelfde auth base als dashboard)
- Tenantcontext wordt door backend/JWT bepaald en centraal opgehaald via `GET /auth/me`
- Datasources gebruikt `user.tenant` uit `AuthContext` als single source of truth voor tenant labels en fallbacklogica
- De paginatitel toont `AI Bronnen van {tenantnaam}` met `user.tenant.name` (of slug/`je organisatie` als fallback); links staat het tenantlogo (`user.tenant.logo`) met fallback naar `/bokito-logo.svg`
- Empty/error/loading states zijn aanwezig op de pagina

**Fallbackbeleid**
- De datasources pagina gebruikt geen lokale tenant-fallback voor docsweergave; de UI toont uitsluitend resultaten uit de tenant-scoped API.

**Definitieve docs API (tenant-isolatie + RBAC)**
- De Authentication API group bevat tenant-scoped docs endpoints met `auth = "user"`:
  - `GET /docs`
  - `GET /docs/{doc_id}`
  - `POST /docs`
  - `PATCH /docs/{doc_id}`
  - `DELETE /docs/{doc_id}` (soft delete via `status = archived`)
  - `GET /docs/{doc_id}/pages`
  - `GET /docs/{doc_id}/sections`
- Tenant filtering gebeurt in backend op basis van ingelogde user (`user.account_id`) + account→organisation mapping
- Write-endpoints zijn RBAC-gated: alleen `admin` mag create/update/archive, read blijft voor geauthenticeerde users binnen dezelfde tenant
- Frontend gebruikt geen lokale docs-fallback meer voor weergave van tenantdocs

**Seeddata tenant `bourgondienadvies` (organisatie Bourgondiënadvies)**
- Vier doc-bronnen in `doc` met pages/sections in `doc_page`, `doc_section`: [RJNet](https://www.rjnet.nl/), [NBA HRA](https://www.nba.nl/wet--en-regelgeving/hra/), [Belastingdienst](https://www.belastingdienst.nl/), [Bourgondiënadvies diensten](https://bourgondienadvies.nl/diensten/)
- `doc_section.embedding` blijft null voor seed records (klaar voor latere embedding-pipeline)

---

### 2.8 Communicatie (`/communication`)
Slack-achtige teaminterne chat.

- **ChannelSidebar** (links): Favorieten, Kanalen (Inbox/Klantvragen/Jaarrekening/Loonadministratie), Direct berichten met klantnamen, ongelezen-badges, zoekknop
- **ChannelSidebar** (links): mailbox-achtige secties **Mappen**, **Labels** en **Klanten** met bijpassende iconen en mailbox-zoekveld
- **MessageArea** (midden): mailbox-achtige 2-koloms opzet met links een inbox-lijst (afzender, onderwerp, preview, unread-dot, labels) en rechts een geselecteerde mail-preview met body en quick actions (reply/reply-all/archive)
- Mail-preview ondersteunt een inline **AI suggesties**-blok boven de mailinhoud met hiërarchische tekstwolkjes (`info`, `proposal`, `task`)
- Suggestiewolkjes kunnen optionele metadata tonen (bijv. boekingsreferentie of taakcontext) en in de `proposal`-variant actieknoppen tonen zoals **Genereren** en **Reageren** (UI-only)
- Voor spoedmails ondersteunt de `task`-variant een visuele prioriteitsindicatie in dezelfde previewkolom
- Middenheader bevat mailbox-filters (**Alle**, **Ongelezen**, **Urgent**) voor snelle triage
- **InfoPanel** (rechts): tabloos overzicht gekoppeld aan het geselecteerde bericht met drie vaste blokken: **Contact info afzender**, **Notities** en **Eerdere berichten** van dezelfde afzender

**Email sample datamodel in frontend (`Message`):**
- Ondersteunt extra velden voor mailboxweergave: `subject`, `preview`, `body`, `fromEmail`, `accountName`, `labels[]`, `unread`
- Ondersteunt optioneel `aiSuggestions[]` met `level`, `text`, `meta` en optionele `actions[]` voor contextuele AI-voorstellen per mail
- Bestaande `content` blijft beschikbaar als fallback

#### Two-way agent chat in interne threads (2026-06)
- Een reply in een **interne agent-thread** (`channel="internal"`) via `POST /api/signals/{id}/reply` triggert nu de thread-agent: de backend draait `AgentLoop.run_chat` en voegt het antwoord toe als `agent_message`. Gated op `channel="internal"`, `direction="outbound"` (geen interne notities) en `not signal.ai_paused`. Externe kanalen (email/whatsapp/widget) en assistant-threads (afgehandeld via `/api/chat`) zijn uitgesloten. De agent-run is best-effort: een LLM-fout verliest nooit het bericht van de gebruiker.
- De geopende thread ververst live via het gateway-topic `signal:{id}` (`useThreadDetail`), zodat het agent-antwoord zonder handmatige refresh verschijnt.
- Mock-modus geeft een canned reply terug; live-modus vereist een tenant-BYOK of platform-sleutel.

---

### 2.9 Organisatieconfiguratie (`/settings/company-config`)
Scrollbaar instellingenformulier met sticky opslaan-balk.

**Secties:**
1. **Bedrijfscontext**: Naam, sector, website, beschrijving, doelgroep, tone of voice (6 opties), merkwaarden (tag-input), extra agent-instructies
2. **Huisstijl & Branding**:
   - Logo upload (drag & drop, SVG/PNG/WebP)
   - Primaire kleur + achtergrondkleur pickers (live hex)
   - Font selectors (display + body, 9 opties elk) met live preview
   - **StyleScanner**: URL invullen → scan detecteert kleuren en fonts van de website → "Huisstijl overnemen"
3. **Contactinformatie**: Telefoon, support e-mail, openingstijden
4. **Agent persona**: Agentnaam, begroetingsbericht, persoonlijkheidsbeschrijving

---

### 2.10 Sidebar Navigatiestructuur

#### Communication-rail met aanpasbare secties (juni 2026; vereenvoudigd juli 2026)
De binnenrail van de Communication-hub gebruikt een Intercom-achtig sectiemodel (`MessagesHubNav` + `SidebarPrefsContext` + `SidebarCustomizeDialog`):

- **Vaste top:** `+ New chat` (naar `/communication/new`) en de **Inbox**-sectie met queues All / Mine / Open / Unassigned / Closed (`/communication/inbox/:queue`). Inbox toont assignable conversaties over alle kanalen heen en sluit assistant-chats uit (backend folder `inbox`, `channel != assistant`; view `all` = geen statusfilter).
- **Aanpasbare secties** (`ALL_SECTIONS` = `agents | channels | settings`; volgorde/verbergen/inklappen in localStorage `communication-sidebar-prefs`; legacy `assistant` in opgeslagen prefs wordt genegeerd bij normalize):
  - **Agents** — personal assistant gepind bovenaan (`/communication/assistant`), daarna company agents (`/communication/agent/:agentId`), plus één **Activity**-leaf (`/communication/runs/all`). Updates / Results / Decisions zijn quick-filter chips op de Activity-lijstpagina (oude URLs `/communication/runs/:queue` blijven werken en preselecteren de chip).
  - **Channels** — e-mail per mailbox (`/communication/channel/email/:connectionId`), Webchat→`widget`, Internal chat→`internal`; WhatsApp/Slack alleen bij bestaand ChannelAccount. Het voormalige "Agent messages"-leaf is verwijderd (duplicaat van Activity).
  - **Settings** — vast geanchord onderaan de rail (niet meesleepbaar in customize; show/collapse wel); link-outs naar `/settings/channels` en `/settings/assistant`.
- **Dode surface (roadmap):** view/label preset-leaves in `messages-paths` (`/communication/view/:key`, `/communication/label/:key`) zijn niet meer in de rail; routes kunnen nog bestaan maar zijn geen primaire nav.
- **Customize-dialog:** tandwiel in de rail-header opent een dialog met drag-to-reorder (dnd-kit), Show- en Collapse-toggles per sectie en een reset-knop. Sectieheaders in de rail zijn zelf ook inklapbaar (chevron, gepersist).
- **Leaf-dispatch:** `leafFromPath` (in `messages-paths.ts`) bepaalt de actieve leaf; `Communication.tsx` rendert thread-lijst + `ThreadDetail` + `AgentThreadPanel` voor inbox/runs/channel/view/label, `DirectCommunication.tsx` rendert de AI-chat-lay-out voor assistant/agent-leaves.
- **Backend:** `list_threads` ondersteunt `channel`-filter, folder `inbox`, view `all` en tag-filter (JSON-LIKE op `tags_json`). Owners/admins zien álle actieve company agents in `GET /api/chat/targets` ongeacht `chat_access` (`allowed_company_agents(..., is_admin=True)`); members alleen `everyone`/`selected`-agents.
- **Routes/redirects:** default landing is `/communication/inbox/all` (ook na login/onboarding). Legacy redirects: `/communication/direct/my` → `/communication/assistant`, `/communication/direct/agent/:id` → `/communication/agent/:id`, `/communication/customers/:queue` → `/communication/inbox/:queue` (my→mine, all→open; awaiting-decision → runs), `/communication/customers/ch/:id/:queue` → `/communication/channel/email/:id`, `/communication/agents/:queue` → `/communication/runs/:queue`.

#### Communication-hub + personal/company agent-architectuur (juni 2026; Direct/Customers/Agent activity-rail hieronder is vervangen door het sectiemodel hierboven)
De Messages-hub is hernoemd naar **Communication** (`/inbox/*` → `/communication/*`, met catch-all redirect) en er is een personal/company agent-architectuur ingevoerd:

- **Agent kinds:** `Agent.kind` is `company` (gedeelde workforce-agent) of `personal` (privé-assistent van één user, `owner_user_id` gezet). Personal agents zijn uitgesloten van channel-routing-fallback en van `/api/workforce/agents`; ze verschijnen dus niet in de Agent library.
- **Personal assistant:** elke user krijgt lazy een personal assistant (`get_or_create_personal_agent` bij signup, invite-accept, workspace-create; backfill in `init_db`). Beheer op `/settings/assistant` (naam, instructies, default chat target) via `GET/PATCH /api/me/assistant`. Voorkeur (default target) staat in `user_preferences.default_chat_agent_id`.
- **Company agent chat-toegang:** `Agent.chat_access` = `everyone` | `selected` | `nobody`; allowlist in `agent_chat_users`. Beheer (owner/admin) via Communication-kaart op agent-detail (`/agents/:agentId`) → `GET/PATCH /api/workforce/agents/:id/chat-access`. Bootstrap-assistant krijgt `chat_access=everyone`.
- **Chat targeting:** `GET /api/chat/targets` geeft de user-specifieke targets (personal assistant eerst, daarna toegestane company agents, met `default_agent_id`). `POST /api/chat/conversations` accepteert `agent_id`; het target wordt op `Signal.agent_id` vastgelegd en stream/message-endpoints resolven de agent van de thread (fallback: legacy channel-routing). Conversation-payloads bevatten `agent_id`, `agent_name`, `agent_kind`; signal thread-payloads bevatten `agent_id`.
- **New conversation:** `/communication/new` is een composer-first surface met "To:"-picker (personal assistant voorgeselecteerd, zoekveld, company agents, coming-soon rijen voor email/teammate). Versturen maakt de conversation aan en navigeert naar `/communication/direct/my/t/:id` of `/communication/direct/agent/:agentId/t/:id` met auto-send van het eerste bericht.
- **Hub-navigatie:** drie logische secties in de Communication-rail — **Direct** (New chat + My assistant + Company agents als ontvangers; geen losse chat-threads in het menu), **Customers** (queues + e-mailkanalen; threads in het middelste paneel) en **Agent activity** (interne agent-updates/results/decisions, niet directe chats). Historic assistant/agent-chats verschijnen in het **thread-lijstpaneel** (zelfde UX als klantthreads) wanneer je een Direct-target selecteert. Default landing: `/communication/direct/my`.
- **Thread-context (rechterpaneel):** `AgentThreadPanel` toont per gesprekspartner de juiste kaart — Contact-tab voor externe threads, "Agent"-tab met de target-agent (via `Signal.agent_id`) voor interne/agent-threads; Orchestration blijft als tweede tab.
- **AI-chat-feel:** thread-timeline en reply-composer zijn gecentreerd op max-breedte (zoals de assistant-chat), met een rounded composer-card, Enter-to-send en een inline send-knop; notitie-modus blijft geel gemarkeerd.
- **Channel-aware composer (Intercom-model):** `resolveComposerSurface()` in `apps/dashboard/src/lib/message-composer.ts` kiest het reply-kanaal op basis van `Signal.channel` + ontvanger — **E-mail** (met handtekening + "Aan"-rij) voor `email` + contactadres, **Bericht/Chat** voor `internal`/`assistant`/`widget`/`chat` (geen handtekening), **WhatsApp** / **Slack** wanneer het kanaal dat is. Interne notities blijven altijd beschikbaar als aparte tab. Handtekening wordt alleen bij `format: email` toegevoegd in `useThreadDetail`.
- **Agent-thread labeling:** interne threads tonen in de lijst de **agent-naam** (`agent_name` of project-orchestrator) i.p.v. generiek "Agent"; `get_thread` en `list_threads` resolven de agent via `signal.agent_id`, bericht-`author_agent_id`, of `project.po_agent_id`. Rechterpaneel Agent-tab toont rol, status, activiteit en projectlink.

#### Complete messaging product (juni 2026)
Canonical model blijft `Signal` / `SignalMessage` (`/api/signals`) plus assistant via `/api/chat` — geen parallelle inbox-stacks.

- **Streaming:** `AgentLoop.stream_chat` roept echte `llm.stream_chat` aan (Anthropic + OpenAI). Gateway op topic `signal:{id}` publiceert `message.delta` (token-tekst), `agent.thinking` (reasoning deltas), `agent.step` (tool_call / tool_result / think), en `message` (final). Dashboard (`ThreadDetail`, `DirectChatPanel`) en mobiel (`useSignalStream`, `StreamingBubble`) tonen live deltas en tool-stappen. Assistant/internal chat kan Anthropic extended thinking gebruiken via `chat_thinking_budget` (of `agent.thinking_budget`); reasoning streamt als "Aan het nadenken..." en wordt opgeslagen in `metadata.thinking` (`text`, `ms`, `budget`). Chat/thread APIs exposen dit als `thinking` / `payload.agent_trace.thinking`. Dashboard toont een Cursor-stijl `ReasoningDisclosure` boven agent-bubbles (`Nagedacht voor Xs · +tokens`), met tool-stappen als fallback wanneer er geen reasoning-tekst is.
- **Assistant reliability:** `POST /api/chat/conversations/{id}/messages` en `/stream` vangen LLM-fouten af; bij failure wordt een zichtbaar agent-foutbericht opgeslagen zodat user-berichten nooit verweesd raken. Responses bevatten `llm_configured`, `llm_mode`, `llm_key_source`; `ai_paused` wordt expliciet afgehandeld.
- **Attachments:** `StorageService` (local disk dev, S3/R2 prod via env). `POST /api/uploads` retourneert `{id,name,mime,size,url}` (schema v1). Attachments worden geaccepteerd op chat send, `/signals/{id}/reply`, en notes. Vision: image attachments worden als base64-blokken in de laatste user message geïnjecteerd voor Anthropic/OpenAI.
- **Email:** outbound ondersteunt HTML body, CC/BCC, handtekening uit account settings, en `In-Reply-To`/`References` threading via laatste inbound `external_id`. Inbound sync bewaart `body_html` en attachment-metadata (Gmail MIME + Graph).
- **Decisions in threads:** `serialize_message` verrijkt decision-berichten met `payload.decision.options` uit `DecisionRequest`. `GET /api/notifications/decisions` bevat `signal_id` voor thread-linking. Notes: `GET/PATCH/DELETE /api/signals/{id}/notes[/{message_id}]`.
- **Mobile parity:** Expo app gebruikt SSE streaming voor assistant, react-query + gateway invalidation, volledige inbox-filters/paginatie/badge counts, thread composer (reply/note, send_and_close/pending, attachments), thread ops (pin/close/takeover/mark unread/delete), email HTML via WebView, conversation list + agent selection.

#### OpenClaw Control UI shell + hybride Messages-hub (juni 2026; paden hieronder zijn sindsdien hernoemd naar `/communication/*`)
De dashboard-shell is volledig herbouwd naar OpenClaw's Control UI-model (`apps/dashboard/src/components/shell/`, navigatiemodel in `src/lib/navigation.ts`). Chat en Inbox zijn daarna samengevoegd tot één hybride Messages-hub op `/inbox`:

- **Chat-first:** `/` redirect naar `/inbox/chat` (assistant-chat met SSE-streaming, inline decision cards); conversaties op `/inbox/chat/:conversationId`. Workspace-hub blijft op `/` voor multi-workspace accounts zonder tenant-subdomein.
- **Messages-hub (`MessagesHub` + `MessagesHubNav`):** full-bleed hub met drie spaces op "met wie praat je": **Assistant** (`/inbox/chat`, New chat + recente sessies), **Customers** (`/inbox/customers/:queue` — Awaiting decision, Open, Mine, Unassigned, Pinned, Pending, Closed + per-kanaal views op `/inbox/customers/ch/:channelId/:queue`; folder = external) en **Agents** (`/inbox/agents/:queue` — All, Updates, Results, Decisions (`awaiting-decision`); folder = internal). Aparte Chat- en Sessions-navitems bestaan niet meer.
- **Gedeelde thread-view:** één `ThreadDetail` met channel-aware composer (zie hierboven); interne agent-threads krijgen een **Bericht**-tab (geen e-mailhandtekening) plus **Notitie** en optioneel **Ask assistant** (prefill naar `/communication/new`).
- **Decision-threads zijn internal-channel signals**: agent-decisions verschijnen in de Agents-space (`/inbox/agents/awaiting-decision`), niet in de Customers-space; decisions op externe klantthreads verschijnen wel in `/inbox/customers/awaiting-decision`.
- **CRM:** `Contact`-model heeft `company`, `title`, `phone`, `notes`. Contactpaneel in thread-context als tab naast Orchestration (`AgentThreadPanel`): contactkaart, bewerkbare notities, approve/block, eerdere conversaties. Contacts-pagina op `/contacts` (zoeken, lijst met kanaal/bedrijf/laatst gezien/#threads) en contactdetail op `/contacts/:contactId`. Endpoints: `GET/PATCH /api/channels/contacts/:id`, `GET /api/channels/contacts/:id/threads`; signal thread-payload bevat `contact_id`.
- **Agenda:** `/agenda` vervangt het Triggers-navitem. Week- en lijstweergave van geplande agent-wakes, taken en events (uit `GET /api/agenda?from=&to=&agent_id=`); filters op agent en type; `?agent=` querystring preselecteert het agent-filter. "New"-knop opent de trigger-dialog voor alle kinds: `once` (eenmalige agent-taak, auto-disable na firen), `event` (kalender-item met notificatie, geen agent-run), `cron`, `interval`, `heartbeat`, `webhook` — met agent- of workstream-target en instructies. Automations-tab binnen Agenda bevat de voormalige Automations-pagina (Triggers-inventory, Workstreams, Agent profiles, Runtime profiles, Runs, Settings).
- **Sidebar-groepen:** Control (Overview `/overview`, Inbox `/inbox/chat`, Contacts `/contacts`, Activity `/activity`, Agenda `/agenda`, Usage `/usage`), Agent (Agents `/agents`, Skills `/skills`, Memory `/workspace`), Settings (`/settings/:section`). Footer: theme toggle, buildversie, gateway-verbindingsstatus.
- **Topbar:** breadcrumb `Bokito / <workspace> / <pagina>` met workspace-switcher, command palette (Ctrl+K), user-menu.
- **Overview-integratie:** naast stats en "Needs attention" toont Overview "Today on the agenda" (komende 24u) en "Recent contacts"; attention-items linken naar de juiste hub-space op basis van thread-folder. Agent-detail (`/agents/:agentId`) toont een "Upcoming on the agenda"-kaart plus knoppen naar `/agenda?agent=` en `/inbox/agents/all`.
- **Settings-secties:** Personal (profile, notifications, access-security), Workspace (general, branding, members), Channels (channels = email, assistant widget = `/ai/assistent/*`, communication agent, help-centers), Integrations (connected, marketplace, mcp), AI (`/settings/models` = Providers and models, owner/admin), Autonomy (`/settings/autonomy` = voormalige GovernPage).
- **Per-tenant LLM providers (2026-06):** owners/admins beheren op `/settings/models` eigen provider-connecties (`provider_connections`: type `anthropic|openai|openai_compatible`, label, optionele `base_url` voor compatible endpoints, encrypted API-key). Preset-modellen per type kunnen met één klik enabled worden; compatible providers krijgen handmatige model-ID's (`tenant_models`). Modellen per tenant aan/uit, default chat/embedding, agent-modelkeuze valideert tegen enabled tenant-modellen. Keys encrypted (Fernet); client ziet alleen `last4`. Test-endpoint: `POST /api/settings/providers/{id}/test`. Legacy `/settings/llm-keys` + `tenant_secrets` blijven bestaan als fallback tot migratie; `scripts/migrate_tenant_models.py` kopieert bestaande BYOK + platform-catalog prefs naar de nieuwe tabellen.
- **Model-catalog + token resale:** wanneer een tenant **geen** `tenant_models` heeft, valt resolutie terug op platform-catalog (`model_catalog`, staff-managed) + legacy BYOK/platform-keys. Zodra tenant-modellen bestaan, is `resolve_model_call` tenant-first: `TenantModel` → `ProviderConnection` key (`key_source=tenant`, niet billable). Platform-fallback: tenant BYOK → platform key → env-live → mock (billable bij platform key). Provider-abstractie: `get_chat_provider(provider_type, api_key, base_url)` — `openai` en `openai_compatible` delen `OpenAILLMProvider` (custom base URL). API tenant: `GET/POST/PATCH/DELETE /api/settings/providers`, `POST .../test`, `GET/POST/PATCH/DELETE /api/settings/models` (legacy `PUT /api/settings/models` alleen zonder tenant-modellen). Staff platform-catalog/keys/markup ongewijzigd. UI: Settings > AI > Providers and models; agent model picker via `lib/models-api.ts` + `settings.routes.ts`.
- **Govern opgelost:** geen `/govern`-pagina meer; posture/allowances/audit onder Settings > Autonomy & approvals; per-agent tools & permissions als panel op agent-detail (`/agents/:agentId`); decisions uitsluitend inline in chat/inbox-threads + "Needs attention" op Overview.
- **Legacy redirects:** `/home`→`/overview`, `/govern`→`/settings/autonomy`, `/chat`+`/sessions`→`/inbox/chat`, `/c/:id`→`/inbox/chat/:id`, `/messages/*`→`/inbox/customers/*` (updates/results→`/inbox/agents/*`), `/triggers`+`/automations`+`/orchestra`→`/agenda`, `/os`→`/agents`, `/os/docs`→`/workspace`, `/communication`→`/inbox/customers/my`, `/integrations/*`→`/settings/*`, `/ai/communicatie`→`/settings/communication`.
- **Nav-badges:** alleen op Inbox (ongelezen) en Agents (attention) in de sidebar; queue-tellers in de hub-kolom.
- Run-detail leeft op `/agents/:agentId/runs/:workLogId`; project-specifieke run-URLs (`/project/:id/workforce/...`) bestaan niet meer.

#### Legacy rail-shell (tot juni 2026, vervangen)
De portal gebruikte een Featurebase-achtige 2-laagse shell. Zie ook `apps/dashboard/docs/NAVIGATION.md`. Onderstaande beschrijving is historisch:

- **Primary rail (admin, icon-only):** Home (`/home`) → **AI OS** (`/os`, Network-icoon; unified Projects + Workforce) → Inbox → Integraties → Data; **Instellingen** onderaan (`/settings/profile`). Bokito rail keeps Orchestra under the AI OS sidebar.
- **AI OS sidebar:** Canvas (`/os`), Agent library (`/os/agents`), Decisions (`/os/communication`), Workspace (`/workspace`, markdown docs), plus platform agents. Workstreams sidebar block on `/project/:id/*` only. Canvas uses React Flow (`AiOsCanvas.tsx`); add nodes via toolbar palette; connect by drawing between handles. V1 is config-first (edges stored; runtime enforcement is a follow-up). Legacy `/projects`, `/workforce`, `/ai/agents` redirect to `/os` paths.
- **AI OS canvas interactions:** Click a node for `NodeDetailPanel` (connections list, drill-in links, remove from canvas). Orchestrator panel includes workspace-wide `DecisionsInline`. Draw connections: workstream→orchestrator (`routed_by`), workstream→repo (`uses_repo`), workstream→tool (`uses_tool`).
- **Agent avatarstijl (dashboard):** Agents tonen een AI-specifiek initiaalbolletje (`AiAvatar`) in sidebar/lijsten/detail, met subtiele gekleurde achtergrond, gekleurde letters en gekleurde rand+glow om AI-entiteiten visueel te onderscheiden van user avatars.
- **Inbox uitgaande handtekening-afbeelding:** Bij thread-replies bouwt de frontend standaard `body_html` met afbeelding op basis van `user.signatureUrl`; fallbackvolgorde is `user.tenant.logo` en daarna `/bokito-logo.svg` als default-logo.
- **Landing tenant:** admins gaan naar `/home` (overzicht: recente projecten, inbox-links, agent runs); end-users behouden project-redirect (0/1/many). Op `/home` is er geen context-sidebar (alleen rail + hoofdinhoud).
- **Project hub (`/projects`):** context sidebar: **Overzicht**, **Communicatie** en **Workspace** (link naar `/workspace`); **Workstreams** (`ProjectHubBackgroundWorkersNav`) met compacte projectrijen: gekleurde dot + teller, status als gekleurde tekst onder de titel. Per-project canvas: `WorkerStatusStrip` boven `ProjectTabNav`; status afgeleid via `deriveWorkerStatus` uit berichten (`decision_request` = geblokkeerd, overige `awaiting_human` = aandacht), budget, orchestration, work logs en repo-index.
- **Centrale workspace-docs (Phase 4):** de oude block-based Blueprint UI (`WorkspaceDocNavContext`, `PageTree`, `BlockEditor`, `RevisionPanel`, scaffold/handbook seeding) en het FastAPI `workspace_doc_*` schema zijn verwijderd. Tenant-brede markdown-docs leven nu op `/workspace` (`WorkspaceDocs.tsx`) tegen `/api/workspace/*`.
- **Per-project config (FastAPI):** `project_orchestration_config` + `GET/PATCH /projects/{id}/orchestration` zijn table-backed (records worden op eerste read automatisch aangemaakt). `project_notification_preferences` + `GET/PATCH /projects/{id}/notifications/preferences` zijn ook table-backed met default matrix-seeding op eerste read. `GET /projects/{id}/usage/summary` en `GET /projects/{id}/usage/budget` blijven ongewijzigd.
- **Per-project cockpit (`/project/:id/*`):** focust op projectuitvoering. Tab-volgorde: **Workstreams → Project-PO → Orchestratie → Communicatie → Workforce-geschiedenis → Tokenverbruik → Notificaties → Wijziging aanvragen → Instellingen**. `ProjectOverview` op `/project/:id/overview` is een workstreams-wireframe met stream-submenu, input/output placeholders en stapkaarten (agent, instructie, tools). `ProjectCommunication` op `/project/:id/communication` ondersteunt projectbreed + optionele `?stream=` filterweergave (mixed model).
- **Assistent-zijbalk (legacy):** vervangen door Workforce-zijbalk; widget/communicatie routes ongewijzigd onder `/ai/*`.
- **Agenten-zijbalk (legacy):** vervangen door Workforce; `/admin/runs` redirect naar `/workforce/agents`.
- **Integraties-zijbalk:** Verbonden, marketplace, MCP, API-sleutels (geen bronnen meer hier).
- **Data (rail):** menu-item staat op **Binnenkort** (niet klikbaar); `/database`, `/users/*` en `/data/*` redirecten naar `/projects` tot de module live is.
- **Inbox-zijbalk (unified, 2026-06):** Eén Messages-interface zonder Customer/Agents-segment of `?folder=`. `InboxSidebarNav` toont één queue-set (Awaiting decision, Open, Mine, Unassigned, Updates, Results, Pinned, More → Pending/Closed) plus mailbox-kanalen. Alle kanalen (extern + intern) in dezelfde lijst; backend `folder` param blijft optioneel maar default = alle kanalen. Decision cards inline in thread timeline (`DecisionRequestMessage`); resolve via Signal API.
- **Instellingen-zijbalk:** alleen **Persoonlijk** (profiel, notificaties) en **Workspace** (algemeen, branding, leden, facturatie, toegang); productconfig (inbox, assistent) niet meer in settings-subnav.
- Legacy redirects: `/integrations/sources` en `/datasources` → `/data/sources`; `/settings/data/*` → data/users-routes; `/workforce` → `/workforce/overview`; `/admin/runs` → `/workforce/overview`; `/project/:id/doc[/:slug]` en `/project/:id/pkb` → `/projects/docs`; `/project/:id/messages` → `/project/:id/communication`.
- **Navigatie-badges:** `NavBadgeProvider` in de portal-shell pollt inbox-threads (ongelezen bij mij + niet toegewezen) en workforce-berichten (`awaiting_human` voor admins). Tellers op rail (Inbox, **Workforce**, **Project hub**, Home), inbox-submenu (Open, Mijn, Niet toegewezen) en Project hub Communicatie-tab; refresh na mark-read/unread in `Communication`.
- **Workstreams wireframe (mei 2026):** `/project/:id/overview?stream=` is de workstream-cockpit: context bar toont **workstreamnaam + stream-status + worker-status** (niet projectnaam/repo). Horizontale tabnav en worker-status strip zijn op deze route verborgen; streamselectie gebeurt in de hub-sidebar. Standaard opent de pagina op het orchestration-canvas (Input → stappen → Output). **Request a change** verloopt sinds Phase 4 via workspace-docs (`/workspace`) en agent-tools (`write_doc`), niet via een aparte Blueprint-pagina.
- **Home recent activity feed:** De Home-pagina toont nu een gecombineerde activity-lijst (runs + workforce-berichten) in plaats van alleen recente agent runs. Elke rij toont project, actor, agent, workstream en actie-label, met doorklik naar project-communicatie of run-detail.
- **Agent types in Workforce-list:** De AI Agents-lijst groepeert agents op type met `Orchestrator` bovenaan en `Worker` daaronder. Type wordt als label getoond per agent. Orchestrator-detectie (`isOrchestratorAgent`) matcht `role_slug=orchestrator` plus legacy `po`/`manager`. Het legacy `po`-role is uitgefaseerd: backend mapt `role=po` → `orchestrator` (`role_slug`/`ROLE_NAME_MAP` in `workforce_runtime.py`) en een data-repair (`apply_data_repairs` in `schema_patch.py`) migreert bestaande `po`-agents bij startup.
- **Project hub selector:** In de linker Project Hub-zijbalk staat nu een projectselector boven de hub-links. De selector onthoudt het laatst geopende project per tenant (`localStorage`) en valt terug op het eerste beschikbare project.
- **Project workstreams (backend):** Workstreams zijn persisted entities per project (`project_workstreams` tabel) met API `GET/POST/PATCH /projects/:id/workstreams`. Eerste GET seed drie default streams als de lijst leeg is. Sidebar toont workstreams van het geselecteerde project (niet meer projectnamen). Response bevat ook gekoppelde `po_agent` (agent entity met `role=orchestrator`, via `projects.po_agent_id`).
- **Orkestrator in hub:** Gekoppelde orkestrator-agent wordt getoond in Project Hub sidebar en op `/project/:id/overview`. Klik opent **orkestrator-configuratie** op `/project/:id/orchestrator` (identiteit, koppelen/aanmaken, orchestration op één pagina; geen project context bar of horizontale tabs op deze route). Zonder orkestrator: sidebar-CTA "Orkestrator instellen" en setup-gate op workstreams/orchestration tot een orkestrator gekoppeld is. Backend (technisch): `GET/POST/PATCH/DELETE /projects/:id/po-agent`; `projects.po_agent_id` is bron van waarheid (één dedicated orkestrator per project, exclusief). Bij project-aanmaak (`POST /projects`, API 276) wordt automatisch een orkestrator-agent aangemaakt (`{project.name} Orchestrator`, `role=orchestrator`, `slug=orchestrator`). Na create redirect portal naar `/project/:id/orchestrator`. Legacy `/project/:id/po` redirect naar orchestrator. **Canonieke regel:** precies één project-gekoppelde orchestrator per project; geen tenant-level orchestrator zonder project (bootstrap/seed koppelen de orchestrator direct aan het demo-project, en `apply_data_repairs` verwijdert orphan-orchestrators zonder runs). `link_po_agent` weigert agents die geen orchestrator zijn.
- **Projectinstellingen (sidebar):** Onderaan de Project Hub-zijbalk staat **Projectinstellingen** (`/project/:id/settings`) zodra een project geselecteerd is. De pagina bevat algemene projectvelden, codekoppeling en een danger zone om het project te verwijderen. Verwijderen vereist dubbele bevestiging: de gebruiker moet de exacte projectnaam typen. Backend: `DELETE /projects/{id}` met body `{ confirm_name }` (verwijdert workstreams, ontkoppelt agents, verwijdert project). Naamcheck in FastAPI via DB-where (`$db.projects.name == $input.confirm_name`), niet via `|get:"name"` op een row-variabele — Metadata API push kan die expressie corrumperen naar letterlijke backticks. Post-deploy: `node scripts/verify-platform-api-push.mjs --apigroup 15 --api 302`.
- Er is geen aparte **Help**-rail en geen ingebouwde Swagger-route (`/docs`).

---

### 2.11 Dashboard Thema (portal)
- De portal ondersteunt zowel **dark mode** als **light mode**
- De gebruiker wisselt handmatig via een toggle in de topheader
- De gekozen mode wordt bewaard in `localStorage` als `bokito-portal-theme`
- Het thema wordt toegepast via CSS-variabelen (`data-theme` op `document.documentElement`), zodat Tailwind-kleurtokens in beide modi consistent blijven

---

### 2.12 Dashboard Design System (Featurebase-achtige fase)
- De dashboard UI gebruikt een Featurebase-achtige dark-first shell met compacte panelen, zachte borders en dense informatieblokken.
- De huidige make-overfase focust op **Support**, **Users** en **Settings** met werkende routes en zonder mock-cijferdashboards in de hoofdnavigatie.
- De profielpagina onder settings volgt nu een Featurebase-achtige opbouw met secties `Personal information`, `Theme`, `Security` en `Account`.
- Legacy-routes blijven bereikbaar via redirects naar de nieuwe informatiearchitectuur zodat de shell consistent blijft.
- De shell gebruikt nu een zachtere materialistische token-set (lagere contrastovergangen tussen app background, sidebar en surfaces) zodat dark en light mode dichter op de Featurebase visuele hiërarchie zitten.
- De rail toont opnieuw het Bokito-logo (`/bokito-logo.svg`) met theme-aware rendering: visueel wit in dark mode en neutraal grijs in light mode.
- De settings-shell is verder genormaliseerd op compactere maatvoering (smaller topbar, smallere context-sidebar, kleinere control-typografie) voor consistente sectiegroottes.
- `/settings/members` bevat nu een functionele `Members and teams` pagina: members- en invite-overzicht (workspace-scoped via `/workspaces`, `/workspaces/{id}/members`, `/workspaces/{id}/invites`) plus invite-actie via `POST /workspace-invites`.
- Teams op dezelfde pagina zijn workspace-scoped client-state en worden per workspace/tenant lokaal opgeslagen onder key `bokito_members_teams_{workspaceId|tenantSlug}`.
- Shell-indelingsregel: de portal gebruikt geen hard gescheiden topbar/rail-vakken; rail- en contextnavigatie renderen als zwevende panel-items zonder interne scheidingslijnen, en de page-content staat in één afgerond hoofdvlak (Featurebase-achtig).
- Layout-update op user feedback: de linker icon-rail heeft geen eigen paneelvlak meer; alleen rechts staat één gecombineerd shell-vlak met contextmenu (tussenmenu), header en inhoud.
- Header-update op user feedback: niet-werkende headeracties (theme-toggle en notificatieknop) zijn verwijderd; de header bevat nu alleen titel + zoekveld.
- Rail-update op user feedback: `Settings` staat onderaan in het menu direct boven de user-entry; user-initi alen krijgen een vaste achtergrondkleur wanneer er geen profielfoto is.
- User-menu update op user feedback: de linksonder user-entry gebruikt geen hover-uitlogactie meer maar een click-dropdown met Featurebase-achtige opties (`My Profile`, `Notification preferences`, `Light/Dark mode`, `My Organizations`, `Sign out`).
- Light-mode style-richtlijn: menu-items, cards en inputs gebruiken extra subtiele elevatie (inner + outer shadow), duidelijke maar zachte borders en rijkere active/hover states om een materialistischere Featurebase-feel te geven zonder harde contrasten.
- Navigatie-richtlijn op user feedback: context-menu-items tonen iconen zoals Featurebase; `My inbox` toont een persoonlijke avatar-indicator met initials als fallback.
- Header-richtlijn op user feedback: zoekbalk rechtsboven staat alleen op settings-routes en gebruikt een hogere control-height; shelltitels zijn compacter gemaakt.
- Settings IA update: `Custom Domain` en `Multilingual` zijn verwijderd uit de actieve settings-navigatie en hebben geen route meer in de portal.
- Settings IA update: `Emails` is verwijderd uit de actieve settings-navigatie en heeft geen eigen `/settings/email(s)` route meer; email-configuratie loopt via support (`/support/settings/general`).
- Tooltip-richtlijn op user feedback: rail-tooltips gebruiken geen native browser `title` meer maar een custom Featurebase-achtige tooltipstijl (donkere elevated bubble met zachte border en shadow).
- Email settings UX-richtlijn: `EmailSettings` is nu Featurebase-achtig ingedeeld met tabs `Sending`, `Ignored addresses`, `Branding` en `Signatures`; de bestaande OAuth/SMTP-koppelflow blijft onder `Sending`, terwijl `Branding` en `Signatures` als werkende UX-drafts zijn opgezet.
- Notifications UX-richtlijn: `/settings/notifications` heeft nu een Featurebase-achtige matrix met per notificatietype drie kanalen (`Desktop`, `Email`, `Mobile`) via toggles; huidige opslag is lokale UX-draft in `localStorage` (`bokito_notification_settings_v1`).
- Settings IA update: in `Products` zijn `Feedback & Roadmaps` en `Changelog` verwijderd; `Support` is vervangen door `Inbox` en aangevuld met `Email settings` en `Messenger`.
- Settings IA update: `Developers`, `MCP` en `Integrations` zijn voor nu verwijderd uit de actieve settings-navigatie; integratiebeheer onder `/integrations/*` (zie §2.6).
- Messenger UX-richtlijn: er is een nieuwe `Messenger` settingspagina (`/settings/messenger` en support alias `/support/customization` redirecten naar `/ai/assistent/internal/customization`) met een eenvoudige Featurebase-achtige opzet (customizationblokken + live previewkolom).
- Messenger Agent settings-tab (`MessengerSettings`): hoofdsegment heet `Agent settings` (voorheen Conversations); alleen frontend-state voor model (Bokito AI / Custom), Replies, Context and tools, en Handoff. Opslaan via `Save changes` bewaart deze velden nog niet. Op deze tab wordt geen rechter previewkolom getoond (geen `<bokito-chat>` mount) zodat de editor full-width is.
- Chat-widget accent-CSS (`widget-main.ts`): gloeien, zachte schaduwen en randen rond o.a. de home-knop “nieuw gesprek”, header-avatar, conversatie-avatars, tab-badge, invoerbalk-focus, record-pulse en dark-mode launcher volgen `var(--bk-primary)` via `color-mix` i.p.v. hardcoded groen; `--bk-on-primary` is de vaste donkere tekstkleur op primaire knoppen/badges. Het chatvenster (`.bk-window`) gebruikt een lichtere buitenschaduw dan voorheen; in `data-preview-mode` is die nog iets zachter. De “online”-statusdot blijft semantisch groen (`#4ADE80`).
- Messenger preview-widget: `<bokito-chat>` met `data-preview-mode="true"` rendert embedded zonder floating launcher; het venster gebruikt dezelfde nominale afmetingen als de productie-widget (`min(400px,100%)` x `min(640px,100%)` ten opzichte van het preview-paneel i.p.v. viewport), staat horizontaal en verticaal gecentreerd op de editor-canvas, opent direct en kan niet via de widget worden geopend of gesloten (geen launcher-toggle; sluit-animatie en idle-venster-hide zijn uitgeschakeld). Draft-styling gaat via `data-preview-overrides` en aparte preview-localStorage-namespace. De preview mount blijft actief bij wisselen tussen Customization en Installation; bij Agent wordt de widget uit de DOM gehaald en bij terugkeren opnieuw gemount (`previewPanelActive` + effect op `token`). Bij `data-preview-mode` wijzigt de widget `data-theme` niet meer vanuit agent-theme (`dark_light_mode`) of gebruikers-theme-localStorage bij het toepassen van overrides, zodat de Light/Dark-toggle van het dashboard niet wordt overschreven (bijvoorbeeld na accentkleur-wijziging).
- Messenger-instellingenpagina (`MessengerSettings` op `/ai/assistent/:audience/:section` met `audience` `internal` of `external` en `section` `customization`, `agent` of `installation`; voorbeeld `/ai/assistent/internal/installation`). `/ai/assistent` redirect naar `/ai/assistent/internal/customization`. Bovenste balk: titel **Assistent**, inline segment **Team (ingelogd)** / **Publiek (bezoekers)**, inline segment **Customization** / **Agent settings** / **Installation**, rechts `Save changes`. Twee kolommen (formulier + preview) alleen op Customization en Installation. Sub-segments Content vs Styling blijven onder Customization. Audience in de URL stuurt de install-snippet en team/publiek-copy. Overige gedrag (preview-widget, snippets, deploy-paden) zoals eerder beschreven.
- Workspace context is als globale provider opgenomen in de dashboard root (`WorkspaceProvider` binnen `AuthProvider`) zodat shell en pagina’s dezelfde actieve workspace gebruiken.
- Workspace-selectie bewaart de laatst gekozen workspace in `localStorage` onder `bokito_current_workspace`; initialisatie kiest prioriteit: auth-tenant-id (indien match), daarna opgeslagen workspace-id, daarna de eerste beschikbare workspace.
- De user dropdown in de rail bevat een ingebouwde workspace-switcher met de lijst uit `/workspaces` en markering van de huidige workspace.
- `Members and teams` gebruikt nu de globale `currentWorkspace` uit `WorkspaceContext` in plaats van een lokale “eerste workspace” selectie; members/invites volgen daardoor direct de actieve workspace.
- Er is een dedicated pagina `/workspaces` toegevoegd als centrale start- en beheerpagina voor workspaces (lijst + eenvoudige create-flow).
- De rootroute `/` stuurt gebruikers zonder workspaces automatisch naar `/workspaces`; tenant-admins landen op `/home`, overige tenant-gebruikers op project-redirect of `/home`.
- De user dropdown is vereenvoudigd: één duidelijke `Workspaces` navigatie-entry plus een compact blok met `Huidige workspace` en (alleen bij meerdere) `Wissel naar` om dubbeling met `Mijn organisaties` te vermijden.
- Workspace onboarding-flow is nu gesplitst in twee shells: een aparte `WorkspaceHubLayout` (bovenliggende omgeving) voor `/workspaces*` en de bestaande product-shell (`Layout`) voor support/settings/database/workforce.
- De workspace-hub gebruikt een eigen linker navigatie met vier items: `Workspaces`, `Billing`, `Account`, `Support`; `Referrals` is geen onderdeel van deze navigatie.
- De workspace-overview (`/workspaces`) toont Featurebase-achtige workspace cards plus een aparte create-card met plus-actie, en een hulpsectie met resources onder/naast de cards.
- Workspace-cards in `/workspaces` tonen naast slug ook de volledige tenant-URL (`https://<slug>.<domein>`) zodat gebruikers direct zien op welk subdomein de tenant draait.
- Klikken op een workspace-card forceert host-based tenant-openen via subdomein-origin i.p.v. interne route-navigatie; lokaal gebruikt de app `http://<slug>.localhost:<port>/...` zodat tenant-routing ook in dev expliciet via subdomein verloopt.
- Workspace-hub routes (`/workspaces*`) zijn control-plane only: op een tenanthost (`<slug>.bokito.ai` of `<slug>.localhost`) wordt altijd direct cross-host doorgestuurd naar de app-host (`app.bokito.ai` of `app.localhost`).
- De control-plane startpagina is `/` (workspace hub); `/workspaces` is alleen nog een backward-compatible redirect naar `/`.
- Workspace-hub secundaire routes zijn top-level: `/billing`, `/support`, `/account`; legacy paden `/workspaces/billing`, `/workspaces/support`, `/workspaces/account` redirecten naar deze korte routes.
- Workspace zonder subdomein kan niet worden geopend vanuit `/workspaces`; de kaart toont een verplichte subdomeinmelding en leidt door naar `/settings/branding` om het subdomein eerst in te stellen.
- Workspace-creatie in `/workspaces` vereist nu expliciet een subdomeinveld in de create-dialog; zonder geldig subdomein (3-63 chars, `a-z0-9-`) blijft aanmaken geblokkeerd.
- `organisation.livechat_settings.subdomain` is een expliciete schema-child (text, lowercase/trim) en wordt gebruikt als bron voor tenant host-routing in de dashboard-workspaceflow.
- Bestaande organisations in workspace `1` zijn gebackfilled met unieke subdomeinen: `bokito`, `chargecars`, `bakermat-design`, `bourgondienadvies`, `demo-organisation`.
- Multi-tenant autorisatie gebruikt nu een expliciete junction-tabel `tenant_membership` (`user_id`, `tenant_id`, `role`, `status`) i.p.v. een impliciete single-tenant koppeling via alleen `user.organisation_id`.
- `GET //api/auth/me` en legacy `GET /api:DavdZOps/auth/me` retourneren `memberships[]` en `current_tenant`, plus optionele input `tenant_subdomain` om tenant-context expliciet te selecteren. De stack loopt actieve `tenant_membership`-rijen en doet per rij een `organisation` lookup voor subdomein en naam; een `db.query` met join plus multiline `|map:`/backtick-filters veroorzaakte eerder een FastAPI runtime `fatal` (HTTP 500) en brak daarmee login/hydratie.
- Login- en auth-exchange endpoints zetten nu `bokito_refresh_token` cookies met wildcard domein voor zowel productie (`.bokito.ai`) als lokale ontwikkeling (`.localhost`) zodat sessies over subdomeinen herbruikbaar zijn.
- Redirectcontract blijft `return_to`; targets naar `/login` of `/auth/handoff` worden genegeerd en vallen terug op een veilige startroute om auth-loops te voorkomen.
- Workspace openen vanuit `/workspaces` gaat direct naar de tenant URL (`/home` voor admins) zonder frontend handoff-route.
- Frontend gebruikt `app.localhost` als lokale control-plane host en `*.localhost` als tenanthosts via env-config (`VITE_APP_CONTROL_PLANE_HOST_DEV`, `VITE_TENANT_ROOT_DOMAIN_DEV`, `VITE_APP_CONTROL_PLANE_URL`).
- Lokaal is `sessionStorage` niet gedeeld tussen `app.localhost` en `tenant.localhost` (andere origins); een refresh-cookie op `http` + `.localhost` is vaak onbetrouwbaar. In **Vite dev** alleen: na login op de app-host wordt bij cross-host `return_to` een eenmalige URL-hash `__bokito_at__=` meegegeven; de tenant-host leest die bij hydrate, zet het access token in eigen `sessionStorage` en wist de hash met `replaceState` (fragment gaat niet naar de server).

#### Tenant-auth runbook

- `Geen tenanttoegang`: gebruiker is geauthenticeerd maar heeft geen actieve `tenant_membership` voor het subdomein; UI toont expliciet toegang geweigerd i.p.v. login-redirect.
- `Nog steeds loginprompt op tenant`: verifieer dat `GET /auth/me` een membership met matching `tenant_slug` teruggeeft en dat de subdomeincookie (`bokito_refresh_token`) wordt meegestuurd.
- `Lege workspace op tenant-host`: controleer `tenant_membership.status = active` en dat `organisation.livechat_settings.subdomain` exact overeenkomt met de host.
- De hubnavigatie toont accountinformatie van de ingelogde gebruiker linksonder (naam + e-mail + initials) met een directe link naar de `Account` hubpagina, vergelijkbaar met FastAPI-achtige placement.
- De `Account` hubpagina bevat nu werkende basisinstellingen (profieloverzicht, snelle thema-toggle en uitloggen) in plaats van een placeholder.
- Workspace hub gedrag bij lege `/workspaces` response: frontend probeert een fallback-workspace op basis van `auth/me` tenantdata (`user.tenant`) zodat users met bestaande tenantcontext niet op een lege lijst stranden.
- Workspace overzicht is nu visueel gecentreerd (verticaal + horizontaal) als startpunt, met hulpitems onder de cards i.p.v. rechts ernaast.
- Workspace aanmaken in hub verloopt nu via een volledig klikbare create-card die een popup opent voor naaminvoer; na aanmaken opent de flow direct de setuproute binnen de workspace (`/settings/general`).
- Workspace-id verwerking in frontend accepteert nu zowel numerieke als string/UUID ids voor `/workspaces` responses; matching en localStorage-resolutie gebruiken string-key vergelijking om lege lijsten door type-mismatch te voorkomen.
- Meertaligheid: de dashboardshell ondersteunt nu runtime taalwisseling met `i18next` (`en`/`nl`) inclusief persistente taalkeuze via `localStorage` key `bokito-language`.
- De navigatiestructuur (rail, context-sidebar, header fallbacktitels en support/settings metadata) is vertaald via locale namespaces onder `apps/dashboard/src/locales/{en,nl}/nav.json`.
- De route `/settings/general` gebruikt de `WorkspaceSettings` pagina als algemene instellingenpagina en bevat de actieve taalwisselaar (`Nederlands`/`English`) die direct `i18n.changeLanguage(...)` aanroept.

#### Platform Design Unification (mei 2026)

Doel: het dashboard voelt overal als één product — zelfde spacing, surfaces, typografische hiërarchie, empty- en loadingpatronen, en pagina-opbouw — zonder bespoke flows (inbox 3-pane, messenger preview, database grid) te platslaan.

**Design tokens (canonical)**
- Achtergronden volgen een vier-laags hiërarchie: `bg` (root) → `bg-sidebar` → `bg-surface` → `bg-elevated`. Borders gebruiken `border-border/60` (zacht) of `/80` (default). Hover-achtergronden zijn `bg-bg-hover`. Inputs gebruiken `bg-bg-input` of `bg-bg-elevated`.
- CSS-variabelen leven centraal in [`apps/dashboard/src/index.css`](apps/dashboard/src/index.css); Tailwind-aliases in [`apps/dashboard/tailwind.config.ts`](apps/dashboard/tailwind.config.ts) (incl. `bg-root` en `bg-canvas`).
- Verboden legacy classes (mogen niet meer voorkomen in `apps/dashboard/src` buiten het deprecation-commentaar): `border-border-subtle`, `bg-surface-raised`, `bg-surface-muted`, `bg-border-subtle`, `ring-offset-bg-root`, `bg-bg-root`, `bg-surface-secondary`.

**Shared primitives**
- [`PageContent`](apps/dashboard/src/components/layout/PageContent.tsx) — canoniek inner-wrapper met `width` `sm` (640) / `md` (896) / `lg` (1000, default) / `xl` (1200) / `full`. Layout zelf levert al de outer padding (`px-5 pt-2.5 pb-5`); voeg geen extra horizontale padding toe.
- [`PageIntro`](apps/dashboard/src/components/layout/PageIntro.tsx) — beschrijving + optionele actions onder `AppHeader`. Bevat **geen** `h1`; titels horen alleen in `AppHeader`.
- [`EmptyState`](apps/dashboard/src/components/ui/empty-state.tsx) — uniforme empty UX met `icon`, `title`, `description`, `action`, `size`. Vervangt ad hoc `<Card className="text-center" />` blokken.
- [`LoadingBlock`](apps/dashboard/src/components/ui/loading-block.tsx) — variants `inline` (tekst), `center` (centered Loader2 + label) en `skeleton` (rijen).
- [`SettingsSection`](apps/dashboard/src/components/layout/SettingsSection.tsx) — `Card`-gebaseerde groepering met compacte header (titel + omschrijving + optionele actions) voor settings-formulieren.
- [`Card`](apps/dashboard/src/components/ui/card.tsx) is de enige React surface-primitive (incl. `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`). Gebruik geen handmatige `rounded-2xl border bg-bg-surface` divs meer.

**Header- en navigatiebeleid**
- Eén titel per scherm: `AppHeader` levert pagina-titels (gedreven door [`portal-nav.ts`](apps/dashboard/src/components/layout/portal-nav.ts) + locale-bestanden). Pagina's binnen `Layout` mogen geen eigen `<h1>` renderen.
- Subtitel + primaire CTA staan in `PageIntro`; daaronder volgt page content via `PageContent`.
- `SettingsLayout` is verwijderd; settings-navigatie loopt via `SectionSidebar` + `nav.json` keys.

**Migration status (mei 2026)**
- Klaar: tokens, primitives, header policy, integrations hub (`IntegrationsConnected`, `IntegrationsMarketplace`, `DataSources`), settings (`WorkspaceSettings`, `MemberManagement`, `InboxSettings`, `HelpCentersSettings`, `NotificationSettings`, `ProfileSettings`, `CompanyConfig`), projects (`Projects`, `CreateProject`, `ConnectProjectRepo`), doc/inbox/admin (`BlockEditor`, `BlockTypeMenu`, `PageTree`, `RevisionPanel`, `LiveWorkLog`, `AutonomousProposalCard`, `RunStatusIndicator`, `AdminRuns`), AI hub (`AiCommunicationSettings`, `McpSettingsContent`, `CloudAgent`).
- Out of scope (intentioneel bespoke): `MessengerSettings` split-panel + preview, `DatabaseLayout`/database grid, `WorkspaceHubLayout` (geen `AppHeader`), chat-widget styling.

**i18n-richtlijn**
- Alle UI-strings op gemigreerde routes komen uit `apps/dashboard/src/locales/{en,nl}/nav.json`. Hardcoded Nederlands of Engels in components is niet meer toegestaan op pages binnen `Layout`. Nieuwe namespaces volgen het patroon `{section}.{subsection}.{key}` (bv. `project.create.*`, `workforce.runs.*`, `ai.cloudAgent.*`).

**Dashboard shell reliability (mei 2026)**
- `sonner` toast-notificaties: `<Toaster />` gemount in `main.tsx`; `toast()` calls in settings/API flows zijn zichtbaar.
- `AppErrorBoundary` vangt uncaught React-fouten op met herlaad-CTA i.p.v. wit scherm.
- Frontend API-onboarding: `apps/dashboard/docs/API.md` verwijst naar `API_CONFIGURATION.md` en route-registry regels.

---

### 2.13 Email-instellingen (`/settings/communication-email`)
- Instellingen bevat een aparte sectie **Communicatie** met submenu-item **Email**
- De pagina gebruikt een lijstgerichte layout; in de header staan **Outlook koppelen** (OAuth) en **SMTP / IMAP toevoegen** (modal)
- **Outlook (productie)**: delegated OAuth via Microsoft Identity Platform en Microsoft Graph. Tokens en sync lopen per **Bokito-account** (`account`-rij); de ingelogde portalgebruiker start de OAuth-flow. De pagina toont de tenantnaam uit `auth/me` bij de koppeling
- Na succesvolle OAuth redirect terug naar deze route met query `?outlook=connected`; fouten komen binnen als `?outlook_error=...`; bekende foutcodes waaronder **`token_exchange`** (token-POST naar Microsoft mislukt: vaak redirect-URI-afwijking, onjuist secret, verlopen of hergebruikte code); optioneel `aad_detail=` (URL-encoded tekst van Microsoft/AAD voor support). De dashboard-OAuth-flow stuurt `return_url` mee naar de pagina waar de gebruiker de koppeling startte (pathname + origin). Bij start kan `prompt=consent` op de authorize-URL worden meegegeven om een refresh token te stimuleren.
- **SMTP / IMAP**: alleen **concept** in de browser (geen FastAPI-opslag); duidelijke copy op de pagina. Geen Gmail-OAuth in deze release

#### FastAPI API-groep `Authentication` (`api:DavdZOps`)
- `GET /email/oauth/start` — auth **user**; generieke OAuth start voor `provider=outlook|gmail`, slaat state op en retourneert `{ authorize_url }`.
- `GET /email/outlook/oauth/start` — auth **user**; legt een rij in `outlook_oauth_state` aan en retourneert `{ authorize_url }` voor redirect naar Microsoft. In de stack wordt `auth.id` eerst gecast met `to_int` voor `db.get user` op numerieke `id`, en `expires_at` gezet met `now|add_secs_to_timestamp:900` (15 minuten). Gebruik niet `timestamp_add_days` voor dit doel: die filter ontbreekt op veel FastAPI-instances en geeft `Unable to locate func entry: timestamp_add_days`. **Als `MICROSOFT_CLIENT_ID` of `MICROSOFT_REDIRECT_URI` in FastAPI env leeg zijn**, bevat de gegenereerde Microsoft-URL lege queryparams (`client_id=&redirect_uri=`); de endpoint valideert dit met een `precondition` en geeft een duidelijke `inputerror` i.p.v. door te redirecten.
- `GET /email/outlook/oauth/start` — auth **user**; legt een rij in `outlook_oauth_state` aan en retourneert `{ authorize_url }` voor redirect naar Microsoft. In de stack wordt `auth.id` eerst gecast met `to_int` voor `db.get user` op numerieke `id`, en `expires_at` gezet met `now|add_secs_to_timestamp:900` (15 minuten). Gebruik niet `timestamp_add_days` voor dit doel: die filter ontbreekt op veel FastAPI-instances en geeft `Unable to locate func entry: timestamp_add_days`. **Als `MICROSOFT_CLIENT_ID` of `MICROSOFT_REDIRECT_URI` in FastAPI env leeg zijn**, bevat de gegenereerde Microsoft-URL lege queryparams (`client_id=&redirect_uri=`); de endpoint valideert dit met een `precondition` en geeft een duidelijke `inputerror` i.p.v. door te redirecten. De endpoint accepteert nu optioneel `return_url` en slaat die per state op (`outlook_oauth_state.return_url`); als `return_url` ontbreekt, gebruikt hij `dashboard_outlook_return_url` (met fallback naar `https://app.bokito.ai/settings/support/general`).
- `GET /email/outlook/oauth/callback` — **publiek** (geen Bearer); wisselt `code` om, haalt Graph `/me` op, schrijft of werkt `email_oauth_connection` bij voor `organisation_id` uit de state, en antwoordt met **HTML** meta-refresh naar `dashboard_outlook_return_url` met `?outlook=connected` of `?outlook_error=...` (fallback: `https://app.bokito.ai/settings/support/general` als env leeg is). Vóór de token-call: controle dat `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` en `MICROSOFT_REDIRECT_URI` (FastAPI env) niet leeg zijn; anders redirect `?outlook_error=missing_oauth_env`. Token-POST naar Microsoft gebruikt `api.request` met `Content-Type: application/x-www-form-urlencoded` en `params` als key-value (`client_id`, `client_secret`, `grant_type`, `code`, `redirect_uri`), waarden via `to_text`. Lege `MICROSOFT_CLIENT_ID` geeft bij Microsoft vaak **AADSTS900144** (*The request body must contain the following parameter: 'client_id'*). Incident 2026-05-08: de callback kon crashen met `ERROR_CODE_INPUT_ERROR` (*1st operand must be one of these types...*) door een type-onveilige state-lookup (`nonce|to_text == state`) in de `db.query` where; fix is directe vergelijking op de uuid-kolom (`nonce == state`) plus timestamp-veilige `now`-afhandeling, waardoor de flow nu weer HTML-redirects teruggeeft (`invalid_state`, `expired_state`, `no_refresh_token`) in plaats van een 400 JSON crash. De callback gebruikte tijdelijk tenant-subdomain afleiding (`https://<subdomain>.bokito.ai/...`), wat in sommige tenants NXDOMAIN kon geven (bijv. `bokito.bokito.ai`); dit is vervangen door de env-gedreven return URL.
- `GET /email/google/oauth/start` — auth **user**; Gmail OAuth start met `access_type=offline`, `prompt=consent`, state-opslag en optionele `return_url` (zelfde state-tabel als Outlook). De state-rij krijgt `feature = "gmail-email"` voor centrale callback-routing.
- `GET /email/google/oauth/callback` — **publiek**; wisselt autorisatiecode om via `https://oauth2.googleapis.com/token`, leest profiel via `https://www.googleapis.com/oauth2/v3/userinfo`, upsert `email_oauth_connection` met `provider=gmail`, en redirect terug met `oauth_provider=gmail` + `oauth_status` of `oauth_error` + `oauth_detail`.
- `GET /oauth/google/callback` — **publiek**; centrale Google callback-route (Pattern 2). Leest state uit `email_outlook_oauth_state`, inclusief `feature`, en handelt nu Gmail af via dezelfde token/profile flow als de eerdere email-specifieke callback.
- `GET /oauth/microsoft/callback` — **publiek**; centrale Microsoft callback-route (Pattern 2). Leest state uit `email_outlook_oauth_state`, inclusief `feature`, en handelt Outlook email af via dezelfde token/Graph flow als de eerdere email-specifieke callback.
- `GET /email/connections` — auth **user**; lijst koppelingen voor het account van de gebruiker (zonder `refresh_token`). In de function stack: `db.query` met `return = { type: "list" }` **zonder** paging levert de rijen als **array op de variabele zelf**; map die met `array.map ($raw_conn)`, niet `$raw_conn.items` (die sleutel bestaat pas bij paging). Rijen worden gemapt naar veilige velden met `connection_pk` i.p.v. `id` in de output.
- `DELETE /email/connections/{connection_id}` — auth **user**; verwijdert gekoppelde `email_synced_message`-rijen en de OAuth-rij na tenant-check

#### FastAPI tabellen (workspace Bokito AI app)
- `email_oauth_connection` — per account: Microsoft user id, mailbox, encrypted refresh token veld (text sensitive), `delta_link`, `last_sync_at`, `status` (`active` / `error` / `revoked`)
- `email_outlook_oauth_state` — korte OAuth state (`nonce`, `organisation_id`, `user_id`, `expires_at`, `return_url`, `feature`); `feature` ondersteunt centrale provider-callbacks voor meerdere Google/Microsoft integraties (zoals email, Drive, Calendar) zonder aparte provider redirect URI per feature.
- `email_synced_message` — opgeslagen inbox-berichten per `connection_id` (Graph id, subject, from, preview, optioneel `graph_payload`)

#### FastAPI scheduled task
- `email/outlook_sync_inboxes` — elke **900** seconden (15 min): Outlook-rijden met `status` actief en `is_enabled` leeg of `true`; refresh token; Graph **delta** op inbox, paginering tot `deltaLink`, upserts in `email_synced_message`; werkt `delta_link` en `last_sync_at` bij; bij fout zet `status` op `error` en vult `last_error`

#### Omgeving / Azure (handmatige setup)
- In **Microsoft Entra ID**: app registration (vaak multi-tenant), delegated permissions: `offline_access`, OpenID profiel, `User.Read`, `Mail.Read`, `Mail.Send`; **Web** redirect URI exact gelijk aan FastAPI env `MICROSOFT_REDIRECT_URI`. Dat kan de centrale route zijn (`GET /oauth/microsoft/callback` op `/api/integrations`) of, als de stack die URL zo opbouwt, de app-groep callback `GET /email/outlook/oauth/callback` op `/api/app` (bijv. canonical `https://api.bokito.ai//api/app/email/outlook/oauth/callback`). Verifieer altijd de authorize-URL die de browser krijgt; die `redirect_uri` moet letterlijk in Entra staan op **dezelfde** app registration als `MICROSOFT_CLIENT_ID`.
- Pattern 2 (centrale provider callback): registreer in Google Cloud / Entra exact dezelfde redirect als in FastAPI env: `GOOGLE_REDIRECT_URI` voor `GET /oauth/google/callback` en `MICROSOFT_REDIRECT_URI` voor `GET /oauth/microsoft/callback` wanneer die centrale route wordt gebruikt (zelfde host + pad als in env). Als productie in plaats daarvan `/api/app` + `/email/outlook/oauth/callback` gebruikt, hoort die URI in Entra — niet alleen de portal Azure AD login-URI (`/api/auth/callback/azure-ad`).
- **Supported account types** (App registration → **Authentication** of **Overview**): als gebruikers **persoonlijke Microsoft-accounts** (@outlook.com, @live.com, @hotmail.com) moeten kunnen inloggen, kies een optie die **personal Microsoft accounts** expliciet toestaat (bijv. multitenant + personal). Alleen *Accounts in this organizational directory only* of alleen werk/school zonder consumers geeft na inloggen met een consumer-account de fout **`unauthorized_client` — *The client does not exist or is not enabled for consumers*** (vaak zichtbaar op `login.live.com`). Zakelijke mailboxen: gebruikers inloggen met **werk- of schoolaccount** van de tenant waar de app voor is ingericht.
- FastAPI **environment variables** (Outlook / Microsoft): `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` (zelfde waarden als in Azure Entra app registration; redirect URI = exacte FastAPI callback-URL). Daarnaast `dashboard_outlook_return_url` (volledige URL naar de dashboardpagina na OAuth, bv. `http://localhost:5174/settings/email` voor Vite-dev of productie-URL). **Dashboard** roept `GET /email/oauth/start` en gerelateerde routes via **`/api/integrations`** aan; als `MICROSOFT_CLIENT_ID` daar leeg is maar wél op een andere groep staat, kan Microsoft reageren met *The provided request must include a 'client_id' input parameter* (authorize-URL bevat dan `client_id=` zonder waarde).
- FastAPI **environment variables** (Outlook / Microsoft): `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` (zelfde waarden als in Azure Entra app registration; redirect URI = exacte FastAPI callback-URL). Daarnaast `dashboard_outlook_return_url` (productie return URL) en optioneel `dashboard_outlook_return_url_local` (lokale return URL, bv. `http://localhost:5174/settings/support/general`).

---

## 3. Mobiele App – Schermen & Features

Tech stack: React Native + Expo Router + Gesture Handler + Reanimated. Fonts: Jaro, Montserrat, JetBrainsMono.

### 3.1 Home (`/`) – Twee-pagina pager
Horizontaal veegbaar met paginadots bovenaan.

**Pagina 0: Gesprekken**
- Gradient header met hamburger, "Bokito.ai" logo, zoekbalk (live filter op titel + laatste bericht)
- Gesprekslijst (`FlatList`) — pull-to-refresh, lege staat
- FAB (groen, rechtsonder) → nieuw gesprek aanmaken → navigeert naar `/chat`
- Bij laden: `initSession()` + `loadConversations()`
- `LoginRequiredGate` bij ongeauthenticeerde gebruiker

**Pagina 1: Cloud Agents**
- Gradient header met hamburger + instellingenknop (naar `/settings`)
- Twee tabs: Lijst en Schedule

  *Lijst-tab:*
  - Samenvattingsrij: Totaal / Actief / Slapend
  - Versleepbare volgorde via long-press (`DraggableFlatList`)
  - **AgentRow**: geanimeerde glow-avatar (puls bij actief, maanbadge bij slapend), naam, beschrijving, laatste-run, volgende-run, mini sparkline (24h activiteit), requests, succesrate
  - FAB opent `CreateAgentModal`

  *Schedule-tab:*
  - Verticale 24-uurs tijdlijn (64px per uur), scrolt naar huidig tijdstip
  - Rode "nu"-indicator lijn
  - **DraggableScheduleBlock**: long-press + drag om blokken te verplaatsen (snaps op 15-min grid)

---

### 3.2 Chatscherm (`/chat`)
- Gradient header met terug, gesprekstitel, statusdot, opties
- **Agent mode banner** (oranje): zichtbaar bij overdracht naar menselijke agent
- **Fouttoast**: auto-dismiss na 5s
- **Nieuw gesprek state**: welkomstavatar + begroeting + horizontale suggestiechips
- **Berichtenlijst** (`FlatList`): auto-scroll bij nieuw bericht en keyboard-open
- **Thinking indicator**: geanimeerde dots + `toolSteps` (tool-call stappen zichtbaar tijdens AI-verwerking)
- **ChatInput**: tekstveld + afbeeldingsbijlage (`expo-image-picker`) + verzendknop, uitgeschakeld tijdens verwerking

---

### 3.3 Agent Detail (`/agent`)
- Gradient header met terug + agentpictogram + naam
- **Hero**: 72px avatar (tik opent `IconPickerModal`), puls-glow ring bij actief, maanbadge bij slapend
- **Stats grid**: Requests, Succesrate, Uptime, Gem. responstijd
- **Activiteitsgrafiek**: geanimeerde real-time staafgrafiek (24h data)
- **Details**: Model, Schedule, Laatste actief, Volgende run, Fouten vandaag (amber bij > 0)
- **Tools sectie**: tool-chips
- **Actieknoppen**: Pauzeren/Activeren, Configuratie

---

### 3.4 State & API (Mobiel)
- **ChatContext**: sessie-initialisatie, gesprekken laden/aanmaken/openen/sluiten, berichten, suggesties, bijlage-upload, SSE-streaming, `isThinking`, `toolSteps`, `isAgentMode`, `loginRequired`
- **AgentContext**: icoon-overrides per agent (persistent)
- **ApiClient**: GET, POST, PATCH, SSE-streaming (`openStreamPost`), bijlage-upload (multipart)
- **Authenticatie**: `customer_id` in `AsyncStorage`, session auto-refresh bij 401

---

## 4. Chat Widget – Features

Type: Vanilla JS embeddable widget, geen framework. Geladen via `<script>` tag.

### 4.1 Embed
```html
<script
  src="https://app.bokito.ai/chat-widget/bokito-chat.js"
  data-bokito-chat-widget
  data-agent-slug="assistant"
  data-api-url="https://app.bokito.ai"
  data-tenant="my-tenant"
  data-auth-mode="anonymous"
  defer>
</script>
```
Voor ingelogde platformgebruikers: `data-auth-mode="required"` plus `window.BokitoConfig = { getAuthToken: () => token }`. Het snippet wordt gegenereerd op Settings > Messenger.

- De widget gebruikt de API-host van `data-api-url` of leidt die af uit de script-URL (stuk voor `/api/livechat`), en normaliseert trailing slashes. Dit voorkomt dat berichten naar een verkeerde host of dubbele URL gaan bij inject-embeds.

### 4.2 Features
- **Widget chrome (Featurebase/Intercom-achtig)**: geen buitenrand op het venster; **24px** hoekradius en diepe schaduw. De **atmosfeerlaag** (`.bk-window::before`) is configureerbaar en mengt standaard het **accent** (`--bk-primary`) met de **achtergrond** (`--bk-bg`) via `color-mix` (geen donkere bovenkap in light mode). Hoogte via `--bk-atmosphere-height` / `--bk-atmosphere-min-height`; optioneel tenant-override, zie **`agent_config.theme`** hieronder. **Header-avatar** (logo-links): in **light mode** witte cirkel (`--bk-bg-surface`), dunne rand en minimale schaduw; in **dark mode** blijft de groene gloed/inset. **Home**: ruimere welkomstypografie; **Nieuw gesprek** als glazen kaart. **Open launcher**: header en home met `bk-header-in`; `prefers-reduced-motion` schakelt animaties uit.
- **`agent_config.theme` (accent + atmosfeer + launcher)**: na `session/start` zet `#applyAgentTheme` o.a. `main_color` / `primary_color` op `--bk-primary` en leidt **`--bk-primary-dark`** (gedimd) en **`--bk-primary-light`** (`rgba` uit het accent) af. Optionele velden (alleen gezet als geldig / veilig): `atmosphere_height` en `atmosphere_min_height` (CSS-lengte-strings), samen `atmosphere_height_pct` (1–100) en `atmosphere_max_px` (80–900) voor `min(pct%, px)`, `atmosphere_intensity` (0–1) met `atmosphere_linear_fade_end_pct` (JS bouwt dan `--bk-window-atmosphere-bg` na gebruikersthema zodat `--bk-bg` klopt), `atmosphere_background` (volledige CSS `background`; overschrijft gegenereerde atmosfeer; geen `url()`/`@import`/script), `text_color` (`--bk-text-inverse`), `dark_light_mode` (`light`|`dark` forceert `data-theme` op de host). De **launcher** gebruikt **`--bk-launcher-ring`**, lichte launcher-skin in light mode en `--bk-launcher-close-color` voor het sluit-icoon.
- **Launcher**: zwevende knop (standaard **58px** diameter via `--bk-bubble-size`; chat- en sluit-iconen iets kleiner t.o.v. de knop) met "Happy Bokito" monkey-face SVG + knipperanimatie, optionele labeltekst
- **Sleepbare launcher**: bezoeker kan de launcher verslepen langs de onderkant en rechterrand (L-vormig rail incl. hoek). Positie wordt opgeslagen in `localStorage` onder key `bokito_widget_pos` (`{edge:'bottom'|'right', offset:number, savedAt}`). Drempel van 6px onderscheidt klik van drag. Werkt ook op mobiel; window opent op mobiel altijd fullscreen.
- **Slimme open-positie van het chat-window**: `#computeWindowAnchor` kiest horizontale (`left`/`right`) en verticale (`top`/`bottom`) ankerkant op basis van launcher-centrum t.o.v. viewport-midden, en zet bijpassende `transform-origin` zodat de spring-in animatie vanuit de launcher-hoek komt.
- **SSE-streaming**: AI-antwoorden real-time karakter voor karakter gestreamd
- **Bijlagen**: bestanden en afbeeldingen uploaden
- **Voiceinput**: spraakherkenning (benoemd in README)
- **Startervragen / suggestiechips**
- **Chatgeschiedenispersistentie**: via `localStorage`
- **Dark/light mode**: adapteert aan browser `prefers-color-scheme`; gebruikers kiezen **licht / donker / systeem** via instellingen (`bokito_theme`). In het **account-popover** staat een **knop** met zon-/maan-icoon en tekst **Donkere modus** of **Lichte modus** (naar de tegenovergestelde modus); die zet `bokito_theme` op `dark` of `light`. De **header** heeft een hogere `z-index` dan het home-paneel zodat het popover boven o.a. de CTA blijft. Scrollketen: `.bk-home-content` vult het paneel zonder zelf te scrollen; het **Home**-tabblad scrollt in `.bk-home-tab[data-tab="home"]`; op **Berichten** scrollt alleen `.bk-conv-list` zodat de tabnav vast blijft. **Powered by**-rij onderaan krijgt `padding-bottom` met `env(safe-area-inset-bottom)` zodat iOS-home-indicator geen dubbele inset samen met de tabbalk veroorzaakt.
- **PII-filter**: verwijdert e-mailadressen, creditcardnummers, 9-cijferige IDs, telefoonnummers uit berichten voor verzending
- **MarkdownRenderer**: verwerkt bold, italic, code, links, lijsten in AI-antwoorden
- **Identiteitstoken (SSO)**: `identityTokenGetter` callback voor ingelogde gebruikers
- **GDPR**: geen cookies zonder toestemming
- **Configuratie via `data-*` attributen**: `data-agent-slug`, `data-bot-name`, `data-primary-color`, `data-position`
- **Multi-tenant auth bootstrap**: widget kan host-auth overnemen via `data-auth-cookie-name`, `data-auth-token` of `window.BokitoConfig.getAuthToken()`, en stuurt dan `host_auth_token` mee naar `session/start`.
- **Auth modes**: `anonymous`, `optional`, `required` worden ondersteund via backend `agent_config.auth_mode` of `data-auth-mode`.
- **Home vs chat**: Op het startscherm staan tabknoppen onderaan; in actieve chat neemt de invoerbalk die plek in. **Terug naar menu** staat als pijlknop links in de header (zichtbaar zodra het chat-paneel open is, los van state-machine edge cases zoals `error`). Bij open instellingen: eerst instellingen sluiten, anders terug naar het hoofdmenu via state `home`. De regel **Powered by Bokito AI** staat onderaan het venster (niet alleen onder de home-tabs), verborgen op het inlogscherm en wanneer instellingen open zijn; de regel is een link naar `https://bokito.ai` (nieuw tabblad).
- **Host-user resolutie voor avatar/popover**: omdat `POST /api/livechat/session/start` geen `data.user` retourneert, haalt de widget de logged-in user apart op:
  - Eerst inline via `window.BokitoConfig.user` of `getUser()` (preferred, zonder extra request).
  - Anders via `GET /api:DavdZOps/auth/me` met `Authorization: Bearer <host_auth_token>`. URL is overrideable via `data-host-me-url` of `BokitoConfig.hostMeUrl`.
  - Het resultaat wordt gemerged in `#sessionUser` zodat avatar, initialen en popover de echte naam/email/avatar tonen.
- **Dashboard \u2192 widget bridge** (`apps/dashboard/src/lib/widget-bridge.ts`): `AuthProvider` publiceert de huidige user naar `window.__bokito_dashboard_user__`; `main.tsx` zet `BokitoConfig.getUser()` als reader. Embedded widget mount krijgt `data-auth-mode="optional"`.
- **Sign-in handling**: de widget verzamelt nooit credentials; bij verplichte auth zonder geldig token toont hij een "Sign in required"-paneel met link naar de host-loginpagina (`agent_config.login_url` of `data-signin-url`). Het oude ingebouwde loginformulier en `POST /api/livechat/auth/login` zijn verwijderd (2026-07, cycle 6).
- **Programmatic API**: het `<bokito-chat>` element exposeert `open()`, `close()`, `toggle()`, `identify(token)` en `logout()` voor host-platforms. De shadow root is **open** (styles blijven gescoped) zodat Playwright/E2E-tooling en host-debugging bij de internals kunnen.
- **User preferences sync**: bij beschikbare API gebruikt de widget `GET/PATCH /api/livechat/user/preferences` met localStorage als cache/fallback.
- **Authenticated history first**: de widget probeert eerst `GET /api/livechat/user/conversations` en valt terug naar `customer/conversations`.
- **Conversation-endpoints**: `POST /api/livechat/conversation` retourneert een flat shape (`{conversation_id, id, session_token}`); voor anonieme sessies koppelt de backend de thread aan het `customer_id` uit het sessietoken zodat historie page-reloads overleeft. `GET /api/livechat/conversation/{id}` en `GET /api/livechat/conversation/{id}/messages` leveren thread-info en berichten, met ownership-check (eigen user-thread of Contact-match op `customer_id`), anders 404.
- **Timestamps**: de API stuurt naive ISO-timestamps in UTC (zonder `Z`); de widget normaliseert die vóór parsing (`normalizeServerTimestamp`) zodat relatieve tijden ("now", "4m") kloppen in elke tijdzone.
- **Auth-token transport**: het sessietoken reist uitsluitend via de `Authorization`-header, nooit als query-parameter (voorkomt token-lek in access logs).
- **Tenant MCP context forward**: `mcp_server_ids` + `tenant_context` worden meegestuurd in stream-chat requests wanneer session payload tenant-MCP data bevat.

---

## 5. Document & OCR Module

*(Zichtbaar in navigatie onder Automatisering → Documenten & OCR, nog niet geimplementeerd in frontend)*

**Buckets (Documentcollecties)**
- Een bedrijf kan meerdere buckets aanmaken, elk voor een specifiek documenttype
- Voorbeelden: Bonnetjes, Facturen, Contracten, HR-documenten, Garantiebewijzen
- Documenten worden geupload of gescand (via chat of webapp) en ingedeeld per bucket

**Indexering**
- Na upload: OCR-verwerking (tekst-extractie uit afbeeldingen/PDF's)
- Geextraheerde data wordt geindexeerd en doorzoekbaar gemaakt
- Automatische veldherkenning: datum, bedrag, leverancier, contractpartij, etc.

**Toegangsbeheer per bucket**
- Admin bepaalt wie toegang heeft: specifieke medewerkers, rollen, of publiek
- Toegangsrechten bepalen wat agents mogen ophalen en tonen

**Agent-integratie**
- Agents halen documenten op uit een bucket als onderdeel van een gesprek
- Gebruikers kunnen vragen als: "Wat was het bedrag op de factuur van leverancier X?"
- Elke bucket is een doorzoekbare kennisbron voor de agent

---

## 5b. Web Scraping & Documentatie Datamodel

FastAPI workspace 1 bevat drie tabellen voor het opslaan van gescrapete webpagina's en documentatie, ten behoeve van AI-zoeken (RAG).

### Tabelstructuur

```
organisation
  └── doc (id: 39)              — documentatiebron / gescrapete site
        └── doc_page (id: 40)   — individuele gescrapete pagina
              └── doc_section (id: 41)  — inhoudschunk + vector embedding
```

### `doc` (tabel-id: 39)
Vertegenwoordigt een documentatiebron op hoog niveau (bijv. een volledige websitedomein).

| Kolom | Type | Omschrijving |
|---|---|---|
| `id` | uuid | Primary key |
| `created_at` | timestamp | Aanmaakdatum |
| `organisation_id` | uuid → organisation | Tenant-isolatie |
| `title` | text | Naam van de documentatiebron |
| `source_url` | text | Root-URL van de gescrapete site |
| `description` | text? | Optionele beschrijving |
| `status` | enum | `active` / `archived` / `scraping` / `error` |
| `last_scraped_at` | timestamp? | Tijdstip laatste succesvolle scrape |
| `metadata` | json? | Scrapeconfiguratie, selectors, etc. |

### `doc_page` (tabel-id: 40)
Een individuele gescrapete pagina binnen een `doc`.

| Kolom | Type | Omschrijving |
|---|---|---|
| `id` | uuid | Primary key |
| `created_at` | timestamp | Aanmaakdatum |
| `organisation_id` | uuid → organisation | Gedenormaliseerd voor snelle tenant-queries |
| `doc_id` | uuid → doc | Parent documentatiebron |
| `url` | text | Volledige URL van de pagina |
| `title` | text? | Paginatitel |
| `status` | enum | `active` / `archived` / `error` |
| `scraped_at` | timestamp? | Tijdstip van scrapen |
| `http_status` | int? | HTTP-statuscode bij scrapen |
| `metadata` | json? | Headers, meta-tags, canonical URL, etc. |

### `doc_section` (tabel-id: 41)
Een inhoudschunk (sectie) van een pagina, met vector embedding voor AI-zoeken.

| Kolom | Type | Omschrijving |
|---|---|---|
| `id` | uuid | Primary key |
| `created_at` | timestamp | Aanmaakdatum |
| `organisation_id` | uuid → organisation | Gedenormaliseerd voor snelle tenant-queries |
| `doc_id` | uuid → doc | Gedenormaliseerd voor queries op bronniveau |
| `doc_page_id` | uuid → doc_page | Parent pagina |
| `heading` | text? | Sectiekopregel (h1/h2/h3 tekst) |
| `content` | text | Volledige tekst van deze chunk |
| `section_index` | int? | Volgorde binnen de pagina |
| `keywords` | text[]? | Trefwoorden (GIN full-text index) |
| `embedding` | vector (1536, private) | AI vector embedding voor semantisch zoeken |
| `is_active` | bool | Of deze sectie doorzoekbaar is |
| `token_count` | int? | Geschat aantal tokens (LLM context) |
| `metadata` | json? | HTML-tag, diepte, anchor, etc. |

### Indexen
- `btree(organisation_id)` op alle drie tabellen — tenant-isolatie
- `btree(doc_id)` op `doc_page` en `doc_section` — queries per bron
- `btree(doc_page_id)` op `doc_section` — queries per pagina
- `btree(url)` op `doc_page` — dedup bij ingest
- `gin(keywords)` op `doc_section` — full-text zoeken
- `gin(xdo jsonb_path_op)` op alle drie — JSON-veldqueries

---

## 6. Geplande / Stub Modules

Zichtbaar in navigatie maar nog niet gebouwd:

| Module | Locatie in nav |
|---|---|
| Assistent | Agents |
| Workflows | Automatisering |
| Triggers | Automatisering |
| Documenten & OCR | Automatisering |
| API-sleutels | Integraties |
| Webhooks | Integraties |
| Team management | Mijn organisatie |
| Kennisbank | Mijn organisatie |
| Analytics (placeholder) | Top-level `/analytics` |

---

## 7. Business Rules & SOPs

- Buckets zijn altijd gekoppeld aan één organisatie; cross-organisatie toegang is niet standaard mogelijk
- OCR-verwerking vindt asynchroon plaats na upload
- Agents kunnen alleen data ophalen uit buckets waarvoor ze expliciet toegang hebben
- Dashboard-data combineert live FastAPI-calls (o.a. auth, workspaces, integrations/inbox/e-mail, workforce, custom DB waar geimplementeerd) met mock of UI-only waar nog geen backend is
- Mobiele app en widget communiceren volledig live via FastAPI livechat API (`/api/livechat/`)

---

## 8. Technische Architectuur

- **Backend**: FastAPI (API, database, agents, MCP server, static hosting)
- **Dashboard**: React + TypeScript + Vite + React Router + Tailwind CSS
- **Mobiel**: React Native + Expo Router
- **Widget**: Vanilla JS, geen dependencies, SSE-streaming
- **Auth**: Dashboard gebruikt cookie + memory sessie (`/api/auth/*`), mobiel gebruikt `AsyncStorage`; dashboard `GET /api/auth/me` bevat tenantobject `tenant.id`, `tenant.slug`, `tenant.name` en optioneel logo-URL (genormaliseerd naar `user.tenant.logo`)
- **Tenant canonical key**: `account.slug` (unique) is de vaste tenant identifier voor frontend-logica en feature-scope
- **Workspace 1 tenant-tabellen**: `account` (tabel-id `2`) en `organisation` (tabel-id `6`) bestaan elk één keer en zijn aparte modellen (niet dubbel); `account` bevat account/bedrijfsgegevens, `organisation` bevat tenantconfiguratie zoals livechat- en budgetinstellingen.
- **Workspace 1 tenant-relaties**: het merendeel van domeintabellen verwijst naar `organisation_id` (UUID, tableref `6`), terwijl auth/e-mail nog `account_id` (int, tableref `2`) gebruikt, o.a. `user`, `event_log`, `email_oauth_connection` en `outlook_oauth_state`.
- **Tenant-migratie status (workspace 1)**: `account.organisation_id` en `user.organisation_id` zijn toegevoegd en gevuld voor bestaande records; `event_log.organisation_id` is na een mislukte bulk-backfill weer verwijderd en blijft voorlopig op `account_id` totdat row-id gestuurde backfill wordt gebruikt.
- **Tenant-migratie fase**: de volledige `account`→`organisation` migratie gebeurt momenteel in pre-live; tijdelijke datainconsistentie in migratielogs is acceptabel zolang productie nog niet live staat.
- **Real-time**: Server-Sent Events (SSE) voor streaming AI-antwoorden
- **FastAPI API base**: `https://api.bokito.nl`
  - Dashboard auth: `//api/auth`
  - Widget/Mobiel livechat: `/api/livechat`
  - Bakermat design configurator: `/api:paVSDSqb`

### Frontend API endpoint-opbouw (dashboard SOP)

- De dashboard frontend bouwt FastAPI endpoints op via `VITE_BOKITO_API_URL` + `VITE_API_GROUP_*` + endpoint path.
- De centrale opbouw staat in `apps/dashboard/src/lib/api.config.ts`; featurecode hergebruikt deze bases.
- Integratie- en e-mailroutes lopen via canonical `/api/integrations`; frontend gebruikt hiervoor `VITE_API_GROUP_INTEGRATIONS` en `INTEGRATIONS_API_BASE`.
- API group variabelen zijn standaard aanwezig in `apps/dashboard/.env.example` en blijven leidend voor nieuwe API-integraties.
- Endpoint paths blijven feature-specifiek en worden lokaal toegevoegd op een gedeelde base.
- `VITE_*` variabelen bevatten geen secrets; Vite verwerkt deze waarden build-time in de frontend bundle.
- Hardcoded volledige API origins in pagina’s/components gelden als afwijking van de standaard en worden bij refactors verwijderd.

### Björn Lundén — native integratie (BLA API, 2026-08)

- **Implementatie:** Björn Lundén is een **native FastAPI-integratie** (`apps/api/app/services/bjorn_lunden.py`) — geen Xano, geen extern MCP-proces. `install_mcp` van provider `bjorn_lunden_mcp` default naar de sentinel-server-URL **`native://bjorn-lunden`**; de env `BJORN_LUNDEN_MCP_URL` blijft optioneel voor een expliciet extern MCP-endpoint (leeg = native).
- **Auth-model:** OAuth2 client-credentials — Basic-auth `POST https://apigateway.blinfo.se/auth/oauth/v2/oauth-token` levert een Bearer-token; datacalls gaan naar `https://apigateway.blinfo.se/bla-api/v1/sp` met `Authorization: Bearer` + header **`User-Key`** (company GUID per administratie).
- **Credentials-velden:** connect-dialog (`McpConnectionForm`) stuurt een `auth`-object met `client_id`, `client_secret` en `user_key` (company key); locale keys `bjornClientId`/`bjornClientSecret`/`bjornCompanyKey` in `nav.json` (EN + NL). Credentials zijn optioneel bij install.
- **Toolcatalogus:** `BL_NATIVE_TOOLS` — company (`list_companies`, `get_company_details`), klanten/leveranciers (`search_customers`, `get_customer`, `list_suppliers`, `get_supplier`), facturen (`list_invoices`, `get_invoice`, `list_supplier_invoices`), grootboek (`list_ledger_entries`, `list_accounts`, `get_account_balance`). `list_vat_reports` bestaat alleen in de dev-sandboxcatalogus (geen bevestigd BLA-endpoint).
- **Gedrag zonder credentials:** `test_mcp_server` rapporteert `note=credentials_pending` en persist de toolcatalogus (install werkt in prod zonder 422). `call_mcp_tool` op `native://`: dev zonder creds → sandbox-mock; **prod zonder creds → duidelijke foutmelding** ("add credentials") in plaats van een stille failure; met creds → live BLA-call.
- **Tests:** `apps/api/tests/test_bjorn_lunden_native.py` (10 tests) + `test_accountancy_readiness.py` (native toolset-asserties).

### Livechat: legacy Claude-router vs native FastAPI-agent (dual pipeline)

Livechat ondersteunt **twee server-side pipelines** naast elkaar. Clients blijven standaard dezelfde URLs aanroepen; FastAPI kiest intern de pipeline **per agent** (aanbevolen), of je exposeert een **tweede POST-route** en stuurt overrides mee in `agent_config`.

**Aanbevolen (één endpoint, branch in FastAPI):** `POST /api/livechat/stream-chat` (en zo nodig `stream-chat-continue`) blijft het contract. In de function stack: als `chat_pipeline === "bokito_native"`, run de ingebouwde **FastAPI AI Agent** (zelfde message-persist en SSE-output als legacy); anders ongewijzigde legacy-flow (Claude/router).

**Alternatief (tweede route):** bv. `POST /api/livechat/stream-chat-native` met identiek request body en **hetzelfde SSE-formaat** als `stream-chat`. Zet dan in `agent_config`:

| Veld | Type | Betekenis |
|------|------|-----------|
| `chat_pipeline` | `"legacy"` \| `"bokito_native"` | Documentatie/telemetrie; clients gebruiken het vooral informatief. Standaard: `legacy` of weglaten. |
| `platform_agent_id` | string (optioneel) | Verwijzing naar de FastAPI AI Agent die de native tak moet runnen (id/canonical naar keuze van jullie FastAPI-model). |
| `stream_chat_path` | string (optioneel) | Path-segment onder `/api/livechat/` voor de eerste SSE POST. Alleen `[a-zA-Z0-9_-]{1,64}`. Default: `stream-chat`. |
| `stream_chat_continue_path` | string (optioneel) | Zelfde regels; default: `stream-chat-continue`. |
| `transcribe_path` | string (optioneel) | Path-segment onder `/api/livechat/` voor spraak-transcriptie (`POST`). Alleen `[a-zA-Z0-9_-]{1,64}`. Default: `transcribe`. |

**`session/start`:** breid het bestaande `agent_config`-object uit met bovenstaande velden (backward compatible: geen velden = legacy + defaults).

**SSE-contract (ongewijzigd):** clients verwachten o.a. `{ "t": "..." }` chunks, `{ "type": "title", ... }`, `{ "type": "page_context_needed", ... }`, `{ "type": "done", "content": "...", "id": ... }`. De **native tak** moet dezelfde events emittersen (of `page_context_needed` **niet** sturen als die stap daar niet bestaat — anders blijft de client wachten op `stream-chat-continue`).

**Incrementele UI-streaming:** Widget en mobiel **renderen elke `t`-chunk live** (widget: `textContent` tijdens de stream, daarna markdown bij `done`; mobiel: `parseSseStream` `onDelta` + tijdelijk AI-bericht met status `processing`, daarna `sent`). Voor zichtbare woord-voor-woord streaming moet de backend **meerdere** `t`-events emitten (FastAPI agent streaming forwarden of response in segmenten knippen). **Client-side smoothing:** als er géén `t`-events waren en alleen `done` met `content`, knipt de widget de tekst in stukjes en toont die met korte delays (`#sseMaybeSimulateClientChunks`); uitschakelbaar met `data-client-simulate-stream="false"` of query `bk_sse_smooth=0` bij auto-mount. Mobiel: zelfde idee na `parseSseStream` wanneer `hadTokenEvents` false (`splitTextForClientSim` + `onDelta`).

**Repo-clients:** de gebouwde widget (`npm run build` in `apps/chat-widget`, uitvoer `dist/bokito-chat.js`; bron [`apps/chat-widget/src/widget-main.ts`](apps/chat-widget/src/widget-main.ts)) en de mobiele app ([`apps/mobile/src/context/ChatContext.tsx`](apps/mobile/src/context/ChatContext.tsx) + [`parseSseStream` / `livechatStreamPaths`](apps/mobile/src/api/streamChat.ts)) gebruiken `stream_chat_path` / `stream_chat_continue_path` wanneer FastAPI die zet.

**FastAPI-implementatiechecklist (handmatig in workspace):**

1. **Agent-tabel of config:** kolom/JSON `chat_pipeline`, optioneel `platform_agent_id` (of vaste agent per slug).
2. **`session/start`:** merge deze waarden in `agent_config`.
3. **`stream-chat`:** `if chat_pipeline == bokito_native` → laad conversatie + berichten, append user message, **Run AI Agent** met history, sla assistent-bericht op, stream SSE met **incrementele** `t`-chunks zodra het model tekst produceert, afsluiten met `done`; `else` → bestaande stack.
4. **`stream-chat-continue`:** alleen relevant voor legacy `page_context_needed`; native tak kan dezelfde handler laten of een no-op die direct `done` stuurt als je ooit per ongeluk continue aanroept.
5. **Realtime / tool-stappen (pariteit, optioneel):** de widget luistert naar `tool_started`, `tool_completed`, `tool_error` op het conversation-kanaal ([`#handleRealtimeEvent`](apps/chat-widget/src/widget-main.ts)). Als de native agent tools uitvoert, emitteer dezelfde `event_type` + `object` als legacy zodat “thinking steps” zichtbaar blijven; anders blijft alleen de denk-indicator zonder substappen.

**Testen:** gebruik een **aparte `agent_slug`** (bijv. `demo-native`) met `chat_pipeline: "bokito_native"` zodat productie-slugs op legacy blijven. Vergelijk gedrag met [`apps/chat-widget/chat-standalone.html`](apps/chat-widget/chat-standalone.html) en de mobiele app.

**Verschil met Bakermat:** Bakermat-chat gebruikt `POST /api:paVSDSqb/chat` en een aparte flow; livechat blijft op `/api/livechat` met het hierboven beschreven SSE-contract.

### Livechat: spraak transcriptie (`transcribe` + faster-whisper)

**faster-whisper draait niet in de FastAPI-runtime.** De repo bevat een aparte **ASR-worker**: [`apps/asr-service/`](apps/asr-service/) (FastAPI + [faster-whisper](https://github.com/SYSTRAN/faster-whisper)). FastAPI exposeert `POST /api/livechat/transcribe` (of een override via `agent_config.transcribe_path`) en proxy’t de audio naar die worker met een gedeeld geheim.

**Widget:** [`apps/chat-widget/src/widget-main.ts`](apps/chat-widget/src/widget-main.ts) uploadt na bevestigen van de opname een **webm**-blob als multipart (`audio`), met form fields `session_token` en `language`, en header `Authorization: Bearer <session_token>`. Als de server geen bruikbare `text` teruggeeft, valt de client terug op de **Web Speech API**-tekst (indien beschikbaar). Sinds cycle 6 is spraak **opt-in**: de micknop verschijnt alleen wanneer `agent_config.transcribe_path` expliciet gezet is; de kern-livechat-API heeft geen transcribe-endpoint.

**Workspace environment variables (FastAPI):**

| Variable | Gebruik |
|----------|---------|
| `BOKITO_ASR_URL` | Volledige URL van de worker, eindigend op `/transcribe` (bijv. `https://asr.jouwdomein.nl/transcribe`). |
| `BOKITO_ASR_API_KEY` | Zelfde waarde als `ASR_API_KEY` op de ASR-service. |

**FastAPI: `POST /api/livechat/transcribe` bouwen (function stack):**

1. Valideer de livechat-sessie op dezelfde manier als bij `POST /api/livechat/attachment` (Bearer-token en/of form field `session_token`).
2. **External API request:** `POST` naar `BOKITO_ASR_URL`, header `X-API-Key: <BOKITO_ASR_API_KEY>`, body **multipart/form-data** met bestandsveld `audio` = het geüploade bestand van de client; optioneel form field `language` doorgeven.
3. Response van de worker is JSON (`text`, `language`, …). Stuur minimaal `{ "text": "<transcript>" }` terug naar de widget.
4. Zet de time-out op de external request hoog genoeg voor model-inferentie (CPU kan tientallen seconden duren).
5. Map 413/4xx van de worker naar passende clientfouten waar nodig.

---

## 8b. Bakermat Design Configurator

Bakermat is een partner-facing React app (`apps/bakermat/`) waarmee klanten van partners hun trailer/stand laten ontwerpen met hun huisstijl via een AI-gestuurde flow.

### Architectuur
- **Frontend**: React + TypeScript + Vite + Tailwind + Framer Motion
- **AI Chat**: Aangestuurd door FastAPI Agent "Bakermat Design Assistant" (canonical: `xnB1Q5od`, platform-free provider)
- **API**: FastAPI API group `bakermat` (canonical: `paVSDSqb`) met `POST /chat` endpoint
- **Realtime**: Hergebruikt het bestaande `conversation` realtime channel (`conversation/{sessionId}`) voor push-based berichten
- **Image Generation**: Client-side via OpenAI DALL-E 3 (tijdelijk; wordt later een FastAPI tool)

### Flow
1. Welkom → Vragen (bedrijf, sector, stijl, kleur) → Trailer selectie → Merk-input (URL + logo) → AI Design chat → Eindontwerp
2. In de AI Design stap: split-screen met 3 image slots (links) en AI chat (rechts)
3. Chat stuurt berichten via `POST /api:paVSDSqb/chat` naar de FastAPI agent
4. Agent geeft `[GENEREER_ONTWERPEN]` trigger mee wanneer designs gegenereerd moeten worden
5. Frontend parseert de trigger en start client-side image generation

### FastAPI Backend
- **Agent**: "Bakermat Design Assistant" — platform-free model, Nederlandse system prompt, dynamische context via `$args` (bedrijfsnaam, sector, stijl, kleursfeer, trailer, website)
- **Tool**: `BM_GET_WEAGON_DESIGNS` (leeg, nog te implementeren voor server-side image generation)
- **Endpoint**: `POST /api:paVSDSqb/chat` — ontvangt session_id + messages + context, runt de agent, broadcast via realtime

### Bakermat Operations (BM_ -> custom_db migratie)
- De operationele Bakermat-data (`BM_jobs`, `BM_job_phases`, `BM_products`, `BM_calendar_events`, `BM_customers`) wordt gemigreerd naar de no-code meta-tabellen (`custom_table`, `custom_field`, `custom_record`, `custom_view`) in workspace `1`.
- Voor Bakermat gebruikt `custom_table.organisation_id` de tenant/account-id `4` (`bakermat-design`) als scope voor de custom tabellen.
- Doeltabel-slugs voor de operatie-UI: `bm_jobs`, `bm_job_phases`, `bm_products`, `bm_calendar_events`, `bm_customers`.
- De operationspagina `apps/bakermat/operatie.html` gebruikt nu direct de generieke custom DB API (`/api:vLUpKLJh`) in plaats van de legacy Bakermat CRUD-routes (`/api:paVSDSqb/jobs|products|phases|calendar`).
- De operatie-UI verwacht een geldige dashboard access token in runtime memory; token-resolutie loopt via de centrale auth provider (geen `localStorage` dependency).
- Migratiescript: `scripts/migrate-bakermat-bm-to-custom-db.mjs` ondersteunt idempotente upsert op `bm_legacy_id` plus `--dry-run`.
- Legacy bron-tabellen met prefix `BM_` in workspace `1` zijn verwijderd na migratie; operationele data voor Bakermat staat nu uitsluitend in tenant-scoped custom tabellen (`organisation_id = 4`).

### Static hosting (deploy)

Portal + widget deploy via VPS/Caddy (zie `README.md` en `docs/phase-0-infrastructure.md`). Geen externe static-host metadata-API meer in deze repo.

---

## 9. No-Code Database Builder

Het platform biedt tenants een no-code database builder (`/database`) waarmee ze zelf tabellen, velden en records aanmaken en beheren, vergelijkbaar met Airtable.

### Architectuur

Meta-schema benadering met 4 vaste FastAPI-tabellen:

| Tabel | FastAPI ID | Doel |
|---|---|---|
| `custom_table` | 45 | Tabeldefinities per organisatie |
| `custom_field` | 46 | Velddefinities per tabel (14 field types) |
| `custom_record` | 47 | Data-rijen met JSON `data` kolom |
| `custom_view` | 48 | Viewconfiguraties per tabel |

### Field Types

text, number, boolean, date, email, url, phone, select, multi_select, file, currency, rating, relation, formula. Configuratie per type opgeslagen in `config` JSON kolom (bijv. select-opties, valutasymbool, rating max).

### Views

- **Grid** — spreadsheet met inline editing, sorteren, paginatie
- **Kanban** — drag & drop board gegroepeerd op select-veld
- **Calendar** — maandweergave op basis van datumveld
- Grid ondersteunt kolom-resize door de headergrens te slepen; kolombreedtes worden per view opgeslagen in `custom_view.config.columnWidths`.
- Tijdens resize worden kolombreedtes debounced naar de server opgeslagen, plus direct op drag-end voor hogere betrouwbaarheid.
- Grid gebruikt een vaste `colgroup` kolombreedtebron zodat het verbreden van 1 kolom andere kolommen niet proportioneel herschaalt.
- Bij verbreden groeit de tabelcanvas naar rechts (`w-max` + horizontale scroll) en kan de gebruiker verder naar rechts scrollen zoals in SmartSuite.
- Utilitykolommen blijven vast: selectie-kolom 36px, index `#` 40px (en actiekolom 40px).

### API

FastAPI API-groep `custom_db` (id: 9, canonical: `vLUpKLJh`) met volledige CRUD endpoints voor tabellen, velden, records en views. Alle endpoints vereisen JWT-authenticatie en filteren op tenant via `organisation_id`.

- Optioneel: `GET /standard-tables` en `POST /standard-tables/create` voor het eenmalig aanmaken van standaardtabellen (`is_standard`). Ontbreken deze routes (404 / “Unable to locate request”), dan initialiseert de dashboard-databasepagina zonder die bootstrap en zonder herhaalde retries; custom tabellen blijven werken via `custom-tables`.

### Frontend

- Route: `/database` en `/database/:tableSlug`
- Sidebar-item "Database" met `Database` icon
- `DatabaseContext` provider voor state management
- `/database/*` gebruikt een dedicated `DatabaseLayout` zodat de `DatabaseContext` zowel de linker section-sidebar als de inhoudspagina voedt.
- Componenten: `TableListSidebar`, `CreateTableDialog`, `FieldEditor`, `FieldTypeSelector`, `FieldConfigPanel`, `ViewTabs`, `GridView`, `KanbanView`, `CalendarView`, `CellRenderer`, `CellEditor`
- Dependencies: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (kanban drag & drop)
- Klikken op de `{x} velden` knop opent een dedicated modal voor field management in plaats van een inline paneel.
- Field creation gebruikt backend slug-collision beveiliging om duplicate fouten bij meerdere velden te voorkomen.
- Tabellen worden voor `/database` in de linker section-sidebar getoond in 2 groepen: `System tables` (`is_standard = true`) en `Custom tables` (`is_standard != true`).
- Nieuwe tabellen worden aangemaakt via een `+` knop in de group-header van `Custom tables` (niet meer via de bovenste tabel-header).
- Tabelselectie loopt via de linker sidebar en navigeert naar `/database/:tableSlug`; de tabeldata wordt in het rechter inhoudspaneel geladen.
- Reorder van view-tabs is strikt horizontaal; verticale drag-offset wordt genegeerd zodat tabs niet naar beneden kunnen verspringen tijdens slepen.
- De pagina gebruikt een single-header layout (geen dubbele titelbalk onder de tabs).
- Grid ondersteunt inline record-aanmaak via een vaste invoerregel onder de laatste rij, inclusief lege tabel-state direct onder de header.
- Grid heeft multiselect met checkbox-kolom links naast `#`, inclusief "select all" in de tabelheader.
- Inline create-cellen ondersteunen `Enter` om direct op te slaan/toe te voegen zonder op het plus-icoon te klikken.
- De `{x} velden` actie staat in de bovenste tabel-headerregel met de view-tabs (`Grid View`, etc.) en opent een field-management modal.
- Veldkolom-headercellen tonen bij hover rechts een tandwiel-icoon voor directe veldinstellingen (naam, required, type-config, verwijderen).
- In de field-management popup kunnen velden via drag-and-drop worden herordend; de nieuwe volgorde wordt direct server-side opgeslagen via `custom_field.position`.
- Impactvolle verwijderacties in databasebeheer vragen expliciete type-bevestiging: gebruiker moet de naam van het item exact typen voordat verwijderen actief wordt (o.a. tabel verwijderen en veld verwijderen).
- Nieuwe records worden onderaan toegevoegd (ascending op `created_at`) zodat de invoerflow logisch van boven naar beneden blijft.
- Kolom-resize handles in de header zijn standaard visueel verborgen en worden pas zichtbaar bij hover (geen permanente kleine streepjes in de headercellen).
- Bij selectie van een of meerdere records verschijnt onderaan een sticky bulk-toolbox in de footer met acties (deselecteren, geselecteerde records verwijderen).
- Select- en multi-select cel-popups sluiten direct na keuze; popup-interactie is afgeschermd van cel-click bubbling zodat de editor niet onbedoeld heropent.
- Tabelcreatie (`POST /custom-tables`) gebruikt collision-safe slugs (timestamp suffix) om duplicate record errors bij een tweede tabel te voorkomen; frontend heeft extra retry-fallback op duplicate meldingen.

### Seeddata tenant `bourgondienadvies` (custom database)

De Bourgondiënadvies tenant (account_id=6, organisation_id=6) heeft 5 voorgedefinieerde custom tabellen met realistische accountancy-data:

| Tabel | custom_table id | Icon | Records | Beschrijving |
|---|---|---|---|---|
| Klanten | 13 | Users | 6 | Zakelijke relaties (Bakkerij Goudkrust, Timmerbedrijf Vos B.V., Bloemen van Soest, Fietsenwinkel De Pedaal, Slagerij Jansen, Restaurant De Gouden Leeuw) |
| Facturen | 14 | FileText | 10 | Inkomende en uitgaande facturen met bedragen, BTW, status |
| Boekingen | 15 | BookOpen | 8 | Grootboekboekingen Q1 2026 (omzet, huur, loon, afschrijving, inkoop) |
| BTW-aangiften | 16 | Calculator | 8 | Q1 2026 (concept) + Q4 2025 (ingediend/goedgekeurd) per klant |
| Jaarwerk | 17 | Briefcase | 11 | Jaarrekeningen, IB/VPB-aangiften, publicatiestukken boekjaar 2025 |

Field slugs volgen het patroon `field_{tableId}_{veldnaam_slug}` (bijv. `field_13_bedrijfsnaam`, `field_14_status`). Elke tabel heeft een standaard Grid View.

---

## 10. AI-Powered Multichannel Inbox (PRD V1.1)

Uitbreiding van het platform met een volledige multichannel inbox, AI-communicatie assistent en knowledge base. Vergelijkbaar met Intercom/Missive maar geintegreerd in het Bokito no-code platform.

### 10.1 Email Integratie & Kanaal Infrastructuur (PRD sectie 10)
- OAuth2 koppeling voor Microsoft Outlook (Graph API) en Google Gmail (Gmail API)
- Per workspace meerdere mailboxen (support@, sales@, persoonlijk)
- Bidirectionele email sync: inkomend ophalen (polling 60s) + uitgaand verzenden via provider API
- Email threading op basis van In-Reply-To/References headers en thread_id
- Attachment handling: inline images + bijlagen in FastAPI file storage (max 25MB)
- Token management: AES-256 encrypted, auto-refresh, health indicator (verbonden/fout/verlopen)
- HTML signature management per mailbox
- Mailbox routing rules: auto-assign op basis van afzenderdomein, onderwerp, of mailbox
- Nieuwe tabellen: `mailbox_connection`, `inbox_routing_rule`
- Uitbreiding Bericht-tabel met: mailbox_id, provider_message_id, in_reply_to, cc, bcc, attachments, conversation_status, snoozed_until, assigned_to, labels, ai_summary, sentiment

### 10.2 Inbox UI & Conversatiebeheer (PRD sectie 11)
- Drie-paneel layout: mailboxen/labels (links) | conversatielijst (midden) | conversatiedetail (rechts)
- Conversatiestatus: Open / Snoozed / Gesloten met keyboard shortcuts
- Snooze met timer (1u/3u/morgen/volgende week/custom)
- Toewijzen aan teamlid, labels, canned responses met variabelen
- Rich text composer: reply/forward/internal note tabs, CC/BCC, auto-signature
- Klant-sidebar: contactgegevens, eerdere conversaties, gekoppelde records
- Interne notities (gele achtergrond, alleen zichtbaar voor team)
- Zoeken + bulk acties + volledige keyboard navigatie
- Thread detail venster heeft één vaste fade overlay aan de bovenzijde (gradient naar `--color-bg`, light/dark aware) zodat berichten visueel vervagen wanneer ze naar boven uit beeld scrollen; dag- en tijdpillen blijven crisp bovenop de fade via z-index
- Bij hover op de afzender-favicon in de conversatie verschijnt een popover (Radix Tooltip stijl) met naam, e-mail en telefoonnummer (alleen rijen die gevuld zijn); telefoonnummer komt uit `contact_phone` op de thread record (optioneel, leeg als niet beschikbaar)
- Inbox URL-routing is deelbaar en deep-link bestendig (Linear/Front patroon):
  - Canonical paths: `/messages/:queue` or `/messages/:queue/t/:threadId`; channel: `/messages/ch/:channelId/:queue` (legacy `/support/inbox/*` redirects preserve query string)
  - `:queue` is een van `all`, `my`, `unassigned`, `pending`, `closed`, `spam`, `out`
  - Geselecteerde thread is afgeleid van de URL (geen React state), dus klikken op een andere folder/mailbox in de sidebar maakt het detail-pane automatisch leeg
  - Bij een stale URL (bv. een gedeelde link naar een thread die intussen `gesloten` is terwijl de URL `/all` zegt) doet de app **eenmalig** een stille `navigate(..., { replace: true })` naar de canonieke queue van de huidige thread state. Deze one-shot redirect is gekoppeld aan de `threadId` uit de URL: zodra die geëvalueerd is wordt dezelfde thread in deze sessie niet opnieuw geredirect, zelfs niet als de status verandert via een patch in het thread-scherm. Geen banner of toast. Mapping:
    - status `closed` → `/closed`
    - status `spam` → `/spam`
    - status `pending` → `/pending`
    - status `open` → `/all`
  - Bij channel-mismatch (URL `/ch/1` maar thread hoort bij connection 2) wordt het channel-segment gedropt en valt de URL terug op de globale queue.
  - Patch / reply / interne notitie vanuit het thread-scherm laat de URL ongemoeid; in plaats daarvan wordt de threads-lijst direct ververst zodat de thread uit de huidige queue verdwijnt als hij niet meer matcht. Detail-pane blijft de thread gewoon tonen totdat de gebruiker zelf wegklikt.
  - Bij openen of wisselen van queue/mailbox **zonder** `/t/:threadId` in de URL selecteert `Communication.tsx` automatisch de meest recente thread (eerste rij) zodra `useThreads` de lijst voor die queue heeft geladen (`threadsReady`). Deep links (`/support/inbox/all/t/85`) en canonieke queue-redirects worden niet overschreven. Bij queue-wissel wist `useThreads` stale rijen uit de vorige map direct (`useLayoutEffect`) zodat auto-select nooit een open thread uit "Alle kanalen" kiest terwijl "Gesloten" laadt.
- **Unified Messages hub (bokito, 2026-06):** Rail **Messages** (`/messages`) toont één gecombineerde thread-lijst voor alle kanalen (extern e-mail + intern agent), zonder External/Internal-segment of `?folder=`. Eén queue-set in `InboxSidebarNav` (Awaiting decision, Open, Mine, Unassigned, Updates, Results, Pinned, More → Pending/Closed) plus mailbox-kanalen; optioneel `?project_id=` voor project-scoped threads. `messagesHubPath({ queue, projectId })` (geen `folder` meer); badges in `NavBadgeContext` tellen over de unified lijst. Legacy `/os/communication` en `/project/:id/communication` redirecten naar Messages hub. Agent decisions zijn `SignalMessage` met `kind=decision_request` in dezelfde thread UI (geen aparte Decisions-tab meer).
- **Thread rechterpaneel = AgentThreadPanel (AI-only, 2026-06):** In thread-detail vervangt `AgentThreadPanel` de oude `ContactPanel` (verwijderd). Het toont de orchestrator-agent van het gekoppelde project (`thread.projectId` → project → `po_agent`, link naar `/os/agents/:id`), het project (link naar hub) en de actieve `AgentTask` (`OrchestrationPanel`, verplaatst uit de thread-body). Geen contactgegevens of trigger-CTA. Fallback bij geen project/orchestrator: "No orchestrator linked to this thread's project." Toggle via `PanelRight` in de header (voorkeur in `localStorage` `inbox.contactPanel.open`).
- Contact context panel (rechterzijde van thread detail, modern tools-stijl):
  - Toggle via `PanelRight` icoonknop in de thread-detail header (rechts naast refresh); voorkeur (open/dicht) wordt persistent opgeslagen in `localStorage` onder `inbox.contactPanel.open`
  - Component: `apps/dashboard/src/components/inbox/ContactPanel.tsx`, gerenderd als derde kolom in `Communication.tsx` naast `ThreadList` en `ThreadDetail`
  - Vaste breedte `w-72`, `border-l border-border/50 bg-bg-surface`, scrollable body
  - Bovenin: contact-card met avatar (initials + deterministische kleur uit `getAvatarColor`, plus domain-favicon badge rechtsonder via `getDomainFaviconUrl`), naam, e-mailadres, en quick-action knoppen "Mail" (mailto:) en "Bellen" (tel:)
  - Sectie "Contactgegevens": e-mail en telefoon met klikbare links
  - Sectie "Thread": status (gekleurde dot + label), prioriteit, mailbox (display name uit `useMailboxConnections`), aanmaakdatum (lange notatie nl-NL), laatste bericht (relatieve tijd), toegewezen aan (uit `listInboxMembers`)
  - Placeholder secties "Eerdere threads" en "Taken" met label "Binnenkort" — voorbereid op toekomstige `contact` entiteit (uniek per tenant op e-mail of secundair telefoonnummer) waarin oudere threads, taken en andere context aan een contact gekoppeld worden
  - Geen emoji's; uitsluitend Lucide icons (`Mail`, `Phone`, `Calendar`, `Clock`, `Hash`, `Inbox`, `PanelRight`, `X`, `ChevronRight`)
- Read/unread tracking op thread-niveau (Linear/Intercom/HelpScout patroon):
  - Thread record heeft `has_unread` boolean (team-wide). De inbox lijst toont een accentdot links van de afzender wanneer `has_unread = true`.
  - Bij klikken op een thread in de lijst gaat de dot meteen weg (optimistic via `setThreadReadState(id, false)` in `useThreads`); de detail hook (`useThreadDetail`) doet vervolgens silent een `PATCH /inbox/threads/{id}/mark-read` en zet `detail.thread.hasUnread = false` lokaal. Falen wordt opgeruimd door de 30s poll.
  - Endpoints zijn auth-required en organisatie-scoped:
    - `PATCH //api/integrations/inbox/threads/{thread_id}/mark-read` (id 232)
    - `PATCH //api/integrations/inbox/threads/{thread_id}/mark-unread` (id 233)
- Thread verwijderen (permanent, organisatie-scoped):
  - `DELETE //api/integrations/inbox/threads/{thread_id}` (id 292) verwijdert de thread plus gekoppelde `inbox_message`, `inbox_event` en `inbox_thread_pin` rijen.
  - Dashboard UI: prullenbak-icoon in de thread-header (naast sluiten/heropenen) en prullenbak op hover in de threadlijst. Beide vragen een bevestiging via `window.confirm`; na succes verdwijnt de thread uit de lijst en navigeert de detail-view terug naar de queue zonder thread-id.
- Pin systeem op thread-niveau (per-user, Slack/Notion patroon):
  - Aparte tabel `inbox_thread_pin` (id 79) met unique index op `(user_id, thread_id)`. Pin state is per-user; collega's zien hun eigen pins.
  - Endpoints zijn idempotent en auth-required:
    - `POST //api/integrations/inbox/threads/{thread_id}/pin` (id 234)
    - `DELETE //api/integrations/inbox/threads/{thread_id}/pin` (id 235)
    - `GET //api/integrations/inbox/pins` (id 236) - returnt `{ thread_ids: number[] }` voor de huidige user (organisatie-scoped). Dashboard gebruikt deze lijst voor client-side decoratie.
  - **Architectuur**: pin-decoratie en sortering gebeuren CLIENT-SIDE in de dashboard (hook `usePinnedIds` + `useThreads` + `useThreadDetail`). De FastAPI endpoints `GET /inbox/threads` (id 223) en `GET /inbox/threads/{id}` (id 224) bevatten GEEN `is_pinned` veld in hun response - dat field wordt op de frontend toegevoegd door de set van pinned thread ids te joinen met de fetched threads.
    - Reden: een eerdere implementatie deed de decoratie server-side via inline `|map:|set:|in:` filter-expressies, maar dat trigger FastAPI runtime errors ("1st operand must be one of these types: text, bool") wanneer `$pinned_ids` leeg was. Coercion met `|to_bool` of refactor naar `array.map`/`array.filter` statements loste het niet betrouwbaar op. Client-side join is robuuster, simpler en performant op moderate listsizes.
  - `view=pinned` blijft wel server-side: `GET /inbox/threads?view=pinned` (id 223) haalt eerst de pinned thread ids op uit `inbox_thread_pin` voor de huidige user, walks daarna elke id af met `db.get inbox_thread` in een `foreach`-lus en pusht gevonden rijen in een items-array (gefilterd op `organisation_id`). De response volgt dezelfde paged shape als de andere views (`{items, itemsTotal, curPage, ...}`). Joins en array-IN where-clausules zijn beide vermeden — zie FastAPI-valkuilen 3 en 4.
  - **FastAPI-valkuil 1**: alle endpoints die `inbox_thread_pin` queryen (223 view=pinned, 234, 235, 236) zetten `$auth.id|to_int` eerst in een `$user_id` variabele. Dezelfde piped-expressie inline in een `db.query` `where` clausule (`$db.inbox_thread_pin.user_id == ($auth.id|to_int)`) triggert een runtime error `"1st operand must be one of these types: text, bool"` ondanks dat `$auth.id|to_int` perfect werkt in `db.get user`'s `field_value`. Vermoedelijke bug in deze specifieke combo van filter-expressie + tableref-veld.
  - **FastAPI-valkuil 2**: de `|map:$$.field` filter-vorm returnt `null` per element op deze workspace, ook als de bron-array gevulde rijen bevat. Workaround: gebruik de `array.map` statement (met `$this`) i.p.v. de `|map:` filter:
    ```xs
    array.map ($rows) {
      by = $this.thread_id
    } as $thread_ids
    ```
    Toegepast op endpoint 236 en de `view=pinned` branch in endpoint 223.
  - **FastAPI-valkuil 3**: joins met `inbox_thread_pin` (`$db.inbox_thread_pin.X` referenties in een `join.where`) gaven `"Unsupported parameter reference - inbox_thread_pin.thread_id"`. Workaround: vermijd joins voor deze tabel; doe een aparte `db.query` voor de pin-rijen en koppel daarna in een tweede stap.
  - **Query pitfall (historical):** large IN-filters should use explicit loops or SQLAlchemy `in_()` in FastAPI rather than brittle legacy filter DSL.
  - Sortering: pinned items worden in `useThreads` naar de top gesorteerd (binnen de huidige page), daarna op `lastMessageAt DESC`.
  - Sidebar heeft onder "Alle kanalen" een nieuwe entry "Gepind" (Lucide `Pin` icon).
  - ThreadDetail header heeft een eigen pin/unpin button (`Pin`/`PinOff` icon, accent kleur wanneer gepind). Toggle delegeert naar dezelfde optimistic flow als de list dropdown via `addPin`/`removePin` op de gedeelde `usePinnedIds` state.
- Thread indicator dropdown menu (links van afzendernaam):
  - Geïmplementeerd in [`apps/dashboard/src/components/inbox/ThreadIndicatorMenu.tsx`](apps/dashboard/src/components/inbox/ThreadIndicatorMenu.tsx) op basis van Radix `DropdownMenu`.
  - Visueel: gepind = roterende `Pin` icon (accent), ongelezen = gevulde accent dot, anders transparante placeholder.
  - Hover op de thread-rij toont een subtiele ring rond de indicator (`group-hover/thread:ring-1`) zodat duidelijk is dat de indicator klikbaar is. Klik opent dropdown met contextuele items: "Markeer als gelezen / ongelezen" + "Pinnen / Losmaken".
  - Klik op de indicator selecteert NIET de thread (`stopPropagation`); klik elders op de rij doet dat wel. Optimistic updates met rollback worden afgehandeld in `Communication.tsx` (`handleListMarkRead`, `handleListMarkUnread`, `handleListTogglePin`).
- Thread detail error feedback:
  - Wanneer `GET /inbox/threads/{id}` faalt (bijv. backend 4xx/5xx), toont `ThreadDetail` een expliciet error state met `AlertCircle` icoon, het thread id, de error message en een "Opnieuw proberen" button die `refresh` (refetch) triggert. Dit voorkomt het oude gedrag waarbij een failure stilletjes terugviel naar de "Selecteer een thread" placeholder waardoor backend issues onzichtbaar bleven.

### 10.3 AI Communicatie Assistent (PRD sectie 12)
- Semi-autonome modus: confidence > drempel (0.85 default) = auto-reply, anders suggestie
- AI-suggesties als paars blok boven composer met Gebruik/Bewerk/Negeer knoppen
- AI-acties: taak aanmaken, klantrecord updaten, info opzoeken, label toewijzen
- Conversatie-samenvatting (auto bij >5 berichten)
- Sentiment-analyse: Positief/Neutraal/Negatief/Urgent per bericht
- Slimme categorisering en routering
- AI-instellingen per mailbox: tone, taal, knowledge sources, drempel
- Nieuwe tabel: `ai_inbox_config`

### 10.4 Knowledge Base & Document Indexering (PRD sectie 13)
- Document uploads: PDF/DOCX/TXT/MD/CSV, auto-chunked en embedded
- Document collecties koppelbaar aan mailboxen voor gerichte AI-context
- Database-tabellen als kennisbron via Magic Table
- RAG pipeline: conversatiehistorie + klantgegevens + knowledge base (top-K=10) + Magic Tables (top-K=5)
- Citaties in AI-antwoorden met klikbare voetnoten naar brondocument/record
- Nieuwe tabellen: `kb_document`, `kb_collection`

### 10.5 Benodigde Credentials & Environment Variables

| Variable | Status | Waarde/Omschrijving |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ✅ aanwezig in FastAPI | Google Cloud Console OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ aanwezig in FastAPI | Google Cloud Console OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | ✅ aanwezig in FastAPI | `https://api.bokito.nl/api:_kH3DnKo/oauth/google/callback` |
| `MICROSOFT_CLIENT_ID` | ⏳ nog regelen | Azure AD App Registration Client ID (wacht op tenant) |
| `MICROSOFT_CLIENT_SECRET` | ⏳ nog regelen | Azure AD App Registration Client Secret |
| `MICROSOFT_REDIRECT_URI` | ⏳ nog regelen | `https://api.bokito.nl/api:_kH3DnKo/oauth/microsoft/callback` |
| `OPENAI_API_KEY` | ✅ reeds aanwezig | Embeddings + AI-suggesties (Batch 11 + 12) |

Google OAuth is klaar voor Batch 9. Microsoft OAuth nog te regelen via Azure (wacht op M365 developer tenant of gratis Azure-account).

### 10.6 Implementatiestatus april 2026 (dashboard + FastAPI)

- FastAPI `Authentication` API-groep bevat nu inbox endpoints voor:
  - `GET /email/messages`
  - `GET /email/messages/{message_id}`
  - `PATCH /email/messages/{message_id}`
  - `PATCH /email/messages/{message_id}/snooze`
  - `POST /email/send`
  - `GET/PUT /email/connections/{connection_id}/signature`
  - `GET/PUT /email/connections/{connection_id}/ai-config`
  - `GET/POST/PATCH/DELETE /email/routing-rules` varianten
- FastAPI inbox AI endpoints zijn toegevoegd:
  - `POST /email/messages/{message_id}/ai-suggest`
  - `POST /email/messages/{message_id}/ai-summarize`
  - `POST /email/messages/{message_id}/ai-sentiment`
  - `POST /email/messages/{message_id}/ai-categorize`
- FastAPI knowledge base endpoints zijn toegevoegd:
  - `GET/POST /kb/collections`
  - `GET/POST /kb/collections/{collection_id}/documents`
  - `DELETE /kb/documents/{document_id}`
  - `GET /kb/search` (basis retrieval voor RAG context)
- FastAPI tabellen zijn uitgebreid/aangemaakt:
  - `email_oauth_connection`: provider ondersteunt `outlook` en `gmail`, plus `signature_html` en `ai_config`; kolommen `is_enabled` en `is_primary` sturen sync en primaire mailbox per organisatie
  - `email_synced_message`: velden voor threading/status/labels/AI (`thread_id`, `conversation_status`, `assigned_to_user_id`, `labels`, `ai_summary`, `sentiment`, enz.)
  - Nieuwe tabellen: `inbox_routing_rule`, `kb_collection`, `kb_document`
- Dashboard `/communication` is gekoppeld aan live email data:
  - real mailbox-selectie via gekoppelde verbindingen
  - berichtenlijst en detail via `/email/messages`
  - workflow acties: lezen/ongelezen, sluiten/heropenen, snooze, labels, toewijzen
  - composer met reply/forward/note tabs en verzenden via `/email/send`
  - AI blok met suggestie + samenvatting/sentiment/categorisering en bronverwijzingen uit `kb/search`
- Dashboard `/settings/inbox` gebruikt nu live data:
  - mailboxverbindingen uit `/email/connections` (inclusief `is_enabled` en `is_primary` in het antwoord van de API waar ondersteund)
  - **`PUT /email/connections/{connection_id}/mailbox-settings`** (body `is_enabled`, `is_primary`): sync aan/uit; uitschakelen zet primair automatisch uit; nieuwe primaire mailbox wist primair bij andere verbindingen in dezelfde organisatie
  - signature editor gekoppeld aan `/email/connections/{id}/signature`
  - routing rules manager gekoppeld aan `/email/routing-rules`
  - AI mailboxconfig gekoppeld aan `/email/connections/{id}/ai-config`
  - knowledge base beheer (collecties/documenten) gekoppeld aan `/kb/*`

---

## 11. Cursor Agent Orchestra

Het platform gebruikt een geautomatiseerde build pipeline (Cursor Agent Orchestra) voor het bouwen van features uit de PRD. De orchestrator draait volledig in FastAPI en bestuurt Cursor Cloud Agents via de Cursor API.

- Pipeline state machine in FastAPI: PENDING → BUILDING → BUILD_DONE → TESTING → TEST_DONE → REVIEWING → REVIEW_DONE → DONE
- 3 agent-rollen: Builder (bouwt features), Tester (test TypeScript + build), Architect (beoordeelt architecturele fit)
- Webhook-driven: Cursor stuurt status-updates naar FastAPI die automatisch de volgende stap triggert
- 12 feature batches totaal (8 origineel + 4 inbox-uitbreiding)
- Monitor task: elke 5 minuten controle op vastgelopen agents (terminal state + advance)
- MCP server: `cursor_orchestra` voor pipeline control

### 11.1 MCP-gedreven autonomie (primaire methode)

**Architectuurkeuze (2 april 2026):** Agents communiceren nu rechtstreeks met FastAPI via MCP-tools in plaats van uitsluitend via externe webhooks. Dit elimineert webhook-delivery-problemen en race conditions.

**Hoe het werkt:**
1. FastAPI lanceert een Builder/Tester/Architect agent via de Cursor Cloud API.
2. De agent-prompt bevat altijd een "When You Are Finished" sectie die de agent instrueert een MCP-tool aan te roepen.
3. De agent roept de betreffende MCP-tool aan op de `cursor_orchestra` MCP server, waarop FastAPI direct de DB-status bijwerkt en `orchestra/advance` uitvoert.
4. De volgende agent wordt hierdoor automatisch gestart.

**Drie signal-tools op MCP server `cursor_orchestra` (id: 6):**
- `orchestra_signal_build_done` (tool id: 13) — Builder roept dit aan met `feature_id`, optioneel `pr_url` en `summary`. Zet status → `build_done`, triggert advance → Tester agent.
- `orchestra_signal_test_done` (tool id: 14) — Tester roept dit aan met `feature_id`, `verdict` (`pass`/`fail`), optioneel `issues` en `summary`. Zet status → `test_done`, triggert advance → Architect (pass) of fix loop (fail).
- `orchestra_signal_review_done` (tool id: 15) — Architect roept dit aan met `feature_id`, `verdict` (`approved`/`rejected`), optioneel `issues` en `summary`. Zet status → `review_done`, triggert advance → feature DONE of fix loop.

Alle drie tools zijn **idempotent**: als de feature al buiten de verwachte status is, retourneren ze `{ok: true, action: "already_transitioned"}` zonder fout of state-corruptie.

**MCP server registratie:** De `cursor_orchestra` MCP server is geregistreerd in cursor.com/agents als HTTP endpoint (bearer auth). Agents die door de orchestra worden gelanceerd ontvangen automatisch toegang.

### 11.2 Webhook + polling als vangnet

Naast de MCP-primaire methode blijft het webhook-systeem actief als fallback voor edge-cases.

- Webhook `POST /webhook/cursor` is **idempotent**: transitie alleen als feature in verwachte fase zit. Dubbele webhooks worden gelogd en genegeerd.
- Scheduled task `orchestra_monitor` draait elke 5 minuten en detecteert vastgelopen agents (>30 min in dezelfde fase zonder voortgang).
- Poller script `scripts/orchestra-cursor-poller.ps1` stuurt synthetische webhooks voor agents met status `FINISHED`/`ERROR`/`EXPIRED`.
- Handmatig: `POST .../pipeline/advance-now` met `{"pipeline_id": 1, "secret": "bokito-advance-now"}` om `orchestra/advance` geforceerd opnieuw te laten lopen.

---

## 12. Agentic Orchestration Platform (PRD V1)

Het platform wordt uitgebreid met een autonome agentic orchestration laag bovenop de bestaande CRM/NoCode/Inbox modules. Volledige PRD: `temp/PRD_V1_Agentic_Orchestration_Platform.md`.

### 12.1 Architectuur — Vier Lagen

| Laag | Beschrijving |
|---|---|
| **User Layer** | Personal Assistant per gebruiker (mobile, web, widget). Vertaalt NL-instructies naar taken. |
| **Orchestrator Layer** | Eén orchestrator per workspace. Strategie, routing, conflictresolutie, resource-allocatie. |
| **Domain Agent Layer** | Persistente agents per business domein (Sales, Support, Operations, Product, custom). |
| **Worker Layer** | Child agents (persistent, gespecialiseerd) en sub-agents (ephemeral, parallel, taak-gebonden). |

### 12.2 Agent Types

- **Personal Assistant**: 1 per user, interface naar het agentsysteem
- **Orchestrator**: 1 per workspace, top van de hiërarchie
- **Domain Agent**: persistent, bezit een business domein (Sales, Support, Operations, Product)
- **Child Agent**: persistent worker onder een domain agent, specialistisch
- **Sub-Agent**: ephemeral, gespawned voor parallelle taken, vernietigd na afronding

### 12.3 Agent Lifecycle

`draft` → `active` → `sleeping` ↔ `awake` → `deactivated` → `deleted`

### 12.4 Task System

- Task lifecycle: `created` → `queued` → `assigned` → `in_progress` → `blocked`/`completed`/`failed`/`cancelled`
- Task types: immediate, scheduled, recurring, blocking, delegated, reactive
- Delegation chain met max diepte (default 5)
- Execution modes: parallel, sequential, best_of_n
- Koppeling met CRM Taak tabel via `crm_task_id`

### 12.5 Agent Communication Protocol (8 message types)

1. **Ask Question and Await Input** — blocking vraag naar superior
2. **Ask Question and Continue** — non-blocking vraag, upgradable
3. **Check Open Questions** — controle voor idle/sleep
4. **Answer Question** — beantwoord vraag van subordinate
5. **Update Question** — wijzig vraag of blocking status
6. **Delegate Task** — async taak delegeren, spawnt sub-agents
7. **Plan Self Task** — plan wake-up op toekomstig tijdstip
8. **Plan Task for User or Agent** — plan taak voor ander agent of gebruiker

### 12.6 Trigger & Wake System

Trigger types: question, command, delegate, report, webhook, schedule, data_change, inbox_event, answer. Agents slapen tot een trigger ze wekt. Cooldown en deduplicatie voorkomen rapid-fire.

### 12.7 Data Model (nieuwe FastAPI tabellen)

| Tabel | Doel |
|---|---|
| `agent` | Agent definities (type, role, parent, capabilities, system prompt) |
| `agent_task` | Taak instances (lifecycle, delegatie-chain, resultaten) |
| `agent_message` | Inter-agent communicatie (vragen, antwoorden, delegaties) |
| `agent_trigger` | Trigger configuraties (wake conditions, cron, webhook) |
| `agent_memory` | Langetermijngeheugen met vector embeddings |
| `agent_log` | Immutable execution log (tool calls, tokens, kosten) |
| `agent_orchestrator_config` | Per-workspace orchestrator instellingen |

### 12.8 Integratie met bestaande modules

- CRM tabellen (Klant, Bericht, Taak) als read/write data voor agents
- Inbox als bidirectioneel kanaal (lezen, reply drafts, assign, label)
- Knowledge Base + Magic Tables als RAG context
- MCP tools als gedeelde tool registry
- REST API + webhooks als externe communicatie
- Permissies (RBAC) uitgebreid met agent-scoped rechten

### 12.9 Security & Limits

- Agent permissies zijn subset van creator's permissies
- Per-agent tool restrictions (tabel, mailbox, knowledge source scope)
- Token budgets: daily (500k default), monthly (10M default), per-task (50k)
- Max concurrent agents: 10 (default)
- Human-in-the-loop gates voor destructieve acties (delete, send email, schema wijziging)
- Alle acties gelogd in immutable `agent_log`

### 12.11 Feature Request + AI Roadmap Orchestrator (implementatie)

Het platform heeft nu een eerste werkende backlog/roadmap module waarmee workspace users feature requests, bugs en wijzigingsverzoeken kunnen indienen. Deze module wordt gebruikt om dezelfde flow te dogfooden die later aan klanten wordt verkocht.

**Nieuwe FastAPI tabellen:**
- `backlog_item` (id: 54): feature request records met type, priority, status, complexity, category, PRD mapping, queue position, sprint label, tags/dependencies en soft delete velden.
- `backlog_comment` (id: 55): discussies en AI-triage notities per backlog item.
- `backlog_config` (id: 56): per-organisatie backlog instellingen (`auto_triage`, `prd_context`, `default_model`, `sprint_labels`).

**Nieuwe API groep:**
- API groep `backlog` (id: 11, canonical: `K4L0GFXy`) met JWT-auth (`auth = "user"`), tenant scoping op `user.account_id` en endpoints:
  - `GET /backlog/items`
  - `POST /backlog/items`
  - `GET /backlog/items/{id}`
  - `PATCH /backlog/items/{id}`
  - `DELETE /backlog/items/{id}` (soft delete)
  - `GET /backlog/items/{id}/comments`
  - `POST /backlog/items/{id}/comments`
  - `POST /backlog/triage/{id}`
  - `PATCH /backlog/roadmap/reorder`
  - `GET /backlog/config`
  - `PATCH /backlog/config`

**AI triage functie:**
- Nieuwe functie `backlog/ai_triage` (id: 29).
- Gebruikt OpenAI Chat Completions (`$env.OPENAI_API_KEY`) met JSON-output om `type`, `priority`, `complexity`, `category`, `prd_section` en `ai_summary` te bepalen.
- Heeft fallback heuristiek wanneer AI response faalt of malformed is, zodat triage altijd doorgaat.
- Schrijft AI-resultaat terug naar `backlog_item` en voegt een `is_ai=true` comment toe in `backlog_comment`.

**Dashboard UI:**
- De eerdere route `apps/dashboard/src/pages/Roadmap.tsx` op `/roadmap` is verwijderd uit het dashboard.
- De sidebar bevat geen `Roadmap` navigatie-entry meer.
- UI bevat drie views:
  - Submit Request (feature/alteration/bug intake)
  - Backlog lijst (selecteren, re-triage, delete)
  - Roadmap board (status-kolommen met queue reorder acties)

**Tenant dogfooding (Bokito AI):**
- `backlog_config` is ge-seed voor organisatie/account `bokito-ai` (`organisation_id = 3`).
- De 12 bestaande `orchestra_feature` batches zijn gemigreerd naar `backlog_item` als initiële roadmap records.

---

### 12.12 Autonome Dirigent Agent (portal feature first)

Het platform heeft nu een eerste autonome dirigent-laag die als productfeature in de portal beheerd wordt en de bestaande orchestra-flow self-healing ondersteunt.

**Nieuwe FastAPI tabellen:**
- `agent_orchestrator_config` (id: 57): per organisatie policy (`enabled`, `autonomy_level`, `check_interval_sec`, `max_retry_per_feature`, `allow_verdict_override`, `sleep_mode`, `last_wake_at`, `next_wake_at`).
- `agent_task` (id: 58): geplande en uitgevoerde dirigent-cycli (`wake_check`, `scheduled_check`, `recovery_action`) met status/audit.
- `agent_log` (id: 59): immutable audittrail van autonome acties.
- `agent_trigger` (id: 60): trigger-queue voor eventgedreven wakes.

**Uitbreiding bestaande orchestration tabellen:**
- `orchestra_feature` uitgebreid met `last_auto_action`, `auto_action_count`, `last_auto_action_at`, `auto_lock_until`.
- `orchestra_pipeline` uitgebreid met `autonomous_mode`, `last_auto_check_at`, `next_auto_check_at`.

**Nieuwe functies en scheduler:**
- Functies: `agent/log_event`, `agent/dirigent_scan_pipeline`, `agent/dirigent_plan_actions`, `agent/dirigent_execute_actions`, `agent/dirigent_sleep_schedule`, `agent/dirigent_wake`.
- Scheduled task: `dirigent_scheduler` (elke 120s) verwerkt onbewerkte triggers, due scheduled checks en safety wakes.
- De dirigent kan autonome acties uitvoeren zoals pipeline advance, state normalisatie en verdict-overrides (op basis van policy).

**Portal beheerlaag:**
- Nieuwe API group `orchestrator_control` (id: 12, canonical: `BWK_e0qC`) met user-auth endpoints:
  - `GET/PATCH /workforce/config`
  - `GET /workforce/status`
  - `POST /workforce/force-wake`
  - `POST /workforce/force-rescan`
  - `POST /workforce/pause`
- Nieuwe dashboardpagina `apps/dashboard/src/pages/OrchestratorControl.tsx` op route **`/workforce`** (oude pad `/orchestrator` redirect naar `/workforce`).
- Workforce is de primaire sidebar-entry voor orchestratie; het oude Workforce legacy submenu is verwijderd.

**Dogfooding activatie (Bokito tenant):**
- `agent_orchestrator_config` ge-seed voor `organisation_id = 3` met `enabled = true`, `autonomy_level = full`, `allow_verdict_override = true`, `check_interval_sec = 120`.
- `orchestra_pipeline` id `1` staat op `autonomous_mode = true`.

---

### 12.13 Orchestrator Agent Canvas (hiërarchische agentweergave in portal)

De orchestrator-pagina gebruikt een hiërarchische full-canvas visualisatie die de agentstructuur toont als verticale keten (Assistent → Manager → rij met **Productowner** en **Legal verantwoordelijke** naast elkaar). De fan-out en het **Builder/Tester/Auditor**-grid staan in de **linkerkolom** onder Productowner (lijn sluit aan op PO); Legal staat rechts op dezelfde rij als Productowner zonder child-agents. **Legal, Tester, Auditor en sub-builders** gebruiken hetzelfde **Lucide Bot**-icoon als de andere agentkaarten (geen weegschaal-SVG meer). Legal heeft geen child-agents in de UI; status (Active/Paused) volgt dezelfde orchestrator-runstate als Productowner.

**Dashboard UI:**
- `apps/dashboard/src/pages/OrchestratorControl.tsx` toont standaard direct de full-canvas weergave zonder linker boventabs (`Control` / `Agent Canvas`).
- De control-instellingen openen via de `Control` knop rechtsboven in de canvas en sluiten via `Terug naar canvas`.
- Er is een extra `Assistent` configuratieview binnen `/workforce`, bereikbaar via de `Assistent` knop rechtsboven in de canvas.
- De assistentconfig in `/workforce` gebruikt een editor-layout met inklapbare panelen (`Uiterlijk`, `Begroeting`, `Launcher`, `Systeem`, `Embed`), een agent-achtige headerkaart, en een vaste ondertoolbar met `Run`, `Config`, `Logs`, `Reset`, `Opslaan`.
- De assistentconfig wordt lokaal opgeslagen onder `orchestrator_assistant_config` en bevat o.a. naam, model, taal, temperature, wake template en visual/launcher/system prompt instellingen.
- De canvasweergave op `/workforce` gebruikt de volledige beschikbare paginahoogte en rendert alles binnen één canvaskaart.
- `Feature Queue` staat als smalle linker side-menu in de canvas; `Activity History` staat als smalle rechter side-menu in de canvas (onder de realtime/wake knoppen).
- De titel linksboven in de canvas gebruikt tenantcontext en toont `{tenant name} Workforce` boven de `Feature Queue`.
- De verbindingsstatusbadge (`Live`/`Polling`) staat links naast de workforce-titel; rechts bij de knopgroep staat geen tweede statusbadge.
- In de `Feature Queue` side-menu staat geen directe `Feature request` knop naar een losse roadmappagina.
- De `Feature Queue` op `/workforce` kan handmatig op PRD-restpunten worden gezet: runtime queue-items worden dan vervangen door een vaste lijst met open PRD-punten, opgesplitst in `te_implementeren`, `te_testen` en `te_auditen`.
- Triggeren van de `Productowner` in de workforce-canvas gebruikt een specifieke sequentieprompt: eerst queue ophalen, daarna per feature 1-voor-1 delegeren naar `Builder` (implementatie), `Tester` (verificatie) en `Auditor` (audit), met terugkoppellus bij fail/blockers.
- Bij `Trigger` op een agentkaart opent de UI een modal met een vrij instructieveld voor die specifieke agent; bij leeg invoeren valt het systeem terug op de standaard rolinstructie.
- Runtime-status op `/workforce` markeert een agent pas als echt `Actief` wanneer er een executing activity **met sessie-check-in** is (`activity.session_id` of `agent.current_session_id`). Bij alleen `trigger-agent` zonder sessie-check-in toont de UI `Check-in wachtend` met statusregel `Wacht op check-in vanuit Cursor Cloud Agent`.
- Onderaan de canvas staat een workforce-achtige `Timeline` met horizontale duursegmenten op de tijd-as.
- De `Timeline` gebruikt nu een interactief tijdvenster (ingezoomde default) in plaats van altijd de volledige dagbreedte.
- Bij laden wordt de huidige tijd (`Nu`) in het midden van de timeline viewport gezet.
- Gebruikers kunnen horizontaal over de timeline draggen/pannen (grab/grabbing) om door de tijd te navigeren; pointer-capture cleanup op `pointerup`/`pointercancel`/`lostpointercapture` voorkomt vastlopende dragstates.
- Segmenten worden geclipt op de viewportgrenzen; lopende items renderen als `actual_start -> now`.
- Uurmarkeringen worden dynamisch berekend op basis van het huidige viewportvenster.
- De `Timeline` toont een verticale `Nu`-markering over de tijd-as, zodat de huidige tijd direct zichtbaar is t.o.v. geplande en lopende items.
- In `Timeline` staan de uur-labels onderaan, zodat de swimlanes bovenin meer verticale ruimte krijgen.
- Hover op een timelinesegment toont uitgebreide timingdetails: `Planned start/end`, `Actual start/end`, status en berekende duur.
- Hover op een timelinesegment benadrukt de bijbehorende agentkaart in de hiërarchie (accent ring); koppeling loopt via `activity.agent_id` naar de agent `id`. De markering verdwijnt bij pointer-leave op het segment en bij start van timeline-pannen (drag).
- Kleurcodering in `Timeline`: planned/queued = paars, current/in_progress = groen, done/completed = gedimd groen, failed = rood.
- Het centrale agent-hierarchieblok zit in een **max-breedte container** (`max-w-3xl`) met **verticale scroll** in het middenvak; vertakte verbindingen zijn **één SVG-pad per niveau** (`TreeForkTwo` manager→PO/Legal, `TreeForkThree` PO→builder/tester/auditor) plus ronde **`TreeStem`**-segmenten, zodat lijnen visueel aansluiten en meeschalen met `w-[min(100%,…)]` i.p.v. losse absolute `div`-lijntjes met vaste pixelbreedtes. De rij met drie workerkaarten **wrapt** (`flex-wrap`) op smalle breedtes.
- Rechtsboven in de canvas staat een `Control` knop die direct terugschakelt naar de `Control` tab op `/workforce`.
- `Activity History` is een scrollbare feed met een verticale gradient-lijn door het midden van een vaste rail (`w-5`); stippen zitten gecentreerd op die lijn en krijgen kleur/ring op basis van logniveau (`error`/`warn`/`info`). Kopregels met patroon `Rol: titel` tonen een compacte rol-badge plus titel; andere regels blijven één regel. Rijen hebben lichte hover-achtergrond; de paneelkop toont een `Activity`-icoon en een teller-badge.
- De hoofd-canvas op `/workforce` rendert edge-to-edge binnen de parent (zonder linker/rechter ruimte), zonder rounded corners en met een fijn mini-dot raster als achtergrond.
- De losse `Last updated` regel onder de canvas is verwijderd om onnodige verticale ruimte onderaan te voorkomen.
- Bovenaan is er een expliciete verticale connectorlijn van `You` naar de `Assistent` node.
- Connectorlijnen in de workforce-tree worden berekend op basis van **exacte kaartcentra** (boven en onder): de vertakkingspunten sluiten altijd aan op het midden van de parent- en child-kaarten, ook bij verschillende cardbreedtes (manager/productowner/legal vs builder/tester/auditor).
- Agentnodes hebben workforce-achtige hover-acties (Run/Wake, Config, Logs), dikkere omlijning en het `AGENT BOT ICON` als node-icoon.
- Agentstatus wordt visueel getoond met kleur + statusdot; badges op kaarten tonen alleen statussen met semantische labels (`Active`, `Delegated`, `Paused`, `Error`).
- Agentcards in de canvas gebruiken een grotere, vrijstaande avatar (zonder icoon-achtervlak), gecentreerde tekst en smallere cardbreedte voor een compactere hiërarchie; de rolregel wordt alleen getoond wanneer die afwijkt van de agentnaam (geen dubbele `Manager` + `Manager`).
- Voor actieve agentnodes toont de activiteitstekst onder de naam een draaiende loader-indicator, zodat zichtbaar is dat de agent live bezig is met de huidige taak.
- De vaste `Wake` knop rechtsboven in de canvas is vervangen door een statusafhankelijke actieknop: `Pause` wanneer de workforce actief is en `Wake` wanneer de workforce gepauzeerd is.
- De canvas toont geen aparte workforce-runstate badge meer in de header; runstate blijft zichtbaar op agentniveau (bijvoorbeeld `Paused` subtitle op relevante nodes).
- De workforce-canvas draait altijd periodieke API refresh als vangnet (sneller interval bij geen websocket-verbinding), zodat status/timeline/history blijven updaten wanneer realtime socket tijdelijk instabiel is.
- Hiërarchie-styling: Assistent = accent + chatwolk-icoon; **actieve** builder = success-groen (rand, dot, icoon, titel, subtitel, loader); **gedelegeerd** = accent (paars); **fout** = error-rood. **`inactive` en `paused`**: rand `border-border` en icoon + titel + rol + subtitel in een neutrale, goed leesbare grijstint (`text-text-muted`) zodat kaarten duidelijk grijs blijven zonder fletse/doorzichtige indruk. Manager/Productowner met delegated tonen vaste ondertitel **Delegated task** waar van toepassing; actieve agents tonen een loader naast de activity-regel wanneer er wél een actieve taak is.
- De child-agents van Productowner (`Builder`, `Tester`, `Auditor`) blijven op dezelfde horizontale rang (`flex-nowrap`); op smallere viewport ontstaat horizontale overflow i.p.v. verticaal stapelen.
- De header-badge toont verbindingsmodus als `Live` (websocket actief) of `Polling` (fallback refresh actief).

**AI OS canvas (unified workspace graph):**
- `apps/dashboard/src/pages/AiOsCanvas.tsx` — React Flow canvas at `/os`; `@xyflow/react`.
- `apps/api/app/models/os_graph.py` — `OsCanvasNode`, `OsCanvasEdge` overlay tables.
- `apps/api/app/services/os_graph.py` — auto-seed, graph read, nodes/edges CRUD.
- `apps/dashboard/src/components/aios/OsFlowNode.tsx`, `OsAddNodePalette.tsx`, `NodeCard.tsx`.
- `apps/dashboard/src/lib/os-api.ts`, hook `useOsGraph`.
- `apps/dashboard/src/lib/workforce-realtime.ts` beheert FastAPI realtime websocket connectie op channel-niveau met reconnect/backoff.
- Als de socket sluit **zonder** ooit `open` te hebben bereikt (typisch: `/realtime` handshake issue), zet de client tijdelijk een korte cooldown in `sessionStorage` (`bokito_workforce_realtime_unavailable`) en probeert daarna automatisch opnieuw met reconnect/backoff. Er is dus geen permanente tab-lock meer na een enkele mislukte handshake. Optioneel: in `.env.local` zetten `VITE_DISABLE_WORKFORCE_REALTIME=true` of `VITE_DISABLE_ORCHESTRATOR_REALTIME=true` (legacy) om realtime volledig over te slaan.
- Realtime diagnose (3 april 2026): directe probe naar `wss://api.bokito.nl/realtime?channel=workforce/{organisation_id}` vanaf de devmachine geeft geen websocket-upgrade (`non-101 status`); de HTTP-variant op `/realtime` levert de FastAPI frontend-HTML i.p.v. een websocket handshake. In deze situatie blijft de Workforce UI in `Polling` fallback.

**Fallback gedrag:**
- Als `graph-snapshot` endpoint nog niet beschikbaar is, bouwt de frontend een baseline graph uit `GET /workforce/status` (pipeline + recente taken).
- Als `graph-resync` niet beschikbaar is, gebruikt de frontend `POST /workforce/force-rescan` als fallback resync-trigger.

**Realtime channel convention:**
- De Workforce canvas luistert op tenantniveau naar FastAPI Realtime channel `workforce/{organisation_id}` (een stabiele websocket per tenantweergave).
- Runtime APIs en MCP runtime-tools publiceren updates op `workforce/{organisation_id}` met payloads voor `agent_updated`, `activity_updated`, `task_updated` en `message_created`.
- In FastAPI Realtime kanaalconfiguratie staat channel `workforce` met `Enable Nested Channels` ingeschakeld, zodat clients op `workforce/{organisation_id}` kunnen subscriben.

**Workforce realtime debugging (frontend):**
- De realtime client ondersteunt diagnostiek-events (`connect_attempt`, `close`, `error`, `cooldown`, `fallback_without_token`, `give_up`) die in de Workforce header als debugregel getoond worden wanneer de status niet `Live` is.
- De websocket-URL is overschrijfbaar via `.env` (`VITE_WORKFORCE_REALTIME_WS_URL` of `VITE_WORKFORCE_REALTIME_PATH`; legacy aliases `VITE_ORCHESTRATOR_REALTIME_WS_URL`/`VITE_ORCHESTRATOR_REALTIME_PATH` blijven ondersteund).
- Extra optie: `.env` `VITE_WORKFORCE_REALTIME_CANONICAL` (of legacy `VITE_ORCHESTRATOR_REALTIME_CANONICAL`) bouwt automatisch websocket pad `.../rt/{canonical}` (FastAPI SDK-transport).
- Bij een mislukte handshake vóór `open` probeert de client éénmalig opnieuw zonder `token` queryparam om auth-problemen te onderscheiden van transport/proxy-problemen; daarna valt hij terug op de bestaande cooldown/backoff.
- Auth-context ondersteunt nu een apart realtime-token uit login/refresh responses (`realtimeAuthToken`, `realtime_auth_token` of `realtime_token`) en bewaart dit als `bokito_realtime_auth_token`; Workforce gebruikt dit token voor websocket-auth en valt terug op het reguliere access token als geen realtime-token beschikbaar is.
- In de Workforce header staat een `Realtime test` knop die meerdere websocket-URL-varianten (canonical/path/legacy met en zonder token) kort probeert en de resultaten (`OPEN`, `ERROR`, `CLOSED (code)`, `TIMEOUT`) in een compact diagnostiekpaneel toont.
- Login-debug op 3 april 2026 (accounttest): `POST /api:DavdZOps/auth/login` retourneert momenteel alleen `authToken` en `user_id` (geen realtime-token velden). Voor deze workspace werkt realtime-transport via `wss://<instance>/rt/{canonical}` met JWT als WebSocket subprotocol; de oude `/realtime?...&token=...` queryvorm geeft non-101 / browser close code `1006`.
- Login-incident op 4 april 2026 (portal): in sommige flows faalt de vervolgcalls voor profiel (`GET /auth/me`) met backendmelding `Value is not a valid integer.` terwijl credentials correct zijn. Frontend gebruikt daarom een fallback-profiel op basis van login payload zodat gebruikers toch kunnen inloggen.
- Workforce statussemantiek (3 april 2026): een agent telt alleen als `Actief` wanneer er een live cloud agent sessie is (`current_session_id` of `current_activity_id`). Als backendstatus `active` is zonder live sessie toont de UI `Activeren`; overige niet-foutstaten tonen `Uitgeschakeld`.
- Statusuitbreiding: parent-agents zonder eigen live sessie kunnen status `Awaiting` tonen wanneer een direct child-agent `Actief` of `Activeren` is; subtitle gebruikt patroon `Awaiting {child agent}`.
- Visual state update: `Activeren` rendert lichtgroen (geen blauw) met pulse op de statusdot om overgang naar live sessie visueel te markeren.
- UI-safety bij stale runtimedata: `executing` timeline-items van agents die niet `Actief` zijn worden in de feature queue als `planned` getoond; voor `Gepauzeerd/Uitgeschakeld` wordt oude `current_activity_summary` niet als actieve runtime-samenvatting gebruikt.

### 12.7 Agent Runtime Model (rebuild)
- Het orchestration datamodel is opnieuw opgebouwd rond runtime actor-entities: `agent`, `agent_session`, `activity`, `task`, `message`, `agent_log`, `tool`, `agent_tool`, `event`.
- Het model gebruikt nu een tenant-configureerbare `role` tabel; agenten verwijzen naar rollen via `agent.role_id` (de oude enum-kolom `agent.role` is verwijderd).
- Het platform gebruikt nu `agent_session` voor sessies per cloud agent run en `activity` als primaire bron voor live status + timeline-items.
- `agent.current_activity_summary` is de live statusregel onder agentnamen op de canvas; deze wordt bijgewerkt door MCP tools.
- Voor tenant `Bokito AI` zijn rollen en agenten opnieuw gestructureerd als boom: `Manager` (root), daaronder `Productowner` en `Legal verantwoordelijke`, en onder `Productowner` de uitvoerende agenten `Builder`, `Tester`, `Auditor`.
- Nieuwe API-group `agent_runtime` levert runtime data voor de canvas: `GET /agents`, `GET /agents/{agent_id}/sessions`, `GET /agents/{agent_id}/activities`, `GET /timeline`.
- `GET /agents` verrijkt agentresultaten met `role_name` en `role_slug` via join op de `role` tabel.
- Nieuwe endpoint `PATCH /agents/{agent_id}/status` werkt agentstatus (`idle|active|sleeping|error|paused`) bij en publiceert direct een realtime `agent_updated` event op `workforce/{organisation_id}`.
- Voor runtime-tabellen met optionele FK-velden (`task`, `message`, `activity`, `agent_log`) moeten optionele UUID-kolommen als nullable staan; anders falen inserts met `SQL 22P02 INVALID TEXT REPRESENTATION` zodra een optioneel veld leeg/default is.
- Demo-seed voor workforce observability gebruikt combinatie van `task` + `message` + `activity` + `agent_log`: een geplande taak op +10 minuten (type `scheduled`), actieve manager-activity en geplande builder-activity zodat timeline zowel verleden, live als toekomst toont.
- Nieuwe MCP server `agent_orchestra` exposeert tools voor session/activity/task/messaging/lifecycle (`start_session`, `end_session`, `create_activity`, `update_activity_status`, `complete_activity`, `create_task`, `assign_task`, `update_task`, `complete_task`, `delegate_task`, `send_message`, `wake_agent`, `sleep_self`, `schedule_wake`).
- `create_task` ondersteunt `planned_end` en bewaart planning-context (`planned_start`/`planned_end`) voor downstream timeline-interpretatie.
- `create_activity` functioneert als check-in voor uitvoerende werkfase: zet `started_at` (actual start), markeert gekoppelde task als `in_progress` en activeert de agentstatus.
- `complete_activity` functioneert als checkout: zet `ended_at` (actual end), sluit optioneel de sessie af, zet gekoppelde task op eindstatus, rapporteert optioneel upstream via `message` en zet de agent terug naar `standby`.
- MCP runtime-tools publiceren realtime events op channel `workforce/{organisation_id}` met event types zoals `agent_updated`, `activity_updated`, `task_updated`, `message_created`.
- Runtime agentstatus is gemigreerd naar `standby|active|sleeping|error`; legacy `paused` en `idle` zijn vervangen door `standby` voor de workforce flow.
- `POST /workforce/force-wake` is vereenvoudigd naar manager wake-policy: de endpoint activeert de manager en publiceert een `agent_updated` event, zonder delegated task/activity creatie.
- Endpoint `POST /workforce/trigger-agent` start directe uitvoering op een doelagent door eerst een echte Cursor Cloud run te starten via `POST https://api.cursor.com/v0/agents` (met repository/ref/model/webhook uit agent-config en env), daarna pas `agent_session` + `task` + `activity` te maken en `agent.current_session_id/current_activity_id` te koppelen.
- `POST /workforce/trigger-agent` verrijkt de launch prompt nu met een verplichte runtime-SOP: eerst check-in via `cloud_agent_tools` (`CA Get Context`, `CA Set Active`), daarna uitvoeren, en bij afronding MCP-signaling met `workforce_get_agent_activities` + `workforce_complete_activity` (indien `bokito-workforce` tools beschikbaar zijn).
- `POST /workforce/trigger-agent` ondersteunt weer webhook-launchmodus wanneer `CURSOR_WORKFORCE_WEBHOOK_URL` of `ORCHESTRA_WEBHOOK_URL` beschikbaar is; bij ontbrekende webhookconfig blijft een no-webhook fallback actief zodat launches niet blokkeren.
- Nieuwe endpoint `POST /workforce/focus-update` werkt live focusstatus bij voor actieve activiteiten: update van `activity.status_detail`, `agent.current_activity_summary`, realtime events (`activity_updated`, `agent_updated`) en persistente `agent_log` records.
- Focus-heartbeat policy: bij `source = heartbeat` en een update-gap groter dan 20 seconden markeert het backend-log de update als `heartbeat_warning` (`level = warn`) zodat Activity History en Agent Log voortgangsvertraging zichtbaar maken.
- De lokale MCP server `bokito-workforce-mcp` exposeert nu tool `workforce_update_focus` voor agents om focuswissels en 20s-heartbeats expliciet te signaleren tijdens uitvoering.
- Triggerprompt-optimalisatie (workforce runtime): de launch prompt stuurt agents nu eerst naar check-in + directe `workforce_update_focus` (`Initializing`), vereist focus-switch updates en 20s-heartbeats, en bevat expliciete guardrails voor niet-coding requests (direct antwoord, geen brede repo-scan, geen ongevraagde file/commit/PR-acties).
- Endpoint `POST /workforce/complete-activity` rondt uitvoering af met sessie-checkout: zet activity naar terminale uitkomst, zet gekoppelde task terminal, sluit `agent_session` (status + `ended_at` + `summary`) wanneer aanwezig, zet agent terug naar `standby`, en wist `current_session_id/current_activity_id`.
- Endpoint `POST /workforce/maintenance-run` voert stale cleanup + retries uit (default stale > 15 min): markeert stale executing activity als failed, plant retry met backoff (30s/120s) zolang `retry_attempt < max_attempts`, en zet agent terug naar `standby`.
- `GET /workforce/status` is vereenvoudigd naar runtime-bronnen (`task`, `agent_log`, managerstatus) en retourneert stabiel `pipelines`, `recent_tasks` en `recent_logs` zonder legacy referenties.
- `GET /timeline` en `GET /agents/{agent_id}/activities` in API group `agent_runtime` gebruiken nu directe `activity`-query zonder verplichte `agent_session`-join, zodat geplande delegaties zonder sessie direct zichtbaar blijven in timeline en delegated-status.
- Er is een lokale stdio MCP package `packages/bokito-workforce-mcp` die workforce-operaties op FastAPI uitvoert via `api:BWK_e0qC` (orchestrator) en `api:_NUMR_yJ` (runtime). De server gebruikt env-token auth (`BOKITO_WORKFORCE_MCP_TOKEN` of alternatieven) en is tenant-scope per token, zodat productie multi-tenant wordt ingericht met aparte token/config per tenant.

---

## 13. Toekomstige Functionaliteiten (Roadmap)

- Marketplace voor kant-en-klare agent templates
- Stem-interface voor de conversational agent
- Autonome multi-step workflows
- Diepere integraties (Slack, Teams, Google Workspace)
- AI-samenwerking tussen meerdere agents
- Alle stub-modules volledig implementeren
- WhatsApp Business kanaal voor inbox
- Live chat widget integratie met inbox
- Agentic orchestration platform implementatie (PRD V1)

---

## 14. API Groepsstructuur (mei 2026)

FastAPI workspace `Bokito AI app` gebruikt nu een geconsolideerde API-groepsindeling met semantische canonicals.

- `/api/app`: centrale applicatiegroep voor members/accounts, custom-db, backlog en workspace endpoints (geen auth-routes).
- `/api/integrations`: integratiegroep voor email/OAuth/inbox-integratie endpoints.
- `/api/auth`: dedicated authgroep voor alleen authenticatie- en profielgerelateerde endpoints.
- `api:DavdZOps`: tijdelijke legacy compat-groep toegevoegd voor oudere portal bundles die nog hardcoded naar `https://api.bokito.nl/api:DavdZOps/...` wijzen.
- `/api/workforce`: centrale workforcegroep voor orchestra/workforce-control/agent-runtime endpoints.
- `/api/livechat`: livechat en widget-endpoints.
- `api:logs`: event logs.
- `api:bakermat`: Bakermat configurator en bijbehorende endpoints.

Dashboard frontend-richtlijn:

- API-routes worden dynamisch opgebouwd via `VITE_BOKITO_API_URL` + group canonical + endpoint path.
- Group canonicals zijn env-gedreven via:
  - `VITE_API_GROUP_APP`
  - `VITE_API_GROUP_AUTH`
  - `VITE_API_GROUP_INTEGRATIONS`
  - `VITE_API_GROUP_WORKFORCE`
  - `VITE_API_GROUP_LIVECHAT`
  - `VITE_API_GROUP_LOGS`
  - `VITE_API_GROUP_BAKERMAT`
- Publieke docs-URL gebruikt `VITE_PUBLIC_API_URL` i.p.v. hardcoded hoststrings.
- Auth BFF-proxy (`/api/auth/*`) rewrite gebruikt `VITE_API_GROUP_AUTH` als canonical fallback.
- Legacy compat voor oude production bundle: `api:DavdZOps` bevat nu alias endpoints `POST /auth/login`, `GET /auth/me`, `POST /auth/handoff/create`, `POST /auth/handoff/exchange` zodat login blijft werken zolang de oude frontendbundle nog actief is.
- Voor legacy email/inbox-compat in dezelfde oude bundle bevat `api:DavdZOps` nu ook `GET /email/connections`, `DELETE /email/connections/{connection_id}`, `GET /email/oauth/start`, `GET /email/outlook/oauth/start` en `GET /email/google/oauth/start` (met centrale `/api/integrations` callbacks voor provider redirects).
- `GET /email/oauth/start` (provider `outlook` of `gmail`) bouwt de provider authorize-URL met `redirect_uri` uit FastAPI env (`MICROSOFT_REDIRECT_URI` resp. `GOOGLE_REDIRECT_URI`), RFC 3986-encoded; state-rij bevat `feature` (`outlook-email` / `gmail-email`). Zelfde env-waarden moeten exact overeenkomen met de geregistreerde redirect URI in Entra / Google Cloud.
- GitHub repo connect (workforce + marketplace): `GET /github/oauth/start` (user auth) retourneert `{ authorize_url }`; callback `GET /github/oauth/callback` (publiek, HTML redirect). Marketplace-setup roept alleen `/github/oauth/start` aan (geen fallback naar `/integrations/oauth/start`). Registreer een GitHub OAuth App met callback op de callback-URL. FastAPI env: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_CALLBACK_URL` (exact gelijk aan geregistreerde redirect URI). Scopes: `read:user`, `repo`. Token exchange in FastAPI gebruikt `api.request` met `params` + `Content-Type: application/x-www-form-urlencoded` (geen `body`-block).
- `GET email/outlook/oauth/start` en `GET email/google/oauth/start` gebruiken dezelfde env-redirects (plus preconditions dat de env gezet is); token exchange in `GET /oauth/microsoft/callback` en `GET /oauth/google/callback` gebruikt dezelfde env-waarde in de token-POST `redirect_uri` als bij de authorize-stap.
- Profielfoto-upload gebruikt de authgroep endpoint `POST /users/me/avatar` (met fallback naar `POST /avatar` voor backward compatibility binnen `/api/auth`).
- Avatar upload-endpoints gebruiken `input file avatar` + `storage.create_image` en patchen daarna `user.avatar`; directe patch van ruwe input zonder opslag geeft in de praktijk lege avatar-objecten terug (`path: ""`, `size: 0`).
- Workspace-branding gebruikt appgroep endpoints:
  - `GET /workspaces` retourneert workspace `id`, `name`, `slug`, `logo`, `favicon`, `brand_color`.
  - `POST /workspaces/{workspace_id}` voor naam/subdomein/kleur updates (`subdomain` is verplicht).
  - `POST /workspaces/{workspace_id}/branding` voor gecombineerde branding update inclusief optionele `file logo` en `file favicon` (`subdomain` is verplicht).
- De pagina `/settings/branding` doet nu een echte API-save naar `/workspaces/{workspace_id}/branding` (multipart) voor naam/subdomein/kleur/logo/favicon, en refresht daarna `workspaces` + `auth/me` context.
- Tenant branding ondersteunt een aparte favicon uploadflow (los van logo) met preview en opslag in `organisation.livechat_settings.favicon`.
- Praktijkbeperking: FastAPI `storage.create_image` accepteert niet alle image-extensies (o.a. ruwe SVG kan falen met `Invalid file extension`); dashboard branding upload ondersteunt nu SVG door deze client-side om te zetten naar PNG vóór upload, met behoud van PNG/JPG/JPEG/GIF/WebP ondersteuning.
- Workspace media-URL's (`logo`, `favicon`) worden frontend-side genormaliseerd naar absolute URL's op basis van `BOKITO_BASE_URL` wanneer FastAPI alleen een relatief `path` terugstuurt, zodat previews consistent renderen in settings.
- Subdomeinbeleid: `subdomain` is tenantbreed verplicht en uniek. Backend valideert formaat (`[a-z0-9-]`, 3-63 chars, niet starten/eindigen met `-`) en blokkeert duplicaten.
- Hostmodel: dashboard draait tenant-first op `<subdomain>.bokito.ai` met centrale login op `app.bokito.ai`.
- Unauthenticated requests op tenant-host worden via `ProtectedRoute` doorgestuurd naar `https://app.bokito.ai/login?return_to=<absolute-tenant-url>`.
- Na succesvolle login op `app.bokito.ai` navigeert de portal terug naar `return_to` (zelfde root domein), zodat de sessie direct op tenant-host verdergaat.
- WorkspaceContext lockt op tenant-host op de workspace waarvan `slug == host subdomain`; cross-tenant switch op een tenant-host wordt genegeerd.
- Livechat `POST /api/livechat/session/start` ondersteunt `tenant_subdomain`; bij aanwezigheid valideert backend dat de agent echt bij die tenant-subdomein hoort, anders volgt `Tenant not found for this subdomain`.

*Laatste update: 10 mei 2026 — OAuth centrale callbacks en unified `email/oauth/start` gebruiken `MICROSOFT_REDIRECT_URI` / `GOOGLE_REDIRECT_URI` voor authorize en token exchange; API-groepen geconsolideerd naar `app/auth/workforce/livechat/logs/bakermat`.*

---

## 15. FastAPI tabel-audit (8 mei 2026)

Workspace `1` (`Bokito AI app`) bevat meerdere datadomeinen naast elkaar: portal/auth, livechat, workforce, custom database, backlog en integraties.

### Waarschijnlijk actief en leidend

- Auth/tenant: `user`, `organisation`, `auth_handoff`, `system_event_log`.
- Livechat: `conversation`, `message`, `customer`, `attachment`, `bot_agent`, `bot_agent_tool`, `tool_registry`.
- Workforce: `agent`, `agent_session`, `activity`, `st_task`, `agent_log`, `user_role`.
- Custom DB builder: `custom_table`, `custom_field`, `custom_record`, `custom_view`.
- Backlog: `backlog_item`, `backlog_comment`, `backlog_config`.
- Scraped docs/KB pipeline: `doc`, `doc_page`, `doc_section`.

### Gevonden overlap of legacy-kandidaten

- `agent_conversation` + `agent_message` lijken legacy naast `conversation` + `message` (eerste set leeg, tweede set gevuld).
- `tool` + `agent_tool` lijken legacy naast `tool_registry` + `bot_agent_tool` (eerste set leeg, tweede set gevuld).
- `knowledge_base` lijkt legacy naast `doc/doc_page/doc_section` (knowledge_base leeg, docs-tabellen gevuld).
- `kb_collection` + `kb_document` zijn aanwezig maar leeg; mogelijk oud upload-pad dat nu niet gebruikt wordt.

### Leeg/laag-gebruik op auditmoment (niet direct verwijderen zonder dependency-check)

- Leeg gezien: `collaboration`, `system_program_file`, `system_event`, `agent_conversation`, `agent_message`, `knowledge_base`, `kb_collection`, `kb_document`, `conversation_memory`, `bot_agent_identity_config`, `tool`, `agent_tool`, `email_oauth_connection`, `email_synced_message`, `user_session`.
- Let op: leeg betekent niet automatisch overbodig (sommige tabellen zijn runtime/transient of feature-flagged).

### Opschoonvolgorde (veilig)

1. **Dependency scan** per kandidaattabel in APIs, functions, tasks, tools en triggers.
2. **Soft-deprecate**: markeer legacy-tabellen intern en stop nieuwe writes.
3. **Observatieperiode** (bijv. 14 dagen) met write-monitoring.
4. Pas daarna pas **hard delete** van tabellen die aantoonbaar geen reads/writes meer hebben.

### Uitgevoerd: overlap cleanup (8 mei 2026)

- Hard verwijderd na dependency-check en lege datasets: `agent_conversation`, `agent_message`, `tool`, `agent_tool`, `knowledge_base`.
- `search_knowledge_base` tool is gemigreerd van `knowledge_base` naar `doc_section` (tenant-scoped via `conversation.organisation_id`) en retourneert nog steeds top-3 relevante passages.
- Canonieke modellen voor chat/tooling blijven: `conversation` + `message` en `tool_registry` + `bot_agent_tool`.
- `system_event` is **niet** verwijderd; dit model blijft functioneel los van audit logging in `system_event_log`.

## 16. Bokito OS Restructure (juni 2026)

OpenClaw-geïnspireerde herstructurering van de FastAPI/V1-track. Plan: gateway control plane, één threadmodel, MCP-first toollaag, markdown workspace, trigger-scheduler, frontend-consolidatie, native mobile.

### Fase 1 — Thread-unificatie (afgerond)

- `Signal`/`SignalMessage` is het **enige** conversatiemodel in `apps/api`. De legacy modellen `Conversation`/`ConversationMessage`, `InboxThread`/`InboxMessage`/`InboxEvent`/`InboxThreadPin` en `EmailThread`/`EmailMessage` zijn verwijderd (code + tabellen via startup-migratie in `app/db/schema_patch.py::_migrate_legacy_threads_to_signals`, met data-overzet en `DROP TABLE`).
- Nieuwe kanaallaag (`app/models/channel.py`):
  - `ChannelAccount` vervangt `EmailAccount` en generaliseert naar `channel` = `email` | `widget` | `slack` (velden: `provider`, `address`, `credentials_json`, `settings_json`, `sync_cursor`).
  - `Contact` is de externe deelnemer-identiteit per kanaal (email-adres, widget-visitor, Slack-user) met `status` `approved`/`pending`/`blocked` voor pairing/allowlists.
- `Signal` nieuwe velden: `channel_account_id`, `contact_id`, `owner_user_id` (persoonlijke assistant-threads); kanalen uitgebreid met `assistant` en `slack`. `SignalMessage` kreeg `metadata_json` en `certainty`.
- Kanaal → Signal mapping: assistant-chat = `channel="assistant"` + `owner_user_id`; widget-bezoekers = `channel="widget"` + `contact_id`; e-mail = `channel="email"` + `channel_account_id`; interne agent-threads = `channel="internal"`.
- API-contracten behouden maar Signal-backed: `/api/chat/conversations*` (assistant), `/api/widget/*`, `/api/livechat/*` (persisteert nu echt; logged-in users krijgen assistant-thread, anoniem krijgt Contact + widget-thread), `/api/email/*` (ChannelAccount + Signal). Routers `/api/inbox` en `/api/inbox/threads*` zijn verwijderd; de Messages hub gebruikt uitsluitend `/api/signals`.
- `DecisionRequest.conversation_id` is vervangen door `signal_id`; agent-tools (`create_decision_request` e.d.) accepteren/propageren `signal_id`, en `AgentLoop` krijgt `signal_id` zodat beslissingen inline in de juiste thread landen.
- Inbound verwerking: worker-taak `process_inbound_signal` (was `process_inbound_email`) draait de agent-loop op een Signal; enqueue via `enqueue_signal_processing`.
- Feedback: `MessageFeedback`/`FeedbackQueueItem` verwijderd; `POST /api/messages/{id}/feedback` schrijft naar het learning-model `Feedback` (`subject_type="message"`).
- Dashboard: `USE_SIGNAL_INBOX` staat permanent aan (Signal is het enige inboxpad); messenger-ui `listInbox` leest `/api/signals`.

### Fase 2 — Gateway control plane (afgerond)

- Eén WebSocket endpoint `GET /api/ws` (`app/gateway/`) met typed JSON-protocol: client stuurt `connect`/`sub`/`unsub`/`ping`, server stuurt `connected`/`sub_ok`/`event`/`pong`. Event-types: `message`, `thread`, `agent.run`, `decision`, `notification`, `presence`.
- Topics: `threads`, `runs`, `decisions`, `notifications`, `presence`, `health` (operator-breed) plus `run:<id>` en `signal:<id>` (specifiek). Dashboard-users mogen alles binnen hun tenant; widget-principals mogen alleen `signal:<id>` voor threads die van hen zijn (Contact-match of `owner_user_id`).
- Auth op connect: dashboard JWT of widget session token via `?access_token=` of een `connect`-frame; `device` parameter voor device-identiteit (dashboard / widget / mobile).
- Fanout: in-process dispatch + optionele Redis pub/sub (`bokito:gateway:events`) zodat ARQ-workers en meerdere webworkers WS-clients bereiken; zonder Redis werkt single-process fanout gewoon.
- Publish-hooks: signal-berichten (`assistant_threads`, `signal_threads.reply`, `signals.create_inbound_signal`, `signal_decisions`), thread-updates (`patch_thread`, `apply_triage`), run-events (`orchestration/runner.log_run_event`, `AgentLoop._log_event`), decisions (created/resolved) en notifications.
- Verwijderd: orchestration SSE endpoint `GET /api/orchestration/runs/{id}/events/stream` (vervangen door topic `run:<id>`); FastAPI Realtime (`/rt/...`) clients in de widget.
- Dashboard: `lib/gateway.ts` (singleton WS-client met reconnect/backoff en topic-subscriptions). `LiveWorkLog` streamt run-events via WS; `NavBadgeContext` en `useThreads` verversen live op `threads`/`decisions` events (polling is teruggebracht tot trage fallback). Vite dev-proxy heeft `ws: true`.
- Widget: `RealtimeClient` spreekt nu het gateway-protocol (`gatewayWebSocketUrl` leidt `wss://host/api/ws` af van de livechat base). Assistant-replies en run-logs komen via gateway-events binnen; token-streaming van een actief antwoord blijft via `POST /api/livechat/stream-chat` (fetch-SSE).

### Fase 6 — Kanalen + frontend-consolidatie + FastAPI sunset (afgerond)

**Backend kanaal-adapters (`apps/api/app/channels/`):**

- `base.py`: `InboundMessage` (provider-agnostische dataclass) + `ingest_inbound()` — resolved/maakt de `Contact`, past pairing-regels toe, dedupet op `external_id`, maakt of verlengt de `Signal`-thread en enqueued agent-verwerking. `BlockedContactError` weert geblokkeerde afzenders.
- `email.py`: `normalize_inbound()` voor generieke e-mail-webhookpayloads; `send_via_provider()` verstuurt uitgaand (mock, Gmail API, Outlook Graph via OAuth-tokens van het account).
- `slack.py`: `verify_signature()` (Slack signing secret, v0 HMAC), `normalize_inbound()` voor Events API, `send_message()` via `chat.postMessage`.
- `outbound.py`: `deliver_outbound()` kiest de adapter op basis van `Signal.channel` + `ChannelAccount`; `reply_to_thread` en `/api/email/send` routeren erdoorheen en zetten `send_status`.
- **Contact pairing:** `ChannelAccount.settings_json.require_pairing` zet onbekende afzenders op `pending`; hun threads worden niet door agents verwerkt tot een operator de contact goedkeurt (`PATCH /api/channels/contacts/{id}`). `blocked` contacts worden al bij de webhook geweigerd.
- **Webhooks:** `POST /api/channels/email/inbound/{account_id}` (shared secret) en `POST /api/channels/slack/events/{account_id}` (signature-verificatie + `url_verification`-handshake). CRUD: `/api/channels/accounts`, `/api/channels/contacts`.

**Frontend — één modus, acht secties:**

- De dashboard draait uitsluitend tegen FastAPI: `lib/bokito-api.ts`, `VITE_API_MODE`, `VITE_BOKITO_API_URL`, `lib/bokito-mode.ts` en alle `isBokitoMode()`-branching zijn verwijderd. Transport: `lib/api.ts` (REST helpers `apiGet/apiPost/...`, `workforce*`, auth-flows) + `lib/gateway.ts` (WS). Vite-proxy stuurt `/api/*` altijd naar `VITE_BOKITO_API_URL` (default `http://127.0.0.1:8000`).
- Navigatie: **Home** (Cockpit), **Messages**, **Agents**, **Workspace** (`/workspace`, markdown docs), **Automations** (`/automations`, voorheen Orchestra), **Integrations**, **Govern**, **Settings**. Legacy redirects: `/os` en `/orchestra`.
- Verwijderde frontend-stacks: alle 13+ Project-pagina's en componenten, Custom DB-builder (`components/database`, `DatabaseContext`, enz.), API-console, AI OS canvas-pagina's (`AiOsCanvas`, `AiOsWorkspaceCanvas`, `components/aios`), legacy realtime (`workforce-realtime`), duplicate MCP/integratiepagina's en orphan-pagina's (~35 pagina's totaal).
- Legacy deploy/push scripts and static-host upload flows are removed from `scripts/`. Deploy portal + API via the FastAPI/VPS stack (`README.md`).

### Fase 7 — Native mobiele app (Expo) op het gateway-protocol (afgerond)

**App (`apps/mobile`):** Expo + expo-router (npm workspace `bokito-mobile`; monorepo-aware `metro.config.js`). Donker thema gespiegeld aan de dashboard-tokens (`src/theme.ts`). Backend-URL via `BOKITO_API_URL` in `app.config.ts` (dev: LAN-IP; prod/EAS preview: `https://app.bokito.ai`).

- **Auth:** `POST /api/auth/login` → access token in `expo-secure-store`; sessie-bootstrap via `GET /api/auth/me` (`src/context/AuthContext.tsx`). Logout reset ook de gateway-verbinding.
- **Gateway:** `src/lib/gateway.ts` spreekt hetzelfde typed WS-protocol als het dashboard (`/api/ws?access_token=...&device=mobile`): `sub`/`unsub`/`ping`, event-frames, reconnect met backoff en automatische re-subscribe. Live refresh op topics `threads`, `signal:<id>` en `decisions`.
- **Tabs:** Assistant (Signal-backed chat via `/api/chat/conversations*`), Messages (unified inbox via `/api/signals` met views Open/Mine/Unassigned/Decisions), Decisions (`/api/notifications/decisions` + approve/reject), Settings (account, workspace, API-endpoint, sign out). Thread-detail (`app/thread/[id].tsx`) toont berichten, interne notities en inline decision-kaarten (resolve via `POST /api/signals/{id}/messages/{mid}/resolve`), met reply-composer (`POST /api/signals/{id}/reply`).
- **Push:** `src/lib/push.ts` registreert het Expo-pushtoken via `POST /api/push/subscribe` met endpoint-prefix `expo:` (vereist `extra.eas.projectId` + Firebase `google-services.json` voor standalone APK). Backend `services/push.py` stuurt push bij nieuwe **inbound** thread-berichten en bij decisions met status `awaiting_human` (ontvangers: thread assignee/owner, anders tenant owners/admins). Dispatch loopt fire-and-forget vanuit `gateway/publish.py` (`schedule_notify_thread_message`, `schedule_notify_decision`). Tap op notificatie deep-linkt naar thread of Decisions-tab (`src/lib/notification-routing.ts`).
- **Android APK:** EAS Build profiel `preview` in `apps/mobile/eas.json` (`buildType: apk`, prod API URL). GitHub workflow `.github/workflows/mobile-apk.yml` (handmatig `workflow_dispatch`) bouwt en uploadt een downloadbaar APK-artifact; secrets: `EXPO_TOKEN`, `GOOGLE_SERVICES_JSON`. Setup: `apps/mobile/FIREBASE_SETUP.md`, `apps/mobile/README.md`.
- **Local Android dev build:** `npx expo prebuild --platform android` genereert `apps/mobile/android/`. Gradle wrapper moet **8.13** zijn (9.0 faalt op Windows met `JvmVendorSpec IBM_SEMERU`). Debug APK: `npm run android:build`. Emulator ADB: start AVD met `-skip-adb-auth` (en `-wipe-data` bij stale unauthorized state). Bootstrap: `apps/mobile/scripts/dev-android.ps1`. API bereikbaar via `adb reverse tcp:8000` + `10.0.2.2:8000` in APK build.
- **Autotrading tenant (local):** `SEED_TRADING_TENANT=1 python scripts/seed.py` maakt tenant `autotrading` met user `trader@bokito.ai`, MMXM Trader agent, mock MCP server `Trading pipeline MCP` (`mock://trading`), en interval-trigger `MMXM pipeline scan` (15 min). Echte DeGiro-executie blijft in externe `/opt/trading` stack; per-tenant MCP URL via Integrations.
- **Agent automation (platform):** `create_task` en `delegate_to_agent` tools maken tenant-scoped `AgentTask`s; `orchestration_continue` decisions hervatten workstreams; inbound worker persist + outbound delivery via `inbound_agent.py`; MCP client ondersteunt `api_key` auth + trading mock tools.
- **Mobile E2E (jun 2026, emulator):** Native debug APK + Metro + API via `adb reverse`. Login, Assistant mock chat, Messages (filters/badges/threads), thread detail (Reply/Note composer, widget thread), Decisions (approve/reject) verified. Autotrading tenant: MMXM pipeline scan trigger fires on schedule; manual `trigger-agent` completes against mock MCP.
- **Mobile chat UX (jun 2026):** Assistant and thread streams use a single collapsible `ThinkingTrace` (shimmer headline via MaskedView + LinearGradient; tap to expand step log). Send morphs to Stop while SSE or gateway stream is active. Keyboard: `react-native-keyboard-controller` (`KeyboardProvider`, `KeyboardAwareScrollView` on login, `KeyboardStickyView` composers). Dev client rebuild required after native dep changes (`expo prebuild` + `scripts/dev-emulator.ps1`).
- **Autotrading mobile default agent:** `seed_trading_stack` sets `user_preferences.default_chat_agent_id` to MMXM Trader for `trader@bokito.ai` (MMXM Trader has `chat_access=everyone`). Seeds workspace docs: `company.md`, `persona.md`, `memory.md`, `strategy/mmxm-review.md`. `build_workspace_context` injects `company.md` into every agent system prompt. Prod ops: `scripts/ops/tenants/autotrading/vps-set-trader-default-agent.py` (re-runs `seed_trading_stack` on VPS).
- **Messenger PWA gepensioneerd:** `apps/messenger`, `packages/messenger-ui/embed` en `e2e/messenger.spec.ts` zijn verwijderd; `build:messenger` is uit de root-scripts en CI; docker-compose heeft geen messenger-service meer. In cycle 6 (2026-07) is ook het resterende `packages/messenger-ui` componentenpakket plus de ongebruikte `FloatingMessengerHost` verwijderd; de dashboard-typen (`AuthMeResponse`, `ChatMessage`, `CockpitSummary`, `Conversation`, `PushSubscriptionPayload`) staan nu in `apps/dashboard/src/lib/bokito-api.ts`.
- **CI:** `mobile`-job draait `npx tsc --noEmit` in `apps/mobile`; aparte `Mobile APK`-workflow voor EAS builds.

## 17. Live MVP Deployment (Hostinger VPS, juni 2026)

De 24/7 MVP-test draait op een bestaande Hostinger VPS, naast een al draaiende host-Caddy.

- **Host:** Hostinger VPS `srv859418` (`31.97.45.44`), Ubuntu 24.04, 2 vCPU / 8 GB. Checkout in `/opt/bokito`.
- **Publieke URL:** `https://app.bokito.ai` (Cloudflare A-record → VPS). TLS via host-Caddy.
- **Reverse-proxy:** host-Caddy (`/etc/caddy/Caddyfile`) routeert `app.bokito.ai`, `api.bokito.ai`, `bokito.ai`, `staging.bokito.ai` naar de Docker `web`-container (`127.0.0.1:8088` prod / `:8089` staging). `worker.bokito.ai → :3300` blijft een aparte legacy dienst.
- **Stack:** GHCR images via `docker-compose.deploy.yml` + `scripts/vps-pull-deploy.sh` (zie §17.2). Lokaal bouwen: `docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml up -d --build`.
- **Config:** `/opt/bokito/.env.prod` met `ENVIRONMENT=prod`, `CORS_ORIGINS=https://bokito.ai,https://app.bokito.ai,https://api.bokito.ai`.
- **LLM-modus:** prod draait `LLM_MODE=live` met `ANTHROPIC_API_KEY` in `.env.prod`. Tenants zonder eigen key gebruiken het **Bokito platform-model** (Anthropic via `platform_secrets` of env); resolution: tenant BYOK → platform DB secret → env. Platform key sync: `scripts/vps-fix-prod-llm.py` (catalog refresh + env → `platform_secrets`).
- **Seed:** `docker compose ... exec -T api python scripts/seed.py` maakt tenant `bokito` met admin `admin@bokito.ai` (wachtwoord `bokito-test-password` — na eerste login roteren). De `bcrypt __about__`-melding is een onschuldige passlib-versiewaarschuwing.
- **Healthchecks:** `GET /api/health` (liveness) en `GET /api/health/ready` (diepe check: Postgres + Redis). Geverifieerd over publieke HTTPS samen met een succesvolle `POST /api/auth/login` (JWT geretourneerd).

### 17.1 Cutover naar bokito.ai (juni 2026, geverifieerd live)

Alle Bokito-verkeer loopt via `*.bokito.ai`. **`bokito.chargecars.app` is verwijderd** (geen Caddy-route meer op de VPS; DNS-record in Cloudflare kun je zelf laten vervallen).

- **Cloudflare DNS (zone `bokito.ai` → VPS `31.97.45.44`):** `bokito.ai`, `*.bokito.ai`, `app.bokito.ai`, `api.bokito.ai` (proxied A-records), `worker.bokito.ai` (DNS-only, legacy Node :3300).
- **Cloudflare Workers verwijderd:** geen edge interceptors meer; verkeer gaat rechtstreeks naar de VPS.
- **Control-plane host = `app.bokito.ai`:** dashboard login op `https://app.bokito.ai/login`.
- **Trading-tenant user:** `trader@bokito.ai` (was `trader@chargecars.app`, gemigreerd) — enige owner van tenant `autotrading`.
- **Live verificatie:** `GET /api/health` op `bokito.ai`, `app.bokito.ai`, `api.bokito.ai` → HTTP 200; login via `POST /api/auth/login` met `trader@bokito.ai`.

### 17.2 CI/CD + staging (juni 2026)

- **Pipeline:** push naar `master` triggert `CI` (ruff, pytest, dashboard build, Playwright e2e), daarna workflow `Deploy`: buildx pusht naar GHCR (`ghcr.io/lorenzoboers/bokito-api:<sha>`, `bokito-web:<sha>-staging|prod`), auto-deploy naar staging, smoke test, handmatige GitHub Environment-goedkeuring voor productie, smoke + automatische rollback bij falen. Zie `docs/DEPLOY.md` en `.github/workflows/deploy.yml`.
- **Staging:** tweede Compose-stack op dezelfde VPS (`docker compose -p bokito-staging`, poort `8089`, host-Caddy `staging.bokito.ai`). Aparte DB (`bokito_staging`), Redis en volumes; `LLM_MODE=mock` standaard voor goedkope 24/7 autonomous tests. Seed: `apps/api/scripts/seed_staging.py` → `trader@staging.bokito.ai` / `staging-trader-password`, tenant `autotrading`.
- **Productie project-naam:** blijft `bokito` (niet `bokito-prod`) zodat bestaande volumes behouden blijven. Registry-deploy via `docker-compose.deploy.yml` + `scripts/vps-pull-deploy.sh`.
- **Opgeruimd:** V1 worker-plane deploy-scripts (`vps-redeploy.py`, `deploy-runtime-vps.sh`, Cloudflare Worker workflows) verwijderd. **Rotate** gelekte worker-secrets uit die scripts (zie `docs/DEPLOY.md`).

### 17.3 Autotrading tenant — productie-audit (juni 2026)

UI-audit op `https://app.bokito.ai` als `trader@bokito.ai` (tenant `autotrading`, build `5deed83`).

**Werkt:**
- Login + Communication-inbox; MMXM Trader-thread zichtbaar in sidebar (Assistant / Channels / Agents secties) en threadlijst.
- Berichten sturen naar MMXM Trader (intern kanaal) + live agent-antwoord via platform Anthropic key. **DeGiro execution_mode: live** (`DEGIRO_ALLOW_LIVE_ORDERS=1`), MCP tools bereikbaar; entries gated by AM window 09:45-11:15 NY, SMT, en risk caps.
- Agent library `/agents`: MMXM Trader onder worker agents + Demo Project Orchestrator onder orchestrators.
- Agent-detail via directe URL `/agents/{id}` (MMXM Trader: `e1728c7f-f06d-4ea3-bbe7-1f7781ee9c25`) — model `claude-haiku-4-5-20251001`, autonomy `auto`, chat access `everyone`.
- Orchestration panel: MMXM Trading project gekoppeld aan thread (`project_id` gezet).

**Gaten (lokaal fixen → deploy):**
- **Agent library:** MMXM Trader (`role_slug=assistant`, `kind=company`) ontbrak onder worker agents door te brede `PLATFORM_ROLE_SLUGS`-filter (`assistant` uitgesloten). Fix: filter alleen `personal` kind + orchestrators + `communication` role (`workforce-nav-agents.ts`).
- **Geen agent-antwoord** (opgelost juni 2026): verouderde catalog `model_id`s (`claude-sonnet-4-20250514` retired) + exception handler bug. Fix: catalog → 4.6/4.5/4.8 ids, raw agent model passthrough, `signal_id` vóór rollback loggen. Prod hotfix via `scripts/vps-fix-prod-llm.py`.
- **Orchestration panel:** "No orchestrator linked to this thread's project" — link thread to project via Messages agent panel (PATCH `project_id`) or legacy ops bootstrap `apps/api/scripts/tenants/autotrading/bootstrap.py` (`seed_trading_stack`); VPS: `scripts/ops/tenants/autotrading/vps-setup-trading-project.py`.
- **Self-service integratie-UI (juni 2026):** Webhook panel op Agenda (URL, secret copy/rotate, test ping, env snippet); MCP test connection op `/settings/mcp`; Projects op `/settings/projects`; setup checklist `/integrations/setup`. Zie `docs/EXTERNAL_INTEGRATIONS.md`. Trading bootstrap verplaatst uit `app/services/` naar ops-only `scripts/tenants/autotrading/`.
- **Pipeline smoke:** bestaande thread bevat skip-bericht: trade plan `smoke-nonexistent` / setup `smoke` not found.
- **MCP:** trading MCP draait op VPS als `trading-trading-exec-mcp-1` (poort 8002, endpoint `/mcp`) op Docker-netwerk `bokito_shared`. Bokito `api`/`worker` moeten op dat netwerk zitten (`docker-compose.deploy.yml`). Env: `TRADING_MCP_URL=http://trading-exec-mcp:8002/mcp`, `TRADING_MCP_API_KEY=local-dev-key`. Install: `scripts/ops/tenants/autotrading/vps-configure-trading-mcp-env.py` + `vps-setup-trading-mcp.py`. Prod autotrading tenant heeft actieve `custom_mcp` connection "Trading pipeline MCP" (10 tools bereikbaar vanuit api-container).
- **Bokito bridge (trading lab → MMXM Trader):** Webhook trigger op tenant `autotrading`, agent MMXM Trader. Trading stack env (`/opt/trading/.env`): `BOKITO_ENABLED=1`, `BOKITO_BASE_URL=http://bokito-api:8000`, `BOKITO_TRIGGER_ID`, `BOKITO_WEBHOOK_SECRET`. Prefer dashboard webhook panel voor credentials; legacy ops: `scripts/ops/tenants/autotrading/vps-setup-trading-bokito-bridge.py`; smoke: `vps-trading-webhook-smoke.py`. DNS: `bokito-api` alias op `bokito_shared`; na recreate `vps-ensure-trading-network.py`.
- **Execution ladder (trading stack):** `virtual` < `shadow` < `live`. Prod autotrading draait **live** (`EXECUTION_MODE=live`, `DEGIRO_ALLOW_LIVE_ORDERS=1`, `config.yaml execution.mode: live`). MCP `risk_status` moet `execution_mode: live` en `degiro_allow_live_orders: true` tonen. Enable: `scripts/ops/tenants/autotrading/vps-enable-trading-live.py`; rollback = shadow + recreate. **Netwerk:** na recreate `vps-ensure-trading-network.py`.
- **Reporting loop (juni 2026):** Platform entity `OperationalOutcome` (tenant-scoped) ingests webhook `kind: report` payloads. Autotrading bootstrap seeds: interval scan (15 min), **Trading session digest** cron `0 16 * * *` UTC (MCP poll fallback), **Weekly strategy review** cron `0 18 * * 0` UTC (starts `MMXM strategy review` workstream: Collect / Analyze / Propose / human_gate). Tenant settings: `operations_signal_id` (main Messages thread `847c0b0e-...`), `strategy_workstream_id`, `learning_enabled: true`. Learning worker tick runs `run_tenant_learning_cycle` for enabled tenants (enqueues strategy workstream when eval trends worsen). `WorkstreamRun.report_json` populated on completion. Ops: `vps-sync-deploy-api.py`, `vps-validate-reporting.py`, `vps-validate-strategy-review.py`, `vps-fix-trading-bokito-url.py` (perl fix for `BOKITO_BASE_URL`; must be `http://bokito-api:8000`, not `10.0.2.2`).
- **Prod audit (jun 2026):** MCP 10 tools, `execution_mode: live`, webhook bridge trigger `MMXM pipeline webhook` (`f3e95fe7-...`), internal webhook smoke 200. Trading worker must be on `bokito_shared` after recreate (`vps-ensure-trading-network.py`).
- **Live MVP go-live (29 jun 2026):** Prod hot-patched to commit `52884c9` via `vps-deploy-from-git.py` (GHCR deploy run `28291316890` still awaiting GitHub production approval). Critical fixes: `Trading pipeline MCP` was `mock://trading` — repaired with `vps-fix-trading-mcp-server.py` (real URL + `mmxm-trading` alias); Bokito bridge had `bokito.enabled: false` and empty trigger in `config.yaml` — fixed via `vps-fix-trading-bokito-bridge.py`; trader prompts updated (`scripts/vps-update-trader-live-prompt.py`) to require `server_name: Trading pipeline MCP`. Verified: `risk_status` live + DeGiro allowed; decide webhook → agent calls MCP → **SKIP outside AM window** (04:02 NY) with correct caps/blockers in Messages; strategy review workstream starts on cron fire. External engine `job_ict_tick` skips outside NY hours; real `decide` webhooks fire during NY session when setups pass. First live DeGiro fill expected during AM window 09:45–11:15 NY when engine detects valid SMT setup.
- **Platform LLM keys:** tenants zonder eigen Anthropic-key gebruiken de Bokito platform key (`platform_secrets` of env). API exposeert `chat_key_source` / `embeddings_key_source` (`tenant` | `platform` | `none`); LlmKeysSettings toont "Bokito platform" badge.
- **Settings UI:** prod build `1389b9f` — na web deploy kan Cloudflare/browser oude JS cachen (login footer toont verkeerde build); purge cache of hard refresh. **Providers & models** + **AI keys** onder Settings → AI.
- **Deploy smoke:** `scripts/smoke-deploy.sh` wacht tot `/api/health` ready (6 pogingen) vóór login-check.
- **Infra:** `bokito-web-1` healthcheck gebruikt `http://localhost:80/` (niet Caddy admin `:2019`). Oude check faalde terwijl de site wel bereikbaar was; na patch is container `healthy`.
- **Smoke scripts:** agent-antwoord detectie via `kind=agent_message` / `payload.agent_id` (API serialiseert geen `author_type`). VPS-bypass: `scripts/vps-prod-smoke-local.py` (localhost:8088, omzeilt Cloudflare 403).

**Prod trader login (reset juni 2026):** `trader@bokito.ai` — wachtwoord via `scripts/vps-reset-prod-trader.py` (rotate + sync `PROD_SMOKE_PASSWORD` indien smoke tests moeten matchen).

## 18. Inbox AI-assist (Cyclus 5, juli 2026)

- **AI-modus per kanaal:** `ai_mode` = `suggest` | `auto` | `off`, tenant-breed per kanaal (Settings → AI communication) met per-mailbox overrides. Resolutie in `app/services/channel_ai.py`; toegepast in `workers/tasks.py` (email/Slack) en `livechat_stream.py` (widget). Default: email = suggest, widget = auto.
- **Suggest-flow:** inbound bericht → tool-loze draft → `DecisionRequest` als inline `decision_request`-message in de thread met opties `send` (action_type `send_reply`), `edit` (`draft`), `escalate`. Approve voert `send_reply` uit via `execute_tool` en appendt de outbound reply; escalate pauzeert AI (`ai_paused`) en wijst de operator toe.
- **Decision-events:** aanmaak schrijft `decision_created` (en `suggestion_created`); resolutie schrijft `decision_{action}` (`decision_approve`/`decision_defer`/`decision_reject`). De frontend mag alléén resolutie-events als "resolved" tellen — `decision_created` niet.
- **Contact-naam eigendom:** op externe threads is `contact_name` altijd van de klant; agent-namen mogen alleen op `channel="internal"` threads als contact_name gezet worden (`signal_decisions.py`).
- **Composer AI:** `POST /api/signals/{id}/draft` genereert on-demand een concept (niet persistent); "Draft with AI" prefillt de composer. "Ask assistant" opent een inline assistent-paneel naast de thread (eigen assistant-conversatie, "Copy to composer"). "Send & snooze" verstuurt en zet de thread op `pending`.
- **Next-action chips:** AI-verwerking zet `suggested_actions_json` op de Signal (`close`/`assign`/`create_task`); ThreadDetail toont chips die direct patchen of een agent-taak aanmaken. Let op: `signals-api.ts::normalizeSignalThread` én `inbox-api.ts` moeten `suggested_actions` mappen.
- **Takeover:** "Take over from AI" pauzeert AI op de thread (widget stream antwoordt dan met `ai_paused: true` zonder reply) en wijst de operator toe; "Hand back to AI" hervat.
- **Dev-gedrag:** mailboxen uit de mock-OAuth-flow (geen `access_token`) versturen store-only in non-production (`channels/email.py`); in prod blijft dat `failed:no_credentials`. De mock-LLM maakt alleen nog een `create_decision_request` tool-call als de gebruikerstekst "decision"/"approval" bevat (max 1×), zodat auto-replies geen spurieuze decisions produceren. Zonder Redis verwerkt `enqueue_signal_processing` signalen inline in-process.

## 19. Communicatie-UX, user management en inbox-ops (Cycli 8-15, juli 2026)

### User management & transactional mail
- **Transactional mail:** `app/services/transactional_mail.py` verstuurt invites, wachtwoord-reset en e-mailverificatie via SMTP; zonder SMTP-config logt de dev-fallback de mail (incl. link) naar de console.
- **Invite-flow:** invites bevatten `invited_by_user_id`, genereren een accept-link en worden per mail verstuurd. De accept-invite pagina maakt het account aan en logt direct in.
- **Password recovery & e-mailwissel:** reset-tokens en e-mailverificatie lopen via dezelfde mailservice; users kunnen rol wijzigen, verwijderd worden en hun e-mail veranderen (met verificatie).

### Mentions, notificaties en inline agents
- **Mentions:** berichten ondersteunen `@[Name](user:ID)` en `@[Name](agent:ID)` markup (`lib/mentions.ts`, `MentionPopover`). User-mentions genereren in-app notificaties (respecteren notificatie-voorkeuren).
- **Inline agent-invocatie:** een agent taggen in een thread met instructie levert een note of reply-suggestie in dezelfde thread op; Ask-assistant-conversaties kunnen gegrond worden in het transcript van een klantthread (`context_signal_id` op Signal).

### Inbox-operaties (Cyclus 12)
- **Zoeken:** full-text over subject, contact e-mail/naam en message-bodies.
- **Snooze:** `snoozed_until` op Signal; `wake_snoozed_threads` (scheduler) heropent verlopen snoozes en markeert ze ongelezen. Composer heeft "Send & snooze" met duurpresets; nav heeft Snoozed- en Spam-queues.
- **Bulk-acties:** `POST /api/signals/bulk` (close/reopen/spam/read/unread/assign) met selectie-checkboxes en `BulkActionsBar` in de threadlijst.
- **Saved replies:** `SavedReply` model + CRUD, picker in de composer en beheer in Inbox-settings.

### Contacts & agent-lifecycle (Cyclus 13)
- **Contacts:** aanmaken/verwijderen via `POST /api/channels/contacts` en `DELETE /api/channels/contacts/{id}`; statusfilter-chips (approved/pending/blocked) en een "New contact"-dialog op de Contacts-pagina.
- **Agent archiveren:** `DELETE /api/workforce/agents/{id}` zet `kind="archived"` (soft delete). De default assistant (slug `assistant`) en de laatste assistant-rol agent kunnen niet gearchiveerd worden.
- **Passport-editing:** `PATCH /api/govern/passports/{agent_id}` wijzigt `autonomy_level`, `allowed_tools` en `permission_scopes` (admin/owner, met audit-event). Agent-detail heeft Wake/Pause, Archive en een autonomy-dropdown.

### Widget-kern (Cyclus 14)
- **Pre-chat form:** anonieme bezoekers kunnen naam/e-mail invullen; `POST /api/livechat/session/identify` upsert een widget-Contact en zet `contact_name` op de Signal. Identiteit wordt in localStorage bewaard.
- **Office hours:** per-tenant schema (dagen, start/eind, timezone) met offline-boodschap; buiten kantooruren toont de widget een offline-banner. Configuratie via `GET/PUT /api/settings/widget` (dashboard: Messenger → Availability).
- **Widget-prefs:** voorkeuren van ingelogde users persist in `User.settings_json`; anonieme bezoekers gebruiken localStorage. Tenant-fallback voor de widget is in productie uitgeschakeld (expliciete tenant-subdomain vereist).

### Consistentie (Cyclus 15)
- Alle UI-strings buiten `locales/` zijn Engels; NL leeft alleen in de `nl`-locale files. `PageContent` is de canonieke breedte-wrapper (Cockpit, Contacts). Non-admin redirects op agent-pagina's gaan direct naar `inboxPath('all')` in plaats van de legacy `/messages`-redirect.
- Assistant-widget settings leven op `/ai/assistant/:audience/:section` (`lib/assistant-settings-path.ts`); het oude Nederlandse pad `/ai/assistent/*` redirect naar het default pad. De Availability-sectie (pre-chat form, office hours, offline message) staat op de "Agent settings"-tab.

## 20. Gap-fill cycli 16-19 (juli 2026)

### Demo-blocking bugfixes (Cyclus 16)
- Cockpit telt pending Govern-changes via `listGovernChanges().items.length` (was altijd 0 door response-shape).
- Legacy `/integrations/*` redirects behouden `location.search` (OAuth/query); helpers wijzen naar `/settings/marketplace` en `/settings/integrations`.
- Agenda triggers: target verplicht (geen "No specific target"), `kind` op PATCH, Automations Refresh werkt, `no_agent` toast i.p.v. succes, calendar-edit toont fout bij ontbrekende trigger.

### Eerlijke settings (Cyclus 17)
- Require-2FA toggle verwijderd (flag bleef zonder handhaving).
- Notificatie-prefs: alleen in-app (desktop); Email/Mobile kolommen weg.
- UI-taal is persoonlijk (`GET/PATCH /api/me/preferences` → `User.settings_json.ui_language`), niet workspace-Save.
- Branding Delete wist server-side via `clear_logo` / `clear_favicon` form fields.
- Integration setup "Link a thread" checkt echte threads met `projectId`.

### Orchestratie & Govern (Cyclus 18)
- Automations: workstream Create UI; dode Settings-tab (orchestra_enabled badge) verwijderd.
- Govern: Rollback op history; Passports empty-state + link naar agent detail.

### Onboarding (Cyclus 19)
- Company-stap CTA gaat naar `/knowledge` (company.md bewerken); voltooiing ook als doc na bootstrap is opgeslagen (`updated_at > created_at`).

## 21. Workstream steps (Cyclus 20, juli 2026)

- Automations → Workstreams: expandable rows tonen steps; Add step (naam + agent); Create workstream maakt automatisch Step 1 met de default assistant.
- Run is disabled zonder steps; API `POST /orchestration/workstreams/{id}/run` retourneert 400 met duidelijke detail als er geen steps zijn.
- Na een geslaagde Run springt de UI naar de Runs-tab.

## 22. Workstream Run → Messages (Cyclus 21, juli 2026)

- Elke workstream-run heeft een interne `Signal` thread (`AgentTask.signal_id`).
- Automations → Runs: Open linkt naar `/communication/runs/all/t/{signal_id}`.
- Toast na Run biedt actie "Open in Messages" wanneer `signal_id` aanwezig is.
- `useThreadDetail` negeert stale fetches bij thread-switch (generation counter + useLayoutEffect clear) zodat deep links en list-clicks niet de vorige conversation blijven tonen.

## 23. UX audit fixes (juli 2026)

- Orchestration runner spiegelt step output als `status_update` en completion als `task_result` naar de gekoppelde Signal-thread.
- Create task vanuit een thread stuurt `signal_id` mee zodat de taak in dezelfde conversation blijft.
- Dutch leftovers op inbox surfaces: mailbox status/routing labels, sync "Last sync", Timeline "Sender", ThreadDetail "Internal".
- Empty mailbox CTA → Channel settings; empty thread copy onderscheidt email vs agent channels.
- Takeover failures tonen een toast; Active task in context panel linkt naar Activity; notifications zonder target routen naar een zinvolle surface.
- Activity → Decisions (en Cockpit Awaiting decision) is niet meer beperkt tot `folder=internal`, zodat e-mail/widget decisions ook zichtbaar zijn.
- Always-allow op thread decisions zet `tool_overrides` via `always_auto` (label EN: Always allow).
- Settings → Knowledge gaat naar `/knowledge`; Help Centers hernoemd naar Document index.
- Contacts empty state onderscheidt load-error, no matches, en echt leeg.

## 24. Channel bindings + approval loop (Cyclus 22, juli 2026)

- **Channel bindings UI** op Settings → Communication agent (`ChannelBindingsPanel`): list/create/delete via `GET/POST/DELETE /api/channels/bindings`; routes inbound channel → agent (fallback blijft default assistant).
- **`write_doc` / platform-change ask-mode** landt als `decision_request` in Messages: `propose_platform_change(..., signal_id=)` + `append_decision_to_signal` (zelfde thread wanneer de agent een `signal_id` heeft, anders een nieuwe Activity-thread).
- Workstream **human_gate** steps: UI kan Approval gate toevoegen (geen agent vereist); runner spiegelt de gate-decision altijd naar Messages (`signal_id` of nieuwe Activity-thread).
- Widget embed default slug is `assistant` (`DASHBOARD_CHAT_AGENT_SLUG` / `VITE_DASHBOARD_CHAT_AGENT_SLUG`), aligned met tenant bootstrap.
- Saved replies in de composer tonen toast bij load/save failures (en success bij create).

## 25. Silent-fail + sync + Govern link (Cyclus 23, juli 2026)

- Composer send/note/upload failures toasten; `useThreadDetail` reply/note/patch rethrowen errors i.p.v. stil te slikken.
- Channel settings: **Sync now** (`POST /api/email/sync`) op page header + per-mailbox Sync; `SyncStatusPanel` heeft Sync now + EN datumlocale.
- Signature/routing load+save tonen success/error toasts (dialog blijft open bij save-fout).
- Govern drafts: `signal_id` via linked DecisionRequest; **Open in Messages** → Activity awaiting-decision thread.
- Workstream steps: `DELETE /api/orchestration/workstreams/{id}/steps/{step_id}` + trash control in AutomationsPanel.
- Contact panel: load/notes/status save failures toasten.

## 26. Feedback loop polish (Cyclus 24, juli 2026)

- Contacts detail: load/save/status/delete toasts (geen stille failures meer).
- Ask Assistant "Copy to composer" toont success toast.
- Decision cards: success toast per actie (Reply sent / Escalated / Rejected / approved / deferred).
- Knowledge (`WorkspaceDocs`): save/create/delete toasts + visible editor error; delete wrapped in try/catch.

## 27. Orchestration inline continuation + gate resume (Cyclus 25, juli 2026)

- `enqueue_agent_task_segment` returns `False` in mock mode or when Redis is unreachable. Every continuation point now falls back to inline execution: the runner's next-step/retry/eval-fail advances call `run_agent_task_segment` recursively, and `resume_agent_task` runs the segment inline when enqueue fails. Before this, multi-step workstreams stalled at `running` forever without an ARQ worker.
- Approved human gates are recorded in task context as `passed_gates` (list of step ids). `resume_agent_task` appends the current step id when `pause_reason == "human_gate"`; the runner skips gates in `passed_gates` and advances to the next step (or completes the task). Without this, a resumed task re-entered the gate and created a duplicate decision, looping forever.
- `POST /api/orchestration/tasks/{id}/resume` no longer enqueues a second segment; `resume_agent_task` owns execution (fixes double-run when Redis is up).
- Verified live end to end: run gated workstream → step output mirrored in Messages → decision card (Continue/Reject) → Continue completes remaining steps; Govern pending draft → "Open in Messages" → Approve → `workspace_doc` change applied and visible on the Knowledge page.
- The uvicorn `--reload` watcher can silently die on Windows dev; if code changes seem ignored, check whether the worker process start time predates the file mtime and restart the server.
- Timeline fallback author labels are English ("You" / "Team member"); Dutch strings live only in `locales/nl/`.

## 28. Sync status, folder selection, onboarding fix (Cyclus 26, juli 2026)

- `GET /api/signals/sync-status` is implemented (was a stub returning `[]`): it reports each Gmail/Outlook `ChannelAccount` with `status` (`connected` | `paused` | `needs_auth` | `error`), `last_sync_at`, `last_error`, cumulative `messages_synced`, and per-folder rows. The inbox Sync status panel now reflects reality.
- Mailbox folder selection exists: `GET/PUT /api/email/connections/{id}/folders`. The selection is stored in `ChannelAccount.settings_json` under `sync_folders`; the default set is Inbox (selected) plus Sent/Archive/Spam. Only the Inbox is actually polled today — the stored selection is intent for future multi-folder sync. PUT rejects selections with zero folders selected.
- `sync_account` records failures in `settings_json.last_error` (auth expiry, provider errors) and accumulates `messages_synced` on success; success clears `last_error`.
- Onboarding "company profile" step no longer shows done on fresh tenants: `WorkspaceDoc` rows created via `upsert_doc` now get identical `created_at`/`updated_at` (previously two separate `utcnow()` default factories differed by microseconds, which the "explicitly saved after bootstrap" heuristic misread). The onboarding check also tolerates up to 1s skew for older rows.
- Dead frontend route constants removed (no backend, no consumers): `appRoutes.docs`/`appRoutes.backlog`, `agentsRoutes.presets`, `integrationsRoutes.platform.workerCredentials`/`workerMcpCredentials`/`mcpOAuthRefresh`, the whole legacy `integrationsRoutes.inbox` block, `messagesRoutes.byId`/`thread`, and `lib/docs-api.ts`. Route audits can be repeated by diffing `apps/dashboard/src/api/routes/*.ts` literals against `/openapi.json`.

## 29. Accountancy client readiness (Cyclus 27, augustus 2026)

- **Grounded suggest mode**: suggest-mode inbound processing (`process_inbound_signal`) no longer runs toolless. Agents get the read-only research set `SUGGEST_MODE_TOOLS` (`search_index`, `list_docs`, `read_doc`, `get_tenant_overview`, `call_mcp_tool`, `create_decision_request`) and a prompt that instructs: research first (KB + connected MCP), then either return a reply draft (becomes the suggestion card) or raise a custom decision via `create_decision_request`. When the agent creates its own decision during the run, the automatic reply-suggestion card is suppressed (no double cards).
- **Free-text decision options**: decision options support `input_type: "text"` (+ `input_placeholder`). The card UI shows a textarea; the answer is sent as `response_text` on `POST /api/signals/{sid}/messages/{mid}/resolve`, recorded on the `decision_{action}` SignalEvent payload, and appended to the thread as a user message with metadata `{decision_response: true, option_id}`. Plain option clicks still add no extra chat message.
- **MCP tool discovery cache**: `McpServer` has `tools_json` + `tools_synced_at`. `POST /api/integrations/mcp/{id}/test` persists the `tools/list` result; `POST /api/integrations/mcp/install` runs discovery best-effort and returns it under `discovery`. `GET /api/integrations/mcp/servers` includes `tools` and `tools_synced_at`. The tenant snapshot prompt (`tenant_introspection`) lists each active MCP server with cached tool names and the `call_mcp_tool` calling convention (snapshot cap raised to 1600 chars).
- **Björn Lundén sandbox**: MCP servers whose name matches bjorn/lunden/king/account get a mock accounting toolset (`search_customers`, `get_customer`, `list_invoices`, `get_invoice`, `list_ledger_entries`, `get_account_balance`, `list_vat_reports`) on `mock://` URLs, with realistic SEK mock responses in `mcp_client`. Superseded 2026-08 by the **native BLA integration** (`native://bjorn-lunden`, see "Björn Lundén — native integratie"); the sandbox remains the dev fallback when no credentials are configured.
- **MCP auth**: `mcp_auth_headers` supports `bearer_token`, `api_key`, and a custom `headers` dict passthrough. `install_mcp` accepts an `auth` object and persists it in `auth_json`; the frontend sends `{bearer_token, auth_type}` when bearer is selected.
- **Per-tool allowance overrides in Govern**: the allowance sliders card lists each gated tool under its category with a Default/Deny/Ask/Allow control wired to `PUT /api/govern/tool-overrides`. Setting `call_mcp_tool` to Allow lets inbound research agents query MCP without an approval card (the "Always allow" decision option already did the same).
- **Routing rules on ingest**: `ingest_inbound` (email sync + webhook path) now applies `EmailRoutingRule` labels/assignee on newly created email signals — previously only manual `create_inbound_signal` did.
- **OAuth callback fix**: `complete_oauth` captured `expires_at`/`redirect_uri`/`tenant_id` only after deleting the state row (expired ORM attrs on async session → crash on the error path). All fields are captured before delete now. Dev `.env.example` documents the `MICROSOFT_OAUTH_*` / `GOOGLE_OAUTH_*` / `GITHUB_OAUTH_*` naming.
- **Dev pitfall**: uvicorn `--reload` on this Windows setup can hang on "Reloading..." and a stale process can keep serving old code on port 8000 while a new instance claims to start. Check `Get-NetTCPConnection -LocalPort 8000` and kill strays; prefer running dev without `--reload` and restarting manually. Live smoke: `apps/api/scripts/smoke_cycle27.py` (login → BL install + discovery → mock inbound → decision card on thread).
