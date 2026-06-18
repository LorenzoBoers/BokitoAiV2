# UX Iteration Notes

Dashboard UX polish pass — systematic audit and batch fixes across major routes.

## Total items addressed: **124**

Grouped by theme (each bullet is one tracked fix).

---

## Batch 1 — Inbox & thread UX (18)

- ThreadDetail: pin/unpin and contact panel tooltips + aria-labels → English
- ContactPanel: status/priority labels, date locale (`en-US`), relative time strings
- ContactPanel: section labels (contact details, assigned to, previous threads)
- RoutingRulesManager: full dialog copy (rules, conditions, actions, empty state)
- SignatureEditor: templates, toolbar titles, preview tab, save/cancel
- ReplyComposer: note button loading/save labels
- SyncStatusPanel: refresh button title
- AssigneeSelector: unassigned label
- ConfirmDeleteDialog: confirmation copy, cancel/delete buttons

## Batch 2 — Communication legacy views (11)

- MessageArea: no subject fallback, empty mailbox message
- InfoPanel: sender/notes/previous messages sections
- ChannelSidebar: no active mailboxes empty state

## Batch 3 — Database module (32)

- RecordDrawer: activity/comments, save/send, delete confirm, unassigned
- GridView: search empty, delete/save button states
- TableBuilder, TableSettings*, FieldEditor, FieldConfigPanel
- TableSearch, TableListSidebar, TableDescriptionDialog, RelationSearchModal
- RecordContextMenu, KanbanView, CellEditor, CalendarView
- CSVImport/CSVImportDialog: preview, field mapping, import progress
- ExportDialog, DataExport, ImportExportDialog, AIEnrichmentDialog
- DatabasePage card title, DatabaseSectionSidebar empty state

## Batch 4 — API & integrations (14)

- ApiKeyManagement, WebhookConfiguration, UsageChart, RateLimitDisplay
- EndpointDocumentation empty states and field labels
- ConnectedIntegrationsPreview empty state

## Batch 5 — Settings & auth flows (28)

- CompanyConfig: save/delete/error states
- InboxSettings: OAuth errors, folder save, empty inbox
- EmailSettings: connect/disconnect/delete, OAuth modal, preview table
- MemberManagement: invite error, teams empty state
- MessengerSettings, HelpCentersSettings, ProfileSettings, ResetPassword
- Onboarding wizard/steps copy
- email-api.ts, email-oauth.ts (connect labels + OAuth error summaries)
- platform.ts + AuthContext + WorkspaceDocNavContext auth error messages
- NotificationContext sample message

## Batch 6 — Workforce & platform pages (9)

- AssistantEditor save buttons
- StaffTenantBar tenant load/switch errors
- AiAgents: header refresh button, empty state CTA → AI OS canvas
- DecisionsPanel: toast on load failure
- GovernPage: reject confirmation before destructive action
- govern.json: `rejectConfirm` i18n key

## Batch 7 — Misc layout & onboarding (12)

- Workspaces tenant open error
- Onboarding loading label
- Workforce sidebar already i18n-backed; rail uses Bokito-specific Govern entry

---

## Structural improvement proposals

### 1. Admin landing: Cockpit vs AI OS canvas

**Current:** Home dashboard shows quick links; AI OS canvas (`/os`) is the default intelligence surface; Cockpit exists but is not the primary rail entry.

**Proposal:** Make Cockpit the optional metrics layer linked from Home/Cards, and keep `/os` as the operational default for admins. Add a single “where do I start?” card on Home when workspace is empty (no projects, no mailbox).

### 2. Inbox vs Decisions merge/separation

**Status (2026-06):** Implemented Signal-first Messages hub. One thread UI at `/support/inbox/*` with sidebar folders **External** (email/mailboxes) and **Internal (Agents)** (`?folder=external|internal`). Agent decision requests appear as `decision_request` messages in thread detail with inline approve/defer/reject. Legacy routes redirect: `/messages`, `/communication`, `/os/communication`, `/project/:id/communication`.

**Previous proposal:** Keep separate backends but unify the mental model — superseded by full Signal thread integration in bokito mode.

### 3. Worker agent creation gap

**Current:** Agent library lists orchestrators and workers but empty state only links to canvas — no inline “Create worker agent” flow.

**Proposal:** Add explicit CTA on `/os/agents` → project settings or workforce template picker. Document orchestrator-vs-worker types in empty state description (implemented in this pass).

### 4. Nav hierarchy: main rail vs section sidebars

**Current:** Bokito rail has Home, Support, Agenda, AI OS, Integrations, Govern, Settings. AI OS section sidebar duplicates Orchestra/Agents/Decisions/Blueprint.

**Proposal:** Collapse “Platform agents” (Assistant, Communication) under Settings → AI, not AI OS sidebar, to reduce duplicate agent entry points. Keep AI OS sidebar for workspace operations only.

### 5. Settings discoverability

**Current:** Settings rail icon goes to profile; email/inbox/MCP live under nested settings paths easy to miss from Integrations.

**Proposal:** Add Settings overview page with grouped cards (Personal, Workspace, Communication, Data). Link Inbox settings from Support Inbox empty state (partially present).

### 6. Dutch i18n vs English defaults

**Current:** `locales/nl/*` remains for future locale switch; many components had hardcoded Dutch bypassing i18n.

**Proposal:** Migrate remaining hardcoded strings to `locales/en/*` keys in a follow-up; enforce lint rule blocking Dutch UI literals in `src/` outside `locales/nl/`.

### 7. OAuth error surfacing

**Current:** email-oauth summaries now English; some settings pages still use toast title only.

**Proposal:** Standardize on `OauthRedirectAlert` + detail field everywhere OAuth returns to settings.

### 8. Database module placement

**Current:** Database lives under Data sidebar, somewhat disconnected from AI OS knowledge graph.

**Proposal:** Link “Tables” from Govern audit entries and AI OS Blueprint docs for operators who need schema context.

---

## Batch 7 — Positioning IA (2026-06)

- Canonical Messages URLs: `/messages/*` with legacy `/support/inbox/*` redirects.
- Messages sidebar uses **Customer | Agents** segment tabs (replaces nested External/Internal collapsibles); agent ops leads with Awaiting decision.
- Bokito dev API bases: `APP_API_BASE=/api`, `AGENDA_API_BASE=/api` (fixes signals and agenda 404s); custom-db uses `/api/app`.
- Removed parallel **Decisions** entry points from AI OS sidebar, Cockpit quick links, and canvas CTAs; awaiting-decision queue lives in Messages only.
- Govern page is full-bleed (no erroneous "Home" sidebar title).
- Cockpit reframed as ops command center with positioning tagline and Autonomy posture summary.
- Workforce labels → **Agents** / **Agent runs** in nav and project tabs.
- Onboarding step 2 replaced database table templates with ops-flow surface choice.
- Deleted unused `DecisionsPanel` and `ProjectHubCommunication`.
- `NAVIGATION.md` rewritten for bokito rail IA.

---

## Verification

- Run `npm run build` in `apps/dashboard` after changes.
- Spot-check: Govern reject confirm, Agent library refresh, Decisions load error toast, Email connect modal copy.

## Follow-up (not in this pass)

- MessengerSettings Dutch paragraph (~line 835)
- `mock-data.ts` / `projects-data.ts` demo copy (non-production)
- Full i18n extraction for database & API components
- Mobile pass on Inbox thread layout and AI OS canvas controls
