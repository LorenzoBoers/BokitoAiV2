import type { BlockOp, DocBlockType, DocPageRow, InlineRun } from './doc-api'
import { applyWorkspaceBlockOps, listWorkspacePageBlocks } from './workspace-doc-api'
import { WORKSPACE_DOC_SCAFFOLD_PAGES } from './workspace-doc-scaffold'

/** Bump when handbook content changes so tenants receive an update on next load. */
export const COMPANY_HANDBOOK_VERSION = 'v2'

type BlockSeed = {
  type: DocBlockType
  text: string
  props?: Record<string, unknown>
}

function runs(text: string): InlineRun[] {
  return [{ text }]
}

function p(text: string): BlockSeed {
  return { type: 'paragraph', text }
}

function h2(text: string): BlockSeed {
  return { type: 'heading_2', text }
}

function h3(text: string): BlockSeed {
  return { type: 'heading_3', text }
}

function callout(text: string): BlockSeed {
  return { type: 'callout', text, props: { tone: 'info', icon: 'Info' } }
}

function bullet(text: string): BlockSeed {
  return { type: 'bullet_list_item', text }
}

/** Handbook body blocks per scaffold page slug (heading_1 added separately). */
export const COMPANY_HANDBOOK_BLOCKS: Record<string, BlockSeed[]> = {
  overview: [
    callout(
      'Bokito company handbook — high-level reference for the platform. English. Last updated May 2026. Detailed repo mirror: docs/company/ in the monorepo.',
    ),
    p(
      'Bokito is an AI operations platform for small and medium businesses. It combines a tenant-scoped web portal, background AI workers, team inbox, integrations, and customer-facing channels (chat widget and mobile app) into one product shell.',
    ),
    h2('What the platform does'),
    bullet('Deploy AI agents that work on real projects with human approval loops'),
    bullet('Centralise team communication, documentation, and agent messages'),
    bullet('Connect external tools (GitHub, email, MCP servers) as agent context'),
    bullet('Serve customers via embeddable web chat and a mobile app'),
    bullet('Isolate each customer organisation on its own subdomain and data scope'),
    h2('Four applications'),
    bullet('Dashboard (portal) — React web app for admins, operators, and project owners'),
    bullet('Mobile app — Expo (React Native) for end users: conversations and agent schedules'),
    bullet('Chat widget — TypeScript embed (bokito-chat.js) for website visitors'),
    bullet('Marketing website — static site for prospects (apps/website)'),
    h2('Core architecture (one sentence each)'),
    bullet('Xano — API, database, auth, agents, MCP servers, static hosting for the portal build'),
    bullet('Runtime worker (VPS) — BullMQ queues, Docker agent containers, repo indexing, doc reindex'),
    bullet('Cloudflare — wildcard DNS, tenant router worker, app passthrough for control plane'),
    bullet('Ollama on VPS — local embeddings for agent retrieval in containers'),
    h2('Two Blueprint layers'),
    bullet('Workspace Blueprint (this section at /projects/docs) — tenant-wide handbook for operators and agents'),
    bullet('Project Blueprint context — project-specific blocks/change requests consumed by PO and workstreams'),
    bullet('Repo handbook (docs/company/) — engineering onboarding; mirrored here at high level'),
    bullet('BOKITO_KNOWLEDGE.md — living agent log with incremental Dutch/English product notes'),
    h2('Monorepo layout (GitHub: BokitoAI/Bokito-AI)'),
    bullet('apps/dashboard — portal UI'),
    bullet('apps/chat-widget — embeddable widget bundle'),
    bullet('apps/runtime — Node worker on worker.bokito.ai'),
    bullet('apps/mobile — Expo app'),
    bullet('cloudflare-workers — bokito-tenant-router, bokito-app-passthrough'),
    bullet('xano-patches — XanoScript patches, tables, crons, verification docs'),
    bullet('packages/shared, packages/docker/agent-run — shared types and agent runner'),
    h2('Handbook pages in this tree'),
    bullet('Overview — platform snapshot (this page)'),
    bullet('Vision and audience — who we serve and product principles'),
    bullet('Features and scope — every portal module at high level'),
    bullet('Brand and voice — copy, i18n, and agent tone rules'),
    bullet('Tech stack — infrastructure, APIs, data model, deploy'),
    bullet('Marketing — widget, mobile, and customer-facing channels'),
    bullet('Operations — tenancy, workforce, inbox, runbooks'),
    bullet('Roadmap — integrations catalog and upcoming modules'),
    h2('Internal tenant'),
    p(
      'Bokito organisation uses subdomain slug bokito. Production: https://bokito.bokito.ai. Local dev: http://bokito.localhost:5174. Control plane: app.bokito.ai (or app.localhost in dev).',
    ),
  ],

  'vision-and-audience': [
    callout('Strategic direction and audiences. High level — not a marketing pitch.'),
    p(
      'Bokito targets SMBs that need AI embedded in daily operations: not a standalone chatbot, but orchestrated workers tied to projects, Blueprint context, inbox, and external systems — with humans in the loop for sensitive decisions.',
    ),
    h2('Primary audiences'),
    bullet('Tenant admins — workspace setup, integrations, members, branding, agent configuration'),
    bullet('Operations managers — inbox triage, workforce runs, project health, Blueprint alignment'),
    bullet('Project owners — per-project orchestration, change requests, repo linking'),
    bullet('End users — mobile app, inbox participation, limited project access'),
    bullet('Website visitors — public chat widget on customer sites'),
    bullet('Engineers — monorepo, Xano patches, runtime deploy, Cloudflare workers'),
    h2('Typical use cases'),
    bullet('Software/project delivery — GitHub-linked repos, orchestrator, change queue, doc updates'),
    bullet('Customer support — team inbox, AI draft replies, widget on marketing site'),
    bullet('Professional services — workspace docs as SOPs, agents reading locked policy pages'),
    bullet('Accounting/adjacent — Bjorn Lunden MCP and custom MCP for domain tools'),
    h2('Platform principles'),
    bullet('Tenant isolation — data and auth scoped per organisation subdomain'),
    bullet('Human-in-the-loop — agents propose; humans approve decisions and sensitive writes'),
    bullet('Blueprint as context — workspace and project Blueprint feed retrieval and agent prompts'),
    bullet('Single product shell — primary rail + context sidebar across all modules'),
    bullet('Same-origin API on tenant hosts — Cloudflare workers proxy /api/{group} to Xano'),
    bullet('No emoji in product UI — professional plain text and Lucide icons'),
    h2('Control plane vs tenant hosts'),
    bullet('Control plane (app.*) — login, workspace hub, billing, account; pick a tenant'),
    bullet('Tenant hosts (<slug>.*) — full product: home, projects, inbox, assistant, integrations'),
    bullet('Cross-host session — refresh cookie on .bokito.ai plus one-time __bokito_at__ token hash'),
    h2('What Bokito is not (today)'),
    bullet('Not a generic no-code database product — Data module is stubbed'),
    bullet('Not a full analytics suite — analytics rail item not live'),
    bullet('Not multi-region self-serve — single Xano instance + one VPS worker plane'),
  ],

  'features-and-scope': [
    callout('Dashboard and workspace capabilities. In scope today unless marked stub or coming soon.'),
    h2('Shell and navigation'),
    bullet('Primary rail (icons): Home, Inbox, Workspace, Workforce, Integrations, Data (disabled), Settings'),
    bullet('Context sidebar — section-specific links; badges for unread inbox and awaiting-human messages'),
    bullet('Landing: tenant admins → /home; end-users → project-aware redirect; control plane → workspace hub'),
    bullet('i18n: English and Dutch via i18next (locales in apps/dashboard/src/locales)'),
    bullet('Theme: dark/light toggle, stored in localStorage (bokito-portal-theme)'),
    h2('Home (/home)'),
    bullet('Recent projects, inbox shortcuts, recent agent runs'),
    bullet('No context sidebar — overview dashboard only'),
    h2('Inbox (/support/inbox/*)'),
    bullet('Queue-based team inbox: All, Open, Mine, Unassigned, and custom queues'),
    bullet('Thread detail, assignment, labels, mark read/unread'),
    bullet('Footer link to inbox and email settings under Assistant/Settings'),
    bullet('Email sync via Outlook/Gmail OAuth (integrations marketplace)'),
    h2('Workspace hub (/projects)'),
    bullet('Overview — project list, decisions, recent activity, background worker strip'),
    bullet('Communication — cross-project agent and team messages'),
    bullet('Blueprint — tenant-wide planning surface at /projects/docs (this handbook)'),
    bullet('Workstreams — per-project status in sidebar (Working, Attention, Blocked)'),
    bullet('Create project wizard — name, scope, optional GitHub connect'),
    h2('Per-project cockpit (/project/:id/*)'),
    bullet('Overview — project summary, repo index status, quick actions'),
    bullet('Orchestration — PO wake frequency, autonomy mode, human-in-the-loop sensitivity'),
    bullet('Communication — project-scoped messages and agent threads'),
    bullet('Workforce history — filtered agent runs for this project'),
    bullet('Token usage — runs count, tokens, budget summary'),
    bullet('Notifications — per-event channel matrix (desktop, email, mobile)'),
    bullet('Request a change — doc change requests that wake the orchestrator'),
    bullet('Settings — project name, autonomous scope, repo connection, archive'),
    bullet('Legacy aliases /project/:id/doc[/:slug] and /project/:id/pkb redirect to /projects/docs during migration'),
    h2('Workspace Blueprint (/projects/docs)'),
    bullet('Block-based Notion-style editor: headings, paragraphs, bullets, callouts, code, etc.'),
    bullet('Page tree — add, rename, reorder, delete pages; inline title edit'),
    bullet('Lock/unlock pages — locked pages block agent writes'),
    bullet('Revision history — audit trail with revert'),
    bullet('Ask agent — creates change request for active page'),
    bullet('Flat top-level pages; sections are blocks inside pages'),
    bullet('Indexed for search via runtime doc reindex (index_chunks)'),
    h2('Workforce (/workforce/*, compatibility /ai/*)'),
    bullet('Assistant configuration — team (internal) vs public (external) audiences'),
    bullet('Communication agent settings — /ai/communicatie'),
    bullet('Agents — canonical list at /workforce/agents (alias /ai/agents), detail and live run log at /ai/agents/:id/runs/:workLogId'),
    bullet('Orchestrators — /workforce/po, project workstreams — /project/:id/overview'),
    bullet('Legacy redirects: /admin/runs and /workforce → /workforce/agents'),
    h2('Integrations (/integrations/*)'),
    bullet('Connected — default landing; manage active connections by type'),
    bullet('Marketplace — discover and connect new providers'),
    bullet('MCP — external servers and Bokito MCP client preview'),
    bullet('API keys — developer keys (hidden in nav until live)'),
    bullet('Sources (/integrations/sources) — read-only indexed docs preview'),
    h2('Settings (/settings/*)'),
    bullet('Personal — profile, notification preferences (local draft matrix)'),
    bullet('Workspace — general, branding (subdomain required), members and teams, billing, access'),
    bullet('Company config — tone, brand values, agent persona, StyleScanner from website URL'),
    bullet('Inbox/email — mailbox management under settings/support paths'),
    h2('Workspaces hub (control plane)'),
    bullet('Routes: /, /billing, /support, /account on app.* host only'),
    bullet('Create workspace with required subdomain (3–63 chars, a-z0-9-)'),
    bullet('Open workspace → cross-host redirect to https://<slug>.bokito.ai/home'),
    h2('Stub or out of scope'),
    bullet('Data module (/database) — rail disabled; redirects to /projects'),
    bullet('Analytics — not in active navigation'),
    bullet('Cloud Agents (/cloud-agent) and Agent Canvas (/agent-canvas) — design/experimental routes'),
    bullet('Some messenger agent settings — UI state; save not fully wired to backend'),
  ],

  'brand-and-voice': [
    callout('How Bokito sounds and looks in product copy, docs, and customer channels.'),
    h2('UI copy rules'),
    bullet('Professional plain text — no emoji in labels, tooltips, logs, or generated copy'),
    bullet('Use Lucide icon components for visual cues instead of emoji'),
    bullet('Prefer short labels: Active, Paused, Working, Blocked, Config — not playful slang'),
    bullet('Empty states explain what to do next, not marketing fluff'),
    bullet('Errors show actionable messages; hide raw HTTP paths from end users'),
    h2('Languages'),
    bullet('Dashboard: English (en) and Dutch (nl) via i18next'),
    bullet('Preference key: bokito-language in localStorage'),
    bullet('Locale files: apps/dashboard/src/locales/{en,nl}/nav.json and feature namespaces'),
    bullet('Widget and mobile may follow agent language settings (NL/EN/Auto)'),
    h2('Documentation style'),
    bullet('Present tense for product behavior: "Users can…", "The system…"'),
    bullet('Mark stubs and roadmap items explicitly'),
    bullet('High-level in workspace docs; deep dives stay in repo (apps/dashboard/docs/, xano-patches/)'),
    bullet('Agents treat locked doc pages as read-only context'),
    h2('Visual design (portal)'),
    bullet('Featurebase-inspired shell: floating panels, soft borders, dense information'),
    bullet('Token hierarchy: bg → bg-sidebar → bg-surface → bg-elevated'),
    bullet('Shared primitives: PageContent, PageIntro, EmptyState, LoadingBlock, Card'),
    bullet('Rail shows Bokito logo; theme-aware rendering dark vs light'),
    h2('Tenant branding'),
    bullet('Logo, primary color, fonts configured under Settings → Workspace → Branding'),
    bullet('Tenant logo on sidebar card from GET /auth/me tenant object'),
    bullet('Widget theme via agent_config.theme — accent, atmosphere, launcher position'),
    bullet('Company config: tone of voice (6 presets), brand values, agent greeting and persona'),
    h2('Customer-facing voice'),
    bullet('Public widget — configured under Assistant → Public (external) → Customization'),
    bullet('Internal team widget — Assistant → Team (internal); embedded in portal for logged-in users'),
    bullet('System prompt and welcome message drive widget personality'),
    bullet('Handoff rules and reply style in Agent settings tab (partial save wiring)'),
    h2('Agent context from docs'),
    bullet('Workspace docs — organisation-wide policies and this handbook'),
    bullet('Project docs — project scope, tech stack page, roadmap for that delivery'),
    bullet('Change requests require human-readable description; agents attach change_note on writes'),
  ],

  'tech-stack': [
    callout('Languages, hosting, deploy, APIs, and data — high level. See docs/company/09 and 10 for detail.'),
    h2('Frontend'),
    bullet('Portal: React 18, TypeScript, Vite, Tailwind CSS, React Router'),
    bullet('Widget: TypeScript, Vite IIFE bundle → dist/bokito-chat.js'),
    bullet('Mobile: Expo, React Native, livechat SSE streaming'),
    bullet('API pattern: env in api.config.ts; paths in apps/dashboard/src/api/routes/; transport in lib/xano.ts'),
    h2('Backend (Xano)'),
    bullet('PostgreSQL database, REST API groups, built-in auth, AI agents, MCP servers'),
    bullet('Static hosting for portal build (bokitoapp-prod / bokitoapp-dev hosts)'),
    bullet('Crons: email sync, run reaper, MCP token refresh, PO heartbeat triggers'),
    h2('API groups (canonical paths /api/{group}/…)'),
    bullet('auth — login, refresh, me, logout, tenant-scoped legacy docs'),
    bullet('app — workspaces, members, invites, inbox threads, organisation settings'),
    bullet('workforce — projects, work_logs, messages, workspace doc, project doc, runs'),
    bullet('integrations — OAuth, connections, MCP install, worker credentials, doc worker plane'),
    bullet('livechat — widget session, streaming, mobile chat'),
    h2('Worker runtime (VPS)'),
    bullet('Host: worker.bokito.ai — Caddy TLS → Node on 127.0.0.1:3300'),
    bullet('BullMQ + Redis — job queues for agent runs, repo index, doc reindex'),
    bullet('Docker — agent containers with Ollama on host.docker.internal:11434'),
    bullet('Deploy: scripts/deploy-runtime-vps.sh or scripts/vps-redeploy.py'),
    bullet('Inbound auth: Bearer WORKER_INBOUND_SECRET; outbound: worker_api_key in POST bodies to Xano'),
    h2('Cloudflare edge'),
    bullet('Wildcard DNS *.bokito.ai → tenant router worker'),
    bullet('bokito-tenant-router — tenant static + /api/* proxy to Xano origin'),
    bullet('bokito-app-passthrough — control plane app.bokito.ai → bokitoapp-prod static host'),
    h2('Key environment variables'),
    bullet('Dashboard build: VITE_XANO_BASE_URL, VITE_API_GROUP_*, VITE_APP_CONTROL_PLANE_HOST, VITE_TENANT_ROOT_DOMAIN'),
    bullet('Runtime: WORKER_BASE_URL, WORKER_INBOUND_SECRET, XANO_WORKER_API_KEY, REPO_CLONE_DIR'),
    bullet('Deploy portal: XANO_METADATA_API_KEY, XANO_DASHBOARD_STATIC_HOST_NAME, deploy.ps1 at repo root'),
    h2('Documentation data model'),
    bullet('Workspace: workspace_docs → workspace_doc_pages → workspace_doc_blocks → workspace_doc_block_revisions'),
    bullet('Project: project_docs → doc_pages → doc_blocks → doc_block_revisions + doc_change_requests'),
    bullet('Search: index_chunks with source_type doc_block, doc_page_summary, repo_file, tenant_doc_section'),
    h2('Tenancy tables'),
    bullet('organisation — tenant record with livechat_settings.subdomain'),
    bullet('tenant_membership — user_id, tenant_id, role, status (replaces single organisation_id)'),
    bullet('user — platform users; extended profile fields'),
    h2('Workforce tables'),
    bullet('projects — name, autonomous_scope, repo fields, index status'),
    bullet('work_logs — agent runs (status: pending, running, completed, failed)'),
    bullet('messages — task_result, decision_request, status_update, channels internal/external'),
    bullet('agents — Xano-hosted agent definitions, tools, system prompts'),
    h2('Integrations tables'),
    bullet('integration_hosts → integration_providers → integration_connections → integration_bindings'),
    bullet('email_oauth_connection — parallel path for mailbox OAuth'),
    h2('Deploy pipeline (portal)'),
    bullet('npm run build:static in apps/dashboard'),
    bullet('npm run build in apps/chat-widget; merge to dashboard/dist/chat-widget/'),
    bullet('deploy.ps1 — zip upload to Xano static host, activate dev or prod env'),
    bullet('UI shows build version on login footer and user menu (VITE_APP_VERSION)'),
    h2('Reference docs in repo'),
    bullet('xano-patches/v1-platform-tables.md — full V1 table list'),
    bullet('xano-patches/v1/CRONS.md — scheduled tasks'),
    bullet('xano-patches/v1/VERIFICATION.md — platform smoke checklist'),
    bullet('apps/dashboard/docs/API.md — frontend API conventions'),
  ],

  marketing: [
    callout('Customer-facing channels and how they connect to the platform.'),
    h2('Marketing website'),
    bullet('Static site in apps/website for prospects'),
    bullet('Some nav links (pricing, kennisbank) temporarily hidden; pages reachable by direct URL'),
    bullet('Widget embed script offered from Assistant → Installation tab'),
    h2('Chat widget — purpose'),
    bullet('Embeddable AI chat for website visitors (public audience)'),
    bullet('Separate team widget for logged-in users on internal pages (internal audience)'),
    bullet('Tenant-aware: session/start includes tenant_subdomain for isolation'),
    h2('Widget — embed options'),
    bullet('Script tag: /chat-widget/external/bokito-chat.js (public) or internal path for team'),
    bullet('Attributes: data-agent-slug, data-api-url, theme overrides, data-preview-mode for dashboard'),
    bullet('iframe snippet alternative in Installation tab'),
    bullet('Production bundle: apps/chat-widget/dist/bokito-chat.js after npm run build'),
    h2('Widget — features'),
    bullet('SSE streaming for AI responses (livechat API)'),
    bullet('Dual pipeline: legacy Claude router vs native Xano agent (config-driven)'),
    bullet('Theme: accent color, atmosphere, launcher position, bot name, welcome message'),
    bullet('Start questions, typing indicator, conversation history toggle'),
    bullet('Voice input with transcribe endpoint (faster-whisper) where enabled'),
    bullet('Handoff to human / inbox when agent cannot resolve'),
    h2('Widget — configuration in portal'),
    bullet('Assistant → Team or Public → Customization (content + styling)'),
    bullet('Agent settings — model, temperature, system prompt, tools (partial save)'),
    bullet('Installation — copy-ready snippets with live preview panel'),
    bullet('Preview uses data-preview-mode; does not override dashboard light/dark theme'),
    h2('Mobile app'),
    bullet('Expo React Native — apps/mobile'),
    bullet('Home pager: conversations list and cloud agents schedule'),
    bullet('Chat screen — SSE streaming, image attachments'),
    bullet('Agent detail — stats and configuration read-only views'),
    bullet('Uses livechat API group (/api:livechat/)'),
    h2('Livechat backend (high level)'),
    bullet('Session start authenticates visitor or links to tenant'),
    bullet('Message stream over SSE; supports tool calls and structured responses'),
    bullet('Agent config from Xano agents table — theme, prompt, model routing'),
    h2('Branding alignment'),
    bullet('Widget accent follows agent_config.theme and portal branding where synced'),
    bullet('Company config tone of voice influences system prompt assembly'),
    bullet('No emoji in widget UI copy — same policy as portal'),
    h2('Multi-tenant widget contract'),
    bullet('Documented in apps/chat-widget/MULTI_TENANT_BACKEND_CONTRACT.md'),
    bullet('Widget never hardcodes Xano origin — data-api-url from install snippet or env'),
    bullet('Dev: Vite serves /chat-widget/* from widget dist; dashboard loads internal script in main.tsx'),
  ],

  operations: [
    callout('Day-to-day operations: tenancy, auth, workforce, inbox, indexing, and troubleshooting.'),
    h2('Multi-tenancy model'),
    bullet('Each organisation has unique subdomain slug on organisation.livechat_settings.subdomain'),
    bullet('tenant_membership grants user access with role (admin, member, etc.) and status'),
    bullet('JWT and /auth/me return current_tenant and memberships[] array'),
    bullet('All workforce and app APIs filter by tenant_id from authenticated context'),
    h2('Authentication flow'),
    bullet('Login on app.bokito.ai or tenant host via POST /auth/login'),
    bullet('Refresh token in HttpOnly cookie bokito_refresh_token on .bokito.ai (or .localhost dev)'),
    bullet('Access token in sessionStorage only — not localStorage'),
    bullet('Protected routes redirect to /login?return_to= with open-redirect validation'),
    bullet('Cross-host: __bokito_at__ hash passes access token once; tenant host consumes and clears'),
    bullet('No server /refresh on some Xano configs — client skips and uses hash handoff'),
    h2('Workforce lifecycle'),
    bullet('Change request or PKB-style trigger → POST worker /agent/po/run'),
    bullet('Runtime creates work_log, starts Docker agent container with RUN_CONFIG_JSON'),
    bullet('Agent tools: read/write project docs, messages, index search, MCP credentials'),
    bullet('Orchestrator: read doc tree, process change queue, status_update or decision_request'),
    bullet('Run completes via POST /runs/complete; tokens_used preserved if runner omits counts'),
    bullet('Run reaper cron — marks runs stuck >10 min running as failed'),
    bullet('View runs: /ai/agents/:id/runs/:workLogId with live events stream'),
    h2('Project repo indexing'),
    bullet('Connect GitHub via integrations → link repo on project settings'),
    bullet('PATCH /projects/{id}/repo → POST reindex → runtime clones and chunks files'),
    bullet('index_chunks searchable via POST /index/search (pgvector cosine)'),
    bullet('Repo status on project cards: none, pending, queued, indexing, ready, error'),
    h2('Documentation indexing'),
    bullet('Block save triggers WORKER_BASE_URL/doc/reindex-page'),
    bullet('Each block → index_chunks row; page summary row per doc page'),
    bullet('Agent runner receives compact doc_map in RUN_CONFIG_JSON'),
    h2('Inbox operations'),
    bullet('Connect mailbox via Marketplace → Outlook or Gmail OAuth'),
    bullet('Sync cron every 15 minutes pulls new mail into inbox threads'),
    bullet('Queues: triage Open, Mine, Unassigned; badges on rail and sidebar'),
    bullet('AI suggestions in mail preview (UI) — draft replies from communication assistant'),
    h2('Integrations operations'),
    bullet('OAuth start → provider consent → callback stores credentials in integration_connections'),
    bullet('Multiple connections per provider allowed (e.g. several GitHub accounts)'),
    bullet('Revoke via DELETE /integrations/connections/{id}'),
    bullet('Worker fetches credentials via POST /integrations/worker/credentials'),
    h2('Crons (see xano-patches/v1/CRONS.md)'),
    bullet('Email sync, run reaper, MCP OAuth refresh, scheduled agent wakes'),
    h2('Troubleshooting runbook'),
    bullet('Geen tenanttoegang — no active tenant_membership for subdomain; fix in Xano admin'),
    bullet('Login loop — check cookie domain, return_to validation, missing refresh endpoint'),
    bullet('NXDOMAIN on tenant URL — Cloudflare wildcard DNS and tenant router route'),
    bullet('app.bokito.ai serves old build — CNAME to bokitoapp-prod not widget-prod; purge cache'),
    bullet('Tenant API 400 on POST — tenant router must proxy /api/* to Xano not static GCS'),
    bullet('Docs save Invalid pipe — workspace_doc_blocks batch endpoint; no |to_string in XanoScript'),
    bullet('Widget white screen in IDE browser — use Chrome; Vite dev on 127.0.0.1:8787 for standalone'),
    bullet('Handbook not visible — hard refresh /projects/docs; clear localStorage bokito_company_handbook_v*'),
    h2('Smoke and verification'),
    bullet('Smoke project ID documented in BOKITO_KNOWLEDGE and xano-patches/v1/VERIFICATION.md'),
    bullet('E2E: create project → connect repo → change request → agent run → doc update'),
  ],

  roadmap: [
    callout('Integrations catalog, planned modules, business rules summary, and glossary highlights.'),
    h2('Integrations — live today'),
    bullet('GitHub — repository OAuth, multi-account, project repo binding, file indexing'),
    bullet('Outlook — mailbox OAuth, inbox sync'),
    bullet('Gmail — mailbox OAuth, inbox sync'),
    bullet('Bjorn Lunden MCP — platform MCP server for accounting API (BLA)'),
    bullet('Custom MCP — bring your own URL + auth metadata'),
    bullet('Remote MCP OAuth providers — Notion, Linear, Atlassian, Slack, Asana, ClickUp, Sentry, Stripe, GitHub MCP, Microsoft Graph MCP (marketplace catalog)'),
    h2('Integrations — marketplace flow'),
    bullet('Discover at /integrations/marketplace → Connect opens hub modal by application'),
    bullet('Setup: OAuth redirect, API key form, or remote MCP OAuth with PKCE via runtime'),
    bullet('Manage active connections at /integrations/connected'),
    bullet('Install MCP servers → bindings for agent tool access'),
    h2('Integrations — coming soon'),
    bullet('Shopify MCP — catalog entry coming_soon, per-store OAuth planned'),
    h2('Platform modules — planned or stub'),
    bullet('Data module — no-code database builder UI; rail disabled; large PRD in BOKITO_KNOWLEDGE §9'),
    bullet('Analytics — KPI dashboards referenced in legacy home; not in active nav'),
    bullet('Document OCR module — PRD exists; partial backend'),
    bullet('Web scraping doc pipeline — doc/doc_page/doc_section tables for tenant knowledge sources'),
    bullet('Feature Request + AI Roadmap Orchestrator — PRD §12.11'),
    bullet('Orchestrator Agent Canvas — hierarchical agent visualization'),
    h2('Agent platform evolution'),
    bullet('Orchestrator live with tools: log, read/write docs, decision_request, status_update'),
    bullet('Future agent types: specialist workers, scheduled crons, webhook triggers'),
    bullet('Message protocol: 8 types including task_result, decision_request, status_update'),
    bullet('Autonomy modes and HITL sensitivity on project orchestration settings'),
    h2('Business rules (summary)'),
    bullet('Tenant isolation — never leak data across organisation_id boundaries'),
    bullet('RBAC — admin-only writes on sensitive settings; members read project data per role'),
    bullet('Locked doc pages — agents cannot batch-write blocks until unlocked'),
    bullet('Agent doc writes require change_note for audit trail'),
    bullet('Worker endpoints use shared secret or worker_api_key — not end-user JWT'),
    bullet('Frontend must not hardcode Xano origins — use api.config.ts and routes/'),
    h2('Glossary'),
    bullet('Tenant — organisation with subdomain, isolated data scope'),
    bullet('Control plane — app.bokito.ai host for login and workspace picking'),
    bullet('Work log — single agent run instance with events and status'),
    bullet('Change request — human request that wakes the orchestrator to implement doc or project change'),
    bullet('MCP — Model Context Protocol server exposing tools to agents'),
    bullet('Index chunk — embedded text segment for vector search retrieval'),
    bullet('Doc scope — workspace (tenant-wide) vs project (per delivery)'),
    bullet('Scaffold page — default handbook chapter slug seeded on empty doc tree'),
    h2('Where to track changes'),
    bullet('Product increments — BOKITO_KNOWLEDGE.md at repo root'),
    bullet('Engineering handbook — docs/company/ (11 chapters)'),
    bullet('Navigation IA — apps/dashboard/docs/NAVIGATION.md'),
    bullet('Integrations checklist — apps/dashboard/docs/INTEGRATIONS.md'),
    p(
      'This workspace handbook auto-updates when COMPANY_HANDBOOK_VERSION bumps in workspace-company-handbook.ts. Custom pages you add manually are never overwritten.',
    ),
  ],
}

export const COMPANY_HANDBOOK_SLUGS = new Set(Object.keys(COMPANY_HANDBOOK_BLOCKS))

function handbookStorageKey(workspaceDocId: string): string {
  return `bokito_company_handbook_${COMPANY_HANDBOOK_VERSION}_${workspaceDocId}`
}

function handbookAppliedSlugsKey(workspaceDocId: string): string {
  return `${handbookStorageKey(workspaceDocId)}_slugs`
}

function readAppliedHandbookSlugs(workspaceDocId: string, pages: DocPageRow[]): Set<string> {
  const slugKey = handbookAppliedSlugsKey(workspaceDocId)
  const raw = localStorage.getItem(slugKey)
  if (raw) {
    try {
      return new Set(JSON.parse(raw) as string[])
    } catch {
      /* fall through to migration */
    }
  }

  // Migrate legacy single "done" flag (only pages that existed were updated).
  if (localStorage.getItem(handbookStorageKey(workspaceDocId)) === 'done') {
    const migrated = new Set(
      pages.filter((page) => COMPANY_HANDBOOK_SLUGS.has(page.slug)).map((page) => page.slug),
    )
    localStorage.setItem(slugKey, JSON.stringify([...migrated]))
    localStorage.removeItem(handbookStorageKey(workspaceDocId))
    return migrated
  }

  return new Set()
}

function persistAppliedHandbookSlugs(workspaceDocId: string, slugs: Set<string>): void {
  localStorage.setItem(handbookAppliedSlugsKey(workspaceDocId), JSON.stringify([...slugs]))
}

function seedsToCreateOps(title: string, seeds: BlockSeed[]): BlockOp[] {
  const ops: BlockOp[] = [
    {
      op: 'create',
      type: 'heading_1',
      text: runs(title),
      position: 0,
    },
  ]
  seeds.forEach((seed, index) => {
    ops.push({
      op: 'create',
      type: seed.type,
      text: runs(seed.text),
      props: seed.props ?? {},
      position: index + 1,
    })
  })
  return ops
}

export function getCompanyHandbookCreateOps(slug: string, title: string): BlockOp[] | null {
  const seeds = COMPANY_HANDBOOK_BLOCKS[slug]
  if (!seeds) return null
  return seedsToCreateOps(title, seeds)
}

/** Replace all blocks on a page with the company handbook content for that slug. */
export async function applyCompanyHandbookToPage(
  pageId: string,
  slug: string,
  title: string,
): Promise<void> {
  const createOps = getCompanyHandbookCreateOps(slug, title)
  if (!createOps) return

  const existing = await listWorkspacePageBlocks(pageId)
  const deleteOps: BlockOp[] = existing.blocks.map((block) => ({
    op: 'delete',
    id: block.id,
  }))
  if (deleteOps.length > 0) {
    await applyWorkspaceBlockOps(pageId, deleteOps)
  }
  await applyWorkspaceBlockOps(pageId, createOps)
}

/**
 * One-time per workspace doc: seed handbook content into all scaffold pages.
 * Returns true if any page was updated.
 */
export async function ensureCompanyHandbookApplied(
  workspaceDocId: string,
  pages: DocPageRow[],
): Promise<boolean> {
  if (typeof window === 'undefined') return false

  const appliedSlugs = readAppliedHandbookSlugs(workspaceDocId, pages)
  const targets = pages.filter(
    (page) => COMPANY_HANDBOOK_SLUGS.has(page.slug) && !appliedSlugs.has(page.slug),
  )
  if (!targets.length) return false

  for (const page of targets) {
    await applyCompanyHandbookToPage(page.id, page.slug, page.title)
    appliedSlugs.add(page.slug)
  }

  persistAppliedHandbookSlugs(workspaceDocId, appliedSlugs)
  return true
}

/** Slugs that receive handbook content when seeding new pages. */
export function isCompanyHandbookSlug(slug: string): boolean {
  return COMPANY_HANDBOOK_SLUGS.has(slug)
}

/** Title for scaffold page by slug (fallback to slug). */
export function handbookTitleForSlug(slug: string): string {
  return WORKSPACE_DOC_SCAFFOLD_PAGES.find((p) => p.slug === slug)?.title ?? slug
}
