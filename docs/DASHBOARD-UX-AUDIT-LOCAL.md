# Dashboard UX audit (local bokito mode)

**Date:** 2026-06-04  
**Environment:** `VITE_API_MODE=bokito`, `http://127.0.0.1:5174`, FastAPI `http://127.0.0.1:8000`  
**Account:** `admin@bokito.ai` (seed)  
**Method:** Four browser passes + route/code review + API spot-checks (`curl` on FastAPI): workspace picker, Cockpit, Orchestra/Agenda, inbox (queues + `/communication` decisions), projects wizard, integrations (connected, marketplace, docs, MCP), workforce, assistant (customization styling, agent settings, installation), notifications, settings (inbox, branding, profile, help-centers), user menu, blueprint; grep for mocks/redirects; `Layout` / `DatabaseRouteLayout` / `MessengerSettings` save path.

**Session status:** Audit complete for plan mode. Use **Plan mode decision backlog** (end of doc) when creating the implementation plan.

---

## Summary

The bokito-mode shell is visually polished but still feels like a **hybrid** of legacy Xano portal patterns and new AI OS surfaces. **335 findings** are logged below (phases 1–2: 1–165; phase 3: 166–265; **phase 4: 266–335**).

**Verified API (admin seed, 2026-06-04):** `GET /api/cockpit/summary` **200**; `GET /api/workforce/agents` **500**; `GET /api/workforce/work_logs?status=running` **500**; `GET /api/workforce/workspace/doc` **500**.

**Top blockers:** `/database` error boundary; **HTTP 500** on Workforce `work_logs` and Blueprint `/workspace/doc`; **section sidebar title stuck on "Inbox"** on Orchestra/Agenda; workspace **Open** → branding instead of Cockpit; project hub **empty selector** hiding seed data.

**Top UX themes:** duplicate shells (workspace picker vs app), mock/local-only settings (notifications), half-wired AI OS pages (Orchestra API exists, UI shows one card), i18n split (NL login/forgot-password vs EN cockpit), raw API errors shown to users.

---

## Findings (335 total: 1–165 phases 1–2, 166–265 phase 3, 266–335 phase 4)

### A. First run, workspace picker, and shell (1–10)

| # | Type | Finding |
|---|------|---------|
| 1 | Bug | Workspace card shows URL `http://bokito.0.1` — malformed host for local dev. |
| 2 | UX | **Open workspace** lands on `/settings/branding`, not Cockpit (`/home`) or last-used route. |
| 3 | Question | Should local dev show `127.0.0.1:5174` (or `*.localhost`) instead of production-style tenant URLs on workspace cards? |
| 4 | IA | Two shells: **Bokito portal** (Workspaces / Billing / Support) vs **main app** (Cockpit rail). Unclear when users return to workspace picker. |
| 5 | Missing | Billing and Support exist only on workspace picker, not in main admin rail — easy to miss. |
| 6 | UX | Help & resources links (documentation, community, videos, support) have no in-app confirmation they work in bokito mode. |
| 7 | UX | Large empty margins on workspace picker; no search/filter if many workspaces. |
| 8 | Copy | Duplicate CTAs: card footer **Open workspace** vs **Set up workspace** on create card — hierarchy unclear. |
| 9 | UX | **Current** badge on one card only; multi-workspace switching story not demonstrated in UI. |
| 10 | Question | Is workspace picker still required in single-tenant local dev, or should `admin` skip straight to `/home`? |

### B. Global navigation and layout (11–20)

| # | Type | Finding |
|---|------|---------|
| 11 | Label | Rail item **Home** opens page titled **Cockpit** — naming mismatch. |
| 12 | A11y | Icon-only left rail: settings link has **no accessible name** in snapshot (`link` without label). |
| 13 | Bug | Secondary sidebar header shows **Inbox** on Orchestra, Agenda, and Cockpit routes — wrong section context. |
| 14 | UX | No persistent breadcrumbs; only small **Home** / **Portal** / **Support Inbox** labels. |
| 15 | UX | Route `/inbox` does not map to inbox UI (redirects or empty); real inbox is `/support/inbox/*` and `/communication`. |
| 16 | Question | Should the rail label stay **Inbox** or **Support** to match URLs and Dutch copy (**Alle kanalen**)? |
| 17 | Missing | Nav badge counts (inbox, decisions) not visible on rail icons during audit. |
| 18 | UX | Floating **Assistant** button on every page; bokito mode disables chat widget — button purpose unclear. |
| 19 | UX | **Bokito** wordmark bottom-right on many pages; competes with Assistant and looks like debug chrome. |
| 20 | Question | Preferred information architecture: Cockpit-first vs Inbox-first vs Projects-first for daily admin? |

### C. Cockpit / Home (21–25)

| # | Type | Finding |
|---|------|---------|
| 21 | UX | Six metric cards then large empty void — no charts, trends, or recent activity feed. |
| 22 | UX | Metrics mostly `0` / `-` with no onboarding copy ("Connect inbox to see conversations"). |
| 23 | UX | Mixed time windows: **7d**, **30d**, and unspecified on same screen. |
| 24 | Missing | Cards are not clickable — no drill-down to inbox, decisions, or usage. |
| 25 | Question | Which 2–3 KPIs must be above the fold for v1 (conversations, decisions, runs, cost)? |

### D. Orchestra (26–30)

| # | Type | Finding |
|---|------|---------|
| 26 | Perf | **Loading orchestra...** persists on first visit; later shows content or empty state inconsistently. |
| 27 | UX | Loaded state shows only **Scheduled tasks** / "No tasks configured yet" — subtitle promises agent profiles and workstream runs but no tabs/sections. |
| 28 | Missing | No CTA to create first scheduled task or link to Orchestra settings. |
| 29 | IA | Orchestra competes with **Agenda** (roadmap) and **Workforce** — boundaries unclear. |
| 30 | Question | Is Orchestra the control plane for cron/agents, or also PO/orchestrator configuration? |

### E. Agenda (31–34)

| # | Type | Finding |
|---|------|---------|
| 31 | UX | Four kanban columns (Idea → Done) are static placeholders; no cards, drag-drop, or add item. |
| 32 | Copy | Every column: "Items from orchestra tasks appear here" — passive, no workflow explanation. |
| 33 | Missing | No manual "Add idea", filters, assignees, or dates on cards. |
| 34 | Question | Should Agenda be editable roadmap, read-only projection of Orchestra tasks, or both? |

### F. Inbox / communication (35–44)

| # | Type | Finding |
|---|------|---------|
| 35 | i18n | Mixed Dutch (**Alle kanalen**, **Gepind**) and English (**Messages**, **Decisions**, **Assistant settings**). |
| 36 | IA | Default **Messages** hub emphasizes **Decisions / Updates / Results** tabs, not conversation threads — surprising for "Inbox" rail. |
| 37 | UX | **Unassigned** queue showed decision empty state, not thread list; thread UI appears on other queues (e.g. mine) with full three-pane layout. |
| 38 | UX | Thread view (when present): rich layout (list, transcript, contact panel) but **Mailbox** field empty, **Eerdere threads** / **Taken** marked **Binnenkort**. |
| 39 | Data | Thread **Aangemaakt** showed future date (3 juni 2026) — seed/timezone bug hurts trust. |
| 40 | Missing | No assign-to-agent/user control visible in thread header; no SLA/priority edit in panel. |
| 41 | Missing | No global search across conversations; filters limited to All/Unread/Pinned in list. |
| 42 | UX | **Configure** groups Assistant + Inbox settings — good, but buried below fold in sidebar. |
| 43 | UX | **support@bokito.ai** mailbox row — unclear if IMAP connected or mock seed. |
| 44 | Question | Primary inbox metaphor: Intercom-style conversations vs internal **decisions** feed — which is default tab? |

### G. Projects (45–50)

| # | Type | Finding |
|---|------|---------|
| 45 | Data | Project hub showed **0 projects** and loading sections — seed projects may not surface or API list failed silently. |
| 46 | UX | **Add workstream** disabled until project selected — OK, but no hint which project to pick. |
| 47 | UX | **Create project** wizard step 1: 30-character minimum on description with orange counter — may frustrate quick testing. |
| 48 | Missing | URL slug field has no auto-slug from project name preview (`/project/{slug}`). |
| 49 | UX | Step 2 not previewed — user does not know what comes next (repo? agents?). |
| 50 | Question | Should bokito mode default to one seeded project opened in hub instead of empty overview? |

### H. Workforce (51–54)

| # | Type | Finding |
|---|------|---------|
| 51 | Bug | Red error banner: `HTTP 500 Onbekende fout [/work_logs?status=running&limit=25]` — raw API path exposed. |
| 52 | i18n | Dutch **Onbekende fout** inside otherwise English Workforce overview. |
| 53 | UX | Sidebar **Loading agents...** under Orchestrators / Worker agents while overview already rendered. |
| 54 | Question | Should platform agents (Assistant, Communication) be configured here or under Settings > Assistant? |

### I. Database / Tables (55–56)

| # | Type | Finding |
|---|------|---------|
| 55 | Blocker | `/database` triggers app error boundary: **Something went wrong** — Tables rail item is broken. |
| 56 | Question | Which standard tables (Klanten, etc.) must appear on first open vs after explicit bootstrap action? |

### J. Integrations (57–58)

| # | Type | Finding |
|---|------|---------|
| 57 | UX | Connected page eventually shows sensible grouping (Communication / Repository / MCP) with counts; initial **Loading connections...** slow on cold navigation. |
| 58 | UX | Multiple competing CTAs per section (Connect, Open projects, Browse Marketplace) — unclear single primary action per provider. |

### K. Settings (additional; counted in 58 above as spread — expand to 60+ with sub-findings)

| # | Type | Finding |
|---|------|---------|
| 59 | i18n | **Members and teams** largely Dutch; Profile/Branding headers English — no unified locale strategy. |
| 60 | UX | Settings top **Search...** scope undefined (profile only vs global). |
| 61 | UX | Profile: email appears read-only; avatar shows initials but no obvious **Upload** in a11y tree. |
| 62 | UX | **2FA Coming soon** with no ETA or waitlist — consider hiding until available. |
| 63 | UX | Branding: **Huisstijl automatisch detecteren** + subdomain `*.bokito.ai` while running on `127.0.0.1` — confusing for local. |
| 64 | UX | Branding **Opslaan** not exercised in audit; unclear if save returns toast or updates live preview. |
| 65 | IA | **Chat assistent stijl** deep-linked from branding — good cross-link; widget disabled in bokito mode. |

---

### L. Navigation shell bugs (code + UI) (66–78)

| # | Type | Finding |
|---|------|---------|
| 66 | Bug | `SectionSidebar.resolveTitle()` returns **Inbox** for `/orchestra`, `/agenda`, `/communication` — only `/home`, projects, workforce, integrations, settings get proper titles. |
| 67 | Bug | `iconForLink()` default return is **Inbox** — wrong icons on misc routes. |
| 68 | UX | `/orchestra` and `/agenda` get **empty** `resolveGroups()` — no secondary nav, but misleading **Inbox** header remains. |
| 69 | UX | `/home` correctly hides section sidebar; Orchestra/Agenda do not — inconsistent layout grid. |
| 70 | IA | Authenticated `/` always renders **workspace picker** (`HomeRoute` + `Workspaces`), not Cockpit — extra click every session. |
| 71 | UX | `TenantHomeRedirect` sends zero projects to `/projects/new`, one to project overview, many to `/home` — logic opaque to users. |
| 72 | UX | Catch-all route `*` → `/` can eject deep links back to workspace picker. |
| 73 | Redirect | `/analytics`, `/datasources`, `/users/*`, `/data/*`, `/settings/data/*` → `/projects` — bookmarks break silently. |
| 74 | Redirect | `/cloud-agent` → `/home`; `/workforce/*` wildcard → overview — deep links lost. |
| 75 | Redirect | `/settings/billing` → **CompanyConfig** (branding), not billing UI — misleading menu label. |
| 76 | Redirect | `/settings/access-security` → **ProfileSettings** — duplicate of profile security block. |
| 77 | Redirect | `/settings/teams` → members page — OK but URL says teams. |
| 78 | Question | Should Orchestra and Agenda use **Workforce-style** sidebar (tasks, profiles, runs) or stay minimal single-column? |

### M. Orchestra, Agenda, Cockpit (79–92)

| # | Type | Finding |
|---|------|---------|
| 79 | Bug | Orchestra page uses raw `fetch('/api/orchestra/tasks')` — errors only `console.error`, user sees eternal loading or empty list. |
| 80 | UX | Orchestra subtitle promises **agent profiles** and **workstream runs** but UI only renders **Scheduled tasks** card. |
| 81 | Missing | No UI for orchestra endpoints that exist in API: settings, agent-profiles, workstreams, workstream-runs. |
| 82 | UX | Agenda is static placeholder kanban — no API wiring, drag-drop, or add-card. |
| 83 | UX | Agenda columns share identical helper text — no differentiation of column meaning. |
| 84 | Question | Should Agenda auto-sync from Orchestra task status or allow manual cards independent of agents? |
| 85 | i18n | Cockpit, Orchestra, Agenda page copy hardcoded English — rail uses i18n keys. |
| 86 | UX | Cockpit cards lack units/tooltips (what counts as a "conversation", how autonomy is calculated). |
| 87 | Missing | No date range selector on Cockpit (7d/30d fixed in labels only). |
| 88 | Missing | No export/share/report action on Cockpit for managers. |
| 89 | UX | Cockpit error state is plain red text — no retry button. |
| 90 | UX | `Loading cockpit metrics...` skeleton could mirror final card grid to reduce layout shift. |
| 91 | Question | Is **Cockpit** the CEO view and **Orchestra** the ops view — who is each for? |
| 92 | Question | Should **Agenda** appear in rail before Orchestra or be a tab inside Orchestra? |

### N. Projects, Blueprint, repo (93–108)

| # | Type | Finding |
|---|------|---------|
| 93 | Bug | `/projects/docs` (Blueprint): **HTTP 500** on `/workspace/doc` with Dutch error in English shell. |
| 94 | Bug | Workforce overview: same **HTTP 500** pattern on `/work_logs` — backend stability blocks multiple hubs. |
| 95 | UX | Project hub **Select project** combobox empty — seed projects not listed; blocks workstreams and docs. |
| 96 | UX | **Add workstream** disabled with only label "Select project" — no CTA to create project inline. |
| 97 | UX | Project hub shows **Retry** on Blueprint error — good pattern; not used on Workforce/orchestra silent failures. |
| 98 | UX | Create project step 1: **30 char** minimum on description (spaces ignored) — high friction for quick demos. |
| 99 | Missing | No live slug preview (`/project/{slug}`) or availability check on URL slug field. |
| 100 | UX | Wizard hides section sidebar (good) but header still says **Create project** only — no progress beyond step 1/2 tested. |
| 101 | IA | Parallel paths: `/projects/*` hub vs `/project/:id/*` — relationship not explained in UI. |
| 102 | UX | Legacy routes `/project/:id/po` redirect to orchestrator — old bookmarks OK but naming confusing. |
| 103 | UX | `/project/:id/request` redirects to `/projects/docs` — "request a change" naming vs Blueprint. |
| 104 | Question | Default project selection: remember last project in `localStorage` vs always prompt? |
| 105 | Question | Should Blueprint open **full-screen editor** (Notion-like) or stay in hub frame? |
| 106 | Missing | No visible "Connect GitHub" success state on project overview when repo linked. |
| 107 | UX | Project usage page exists (`/project/:id/usage`) — not audited; likely mock or empty. |
| 108 | Question | One **central Blueprint** per workspace vs per project — current IA suggests both hub docs and project docs. |

### O. Inbox, messenger, decisions (109–122)

| # | Type | Finding |
|---|------|---------|
| 109 | UX | `/support/inbox/mine` loads thread UI; `/support/inbox/unassigned` showed **decisions empty** — queue semantics inconsistent. |
| 110 | UX | **My inbox** nav uses user avatar in sidebar — nice; other queues use generic icons only. |
| 111 | UX | Reply composer: Dutch placeholders (**Typ een antwoord...**) in EN-labelled **Messages** header area. |
| 112 | UX | **Stuur en sluit** vs **Verstuur** — good power-user split; no keyboard shortcut hint. |
| 113 | Missing | No bulk actions (assign all, close all) in thread list. |
| 114 | Missing | No SLA/timer/urgency column in thread list. |
| 115 | UX | Contact panel **Telefoon: Niet bekend** — no inline edit to add phone. |
| 116 | UX | **Eerdere threads** / **Taken** sections say **Binnenkort** — reduces trust in CRM-style panel. |
| 117 | Data | Thread created date showed **future** date in seed — undermines timeline credibility. |
| 118 | UX | **Decisions / Updates / Results** tabs on communication hub — overlap with Workforce messages; user may not know which to check. |
| 119 | Missing | No indication when AI vs human sent a message in transcript (icons minimal). |
| 120 | UX | Channel-specific routes `/support/inbox/ch/:channelId/:queue` exist — not tested; complexity for power users only? |
| 121 | Question | Should **Pinned (Gepind)** be per-user or workspace-wide? |
| 122 | Question | Primary action in inbox: **Resolve decision** vs **Reply to customer** — which drives the right column default? |

### P. Workforce and agents (123–134)

| # | Type | Finding |
|---|------|---------|
| 123 | UX | `/ai/assistent/internal/customization` shows **Workforce** sidebar, not Assistant/Settings nav — disorienting cross-link. |
| 124 | UX | Messenger settings: **Save changes** disabled — cannot test save feedback in audit. |
| 125 | Copy | Modules config: "Ordering and persistence will follow when the backend supports it" — explicit unfinished feature. |
| 126 | UX | Module toggles **disabled** (Home, Messages, Help) — why show switches that cannot change? |
| 127 | UX | Tab label **Assistent** (NL) vs **Assistant agent** (EN) in same view. |
| 128 | UX | **Intern / Extern** audience toggle — good; relationship to livechat embed not shown in bokito mode. |
| 129 | Missing | Agent library page (`/workforce/agents`) not fully audited — list/detail patterns unknown. |
| 130 | Missing | Run detail `/ai/agents/:id/runs/:workLogId` not opened — critical for debugging agents. |
| 131 | UX | Workforce PO agents route exists (`/workforce/po`) — overlap with project orchestrator naming. |
| 132 | Question | Rename **Workforce** to **Agents** or **AI team** for clarity? |
| 133 | Question | Should platform agents (Assistant, Communication) live under **Settings** instead of Workforce tree? |
| 134 | Question | Show **running runs** in a live ticker on Cockpit or only on Workforce? |

### Q. Integrations and API surface (135–148)

| # | Type | Finding |
|---|------|---------|
| 135 | UX | Marketplace grid: many **Coming soon** cards — consider filter "Available now" default in bokito mode. |
| 136 | UX | Integration rows implemented as **buttons** — unusual for navigation; screen reader may announce as actions not links. |
| 137 | UX | **About this integration** icon per card — redundant if entire card is clickable. |
| 138 | UX | Description text truncated with ellipsis mid-sentence — hard to compare providers. |
| 139 | UX | **Google: Manage** vs **Microsoft: Connect** — inconsistent verb for similar mail integrations. |
| 140 | UX | **GitHub: 2 connection types** — needs one-line explainer (repo index vs MCP tools). |
| 141 | UX | Marketplace cold navigation shows **full-screen spinner** before layout paints. |
| 142 | UX | Integrations **API keys** page is **Coming soon** badge only — menu item still enabled. |
| 143 | Code | `ApiContext` still ships **mock** API keys, webhooks, rate limits — risk of showing fake data if wired. |
| 144 | Missing | Integrations **Documentation** tab not reviewed — dead link risk. |
| 145 | Missing | **MCP** management page not fully reviewed — separate from marketplace MCP cards. |
| 146 | Question | Connect flow: modal vs full-page OAuth — preference for enterprise admins? |
| 147 | Question | Show integration **health / last sync** on Connected cards? |
| 148 | Question | Hide **Bjorn Lunden** and niche MCPs behind "More" in marketplace for cleaner grid? |

### R. Settings, auth, control plane (149–165)

| # | Type | Finding |
|---|------|---------|
| 149 | UX | Notification matrix: **21 toggles** — overwhelming; no role-based presets (agent vs admin). |
| 150 | UX | Banner: **"saved locally as UX draft"** — honest but signals non-production; users may think settings won't stick. |
| 151 | UX | Mobile push column shown — no PWA push permission flow visible in dashboard. |
| 152 | UX | Desktop notifications described as "banner in corner" — no browser permission prompt integration shown. |
| 153 | UX | `/billing` (control plane) is placeholder card only — same for `/support` in workspaces.json. |
| 154 | UX | Forgot password page **Dutch** while logged-in app mixed EN — good for NL market, inconsistent with profile language toggle. |
| 155 | UX | Forgot password: submit disabled until valid email — shows **E-mailadres is verplicht** while placeholder still visible (validation UX harsh on first paint). |
| 156 | UX | Login page shows **build: local-dev** — good for dev; hide in production builds? |
| 157 | Missing | No SSO / Microsoft login on login screen — question for enterprise tenants. |
| 158 | UX | Profile language toggle (NL/EN) does not reload sidebar strings immediately (i18n partial). |
| 159 | UX | Theme **System / Light / Dark** on profile — good; not verified against all pages (charts, inbox). |
| 160 | UX | Members invite: role dropdown **Member** vs table shows **owner** — OK for self, unclear invite roles mapping. |
| 161 | UX | Teams section empty state is strong — **+ Maak er een aan** duplicates header CTA (acceptable). |
| 162 | UX | Branding **Detecteren** and **Wijzigen** (subdomain) as separate actions from **Opslaan** — risk of partial save confusion. |
| 163 | UX | Settings search box only on `/settings/*` — does not search members, integrations, or inbox. |
| 164 | Missing | No **audit log** or **API activity** page in bokito rail (compliance buyers may expect it). |
| 165 | Missing | No **status page / incidents** link in app (only external help links on workspace picker). |

---

### S. Chat widget restore and Messenger preview (166–178)

| # | Type | Finding |
|---|------|---------|
| 166 | Fixed (local) | Restored `bokito-chat` preview renders on Customization: monkey launcher art, gradient header, **Nieuw gesprek starten**, bottom nav (Home / Berichten / Tools). |
| 167 | UX | Preview canvas still shows a **floating green launcher FAB** bottom-right — duplicates embedded preview; confusing in editor mode. |
| 168 | UX | Module toggles list Home/Messages/Help/Changelog but preview bottom nav shows **Tools** with no matching module toggle. |
| 169 | UX | **Changelog** module off in config yet not reflected as a visible tab difference in preview (only Tools appears extra). |
| 170 | A11y | Live preview is not exposed in accessibility tree (`bokito-chat` shadow DOM); screen readers only see **Live messenger preview** label. |
| 171 | UX | Preview **Light/Dark** tabs on dashboard update widget `data-theme`; good — verify contrast on light grid background. |
| 172 | UX | **Save changes** stays disabled on Customization even after editing welcome fields — cannot validate persistence in UI. |
| 173 | Bug | Workforce sidebar on Messenger pages shows **HTTP 500** for Orchestrators and Worker agents (`/agents`) while page content loads. |
| 174 | Perf | **Loading agents…** never resolves on Assistant settings due to same `/api/workforce/agents` 500. |
| 175 | IA | Two widget stacks coexist: canvas uses **`bokito-chat`** (IIFE); global **Assistant** FAB uses `@bokito/messenger-ui` (`FloatingMessengerHost`) — different UIs. |
| 176 | Question | Should the floating Assistant button open the same `bokito-chat` bundle as the public site, or stay on simplified messenger-ui? |
| 177 | Question | Hide launcher FAB in `data-preview-mode` entirely (CSS) for cleaner customization canvas? |
| 178 | Idea | Add **Open preview in new tab** (standalone `chat-standalone.html`) for full-screen QA. |

### T. User menu, header, and global chrome (179–188)

| # | Type | Finding |
|---|------|---------|
| 179 | UX | User menu offers **Light mode** as a single menu item — no in-menu **Dark** or **System** (profile has full theme control). |
| 180 | UX | Menu item **Bokito** (tenant name) has no tooltip — unclear if it switches workspace or is decorative. |
| 181 | UX | **Workspaces** menuitem returns to picker — good; not linked from main rail (only here + picker nav). |
| 182 | UX | **Notification preferences** in menu duplicates Settings > Notifications — OK but two paths to same matrix. |
| 183 | A11y | Settings gear link in left rail still has **no accessible name** (empty `link` in snapshot). |
| 184 | UX | **Bokito** wordmark control bottom-right persists on Settings, Messenger, Integrations — feels like debug/footer chrome. |
| 185 | UX | Rail **Inbox** shows `states: [current]` on thread routes while section title is **Inbox** / **Alle kanalen** — OK but Home not highlighted when deep in settings. |
| 186 | Missing | User menu has no **keyboard shortcut** hints (logout, theme, profile). |
| 187 | Question | Add **Switch workspace** submenu when user has multiple memberships? |
| 188 | Idea | Show build/version in user menu for admins (not only login footer). |

### U. Messenger installation and embed (189–198)

| # | Type | Finding |
|---|------|---------|
| 189 | UX | Installation tab explains **internal vs external** paths (`/chat-widget/internal/` vs `external/`) — accurate for local Vite. |
| 190 | UX | Copy references parallel **Xano** script URLs (`/api:livechat/script/internal`) — confusing in pure bokito local mode. |
| 191 | UX | **Kopieer embed-HTML** button present — good; not clicked in audit (clipboard feedback unknown). |
| 192 | UX | Snippet text truncated in a11y tree mid-sentence — long prose block hard to scan; consider code block only. |
| 193 | UX | Installation preview also shows **Live messenger preview** with Dark tab — same widget as Customization (good parity). |
| 194 | Missing | No **test connection** or **session/start** health indicator for embed troubleshooting. |
| 195 | UX | **Extern** audience tab does not change embed path in visible snapshot (still team-oriented copy on first paint). |
| 196 | Question | Default Installation tab to **Extern** for customer-facing teams? |
| 197 | Idea | Live **script URL** field auto-filled with `window.location.origin` in bokito dev. |
| 198 | Idea | QR code or share link for mobile preview of public widget. |

### V. Settings pages (deep dive) (199–208)

| # | Type | Finding |
|---|------|---------|
| 199 | UX | **Inbox settings** (`/settings/inbox`): Dutch **Mailbox verbinden**, sync switch, Handtekening/Routing — coherent NL copy. |
| 200 | A11y | Inbox settings has **icon-only buttons** (refs without names) next to mailbox rows — need `aria-label`. |
| 201 | UX | **Detecteren** on branding disabled until website URL entered — no inline hint why disabled on first visit. |
| 202 | UX | Branding shows **two** color inputs (#4652f2 readonly + editable hex) — dual fields may confuse. |
| 203 | UX | **Chat assistent stijl** is a large button navigating to Messenger — not a inline link; easy to miss vs sidebar route. |
| 204 | UX | Settings sidebar **Billing** links to branding redirect target — label lie (known; still present on phase 3 pass). |
| 205 | UX | **Help centers** route (`/settings/help-centers`) initially rendered **empty shell** in snapshot — slow load or API hang (KB collections). |
| 206 | UX | **General** workspace settings not re-opened in phase 3 — still unverified for save/errors. |
| 207 | Question | Merge **Inbox settings** and **Assistant settings** under one **Communication** hub? |
| 208 | Idea | Branding save success should update **Customization preview** without full page reload. |

### W. Integrations documentation page (209–218)

| # | Type | Finding |
|---|------|---------|
| 209 | UX | **Documentation** tab is substantive — MCP OAuth steps, vendor URLs, developer repo paths. |
| 210 | i18n | MCP catalog descriptions mix **Dutch** body copy with **English** headings. |
| 211 | UX | Ten duplicate **Open in Marketplace** links — repetitive; one CTA per provider card enough. |
| 212 | Copy | Page references **`apps/runtime/src/mcp-oauth/`** and **`xano-patches/`** — removed from repo; misleads operators. |
| 213 | Copy | Lists **`GET /integrations/mcp/oauth/start`** — may not exist on FastAPI yet; doc ahead of implementation. |
| 214 | UX | Raw MCP endpoint URLs shown (Notion, Linear, Slack) — great for engineers, noisy for admins. |
| 215 | UX | **Platform requirements** block reads as internal runbook — consider collapsible **Admin** vs **Developer** tabs. |
| 216 | Missing | No **Copy setup checklist** for security review (scopes, redirect URIs). |
| 217 | Question | Hide developer repo links in bokito mode and show FastAPI-only setup? |
| 218 | Idea | Link each MCP card directly to **Connect** flow when available (not only Marketplace). |

### X. Database / Tables — root cause (219–228)

| # | Type | Finding |
|---|------|---------|
| 219 | Blocker | `/database` still hits **Something went wrong** error boundary (phase 3 confirmed). |
| 220 | Bug | **Root cause:** `DatabaseTablesPanel` in `SectionSidebar` calls `useDatabase()` but `DatabaseProvider` only wraps `<Outlet />` inside `DatabaseRouteLayout` — sidebar is **outside** provider (`Layout.tsx` structure). |
| 221 | Fix idea | Lift `DatabaseProvider` like `WorkspaceDocNavProvider` / `ProjectHubNavProvider` in `Layout.tsx` for `/database` routes. |
| 222 | UX | When fixed, expect Dutch table UI (Zoek in tabel, Bijv. Klanten) — verify i18n vs EN shell. |
| 223 | UX | Standard tables use placeholder id `-1` in field config — edge case for saves. |
| 224 | UX | Multiple view types (grid, kanban, calendar) — high surface area; none audited while crashed. |
| 225 | Missing | CSV import dialog not exercised — unknown error handling. |
| 226 | Question | Ship **Tables** rail only after provider fix + seed tables visible? |
| 227 | Question | Default first table: **Klanten** standard table vs empty custom? |
| 228 | Idea | Soft-fail sidebar: hide table list until provider ready instead of crashing app. |

### Y. Workforce and agents API (229–238)

| # | Type | Finding |
|---|------|---------|
| 229 | Bug | `GET /api/workforce/agents` returns **HTTP 500** (reproduced via API curl in phase 3). |
| 230 | Bug | Blocks **Agent library**, Workforce sidebar agent trees, and Messenger settings sidebar. |
| 231 | UX | `/workforce/agents` page snapshot **empty** (only toast region) — likely loading/error UI not in a11y tree. |
| 232 | UX | Non-admin users redirect to `/messages` from Agent library — OK; admin sees broken load. |
| 233 | UX | **Agent library** nav exists under Workforce but page unusable until agents API fixed. |
| 234 | UX | Platform agents (Assistant, Communication) still navigable via direct links while orchestrator lists error. |
| 235 | Missing | No **degraded mode** copy ("Agent list unavailable — retry") in sidebar error state. |
| 236 | Question | Should seed create 2–3 demo agents visible in library for local UX? |
| 237 | Idea | Split **platform agents** fetch from workforce agents endpoint to avoid total sidebar failure. |
| 238 | Idea | Surface agent 500 on Cockpit as incident banner ("Workforce degraded"). |

### Z. Inbox threads (phase 3) (239–248)

| # | Type | Finding |
|---|------|---------|
| 239 | UX | `/support/inbox/all` eventually loads **Open** queue with thread list (after brief empty shell). |
| 240 | UX | Deep link `/support/inbox/all/t/2` opens full three-pane UI — assign, close, delete, pin controls visible. |
| 241 | UX | List filters **Unread** and **Pinned** **disabled** on Open queue — unclear why (no unread vs bug). |
| 242 | UX | Thread header actions in **Dutch** (Toewijzen, Sluiten, Verwijderen, Pinnen) under EN **All messages** label. |
| 243 | UX | Composer **Stuur en sluit** / **Verstuur** disabled until text — good; no draft autosave indicator. |
| 244 | UX | Contact links **visitor@web** and **Mail** — good; phone still missing. |
| 245 | UX | **Verberg contactpaneel** toggle works (pressed state) — responsive layout OK on desktop. |
| 246 | UX | Queue label **Open** selected vs sidebar **Alle kanalen** — naming mismatch (Open vs All). |
| 247 | Question | Enable Unread/Pinned filters on all queues or explain disabled state? |
| 248 | Idea | Show **AI suggested reply** chip above composer when agent available. |

### AA. Performance and loading shells (249–255)

| # | Type | Finding |
|---|------|---------|
| 249 | Perf | Several routes show **1-ref snapshot** (only Notifications region) before paint: `/workforce/agents`, `/settings/help-centers`, initial `/support/inbox/all`. |
| 250 | UX | Slow routes lack **skeleton in section sidebar** — user sees blank main + rail only. |
| 251 | UX | Integrations docs loads fully formed — no spinner; good reference pattern. |
| 252 | UX | Marketplace still slow on cold nav (from phase 2); not re-measured in phase 3. |
| 253 | Question | Global **route loading bar** (NProgress) for perceived speed? |
| 254 | Idea | Suspense boundaries per major layout (Inbox, Workforce, Database). |
| 255 | Idea | Prefetch agents + projects on login to warm Workforce/Messenger sidebars. |

### AB. Auth and misc routes (256–262)

| # | Type | Finding |
|---|------|---------|
| 256 | UX | `/reset-password` while logged in — navigates away or empty; not tested logged out. |
| 257 | Missing | `/onboarding` not exercised in phase 3 — unknown if still reachable post-login. |
| 258 | UX | `/account` (control plane) not opened — workspace account settings unknown. |
| 259 | UX | API projects list empty (`GET /workforce/projects` → `[]`) — explains empty project selectors. |
| 260 | UX | `RoutingRulesManager` still uses **mockUsers** mock data — assignment rules not production-ready. |
| 261 | UX | `QuickActions` on home still imports **mock-data** when not in bokito Cockpit — dead path but code smell. |
| 262 | Question | Run Playwright pass after database provider fix to prevent regression? |

### AC. Product ideas (263–265)

| # | Type | Finding |
|---|------|---------|
| 263 | Idea | **Unified communication settings** page: branding + widget preview + inbox mailboxes + notification matrix. |
| 264 | Idea | **Health dashboard** tile: API status for agents, work_logs, workspace/doc, database. |
| 265 | Idea | **Demo mode** toggle that seeds projects, agents, threads, and fixes KPI zeros on Cockpit. |

---

### AD. Cockpit and home (266–272)

| # | Type | Finding |
|---|------|---------|
| 266 | UX | Cockpit loads six KPI cards; values show **0**, **-**, and **€0.00** with no empty-state guidance. |
| 267 | UX | No section sidebar on `/home` (by design) — full-width metrics only; large unused space below cards. |
| 268 | UX | Page label in rail **Home** vs title **Cockpit** — still inconsistent (carried from phase 1). |
| 269 | Data | Cockpit API returns 200 — zeros are real empty metrics, not a failed fetch. |
| 270 | Missing | No link from KPI cards to Inbox decisions, Workforce runs, or Usage detail. |
| 271 | Question | Replace Cockpit with legacy `HomeDashboard` mock charts in bokito mode, or keep AI OS KPIs only? |
| 272 | Idea | Cockpit **health row**: green/red dots for agents, work_logs, workspace/doc, database. |

### AE. Messenger: styling, agent tab, save path (273–285)

| # | Type | Finding |
|---|------|---------|
| 273 | UX | **Styling** sub-tab: accent defaults **#00FF99**, widget icon upload, color picker + hex field — works in preview. |
| 274 | UX | **Agent settings** tab explicitly states controls are **UI-only**; save does not persist model/stream/handoff settings. |
| 275 | UX | Agent settings hides **live widget preview** (by design) — users cannot see model-driven UI changes anyway. |
| 276 | UX | Model segmented control **Bokito AI / Custom**; Custom reveals model id + temperature — no validation on model id. |
| 277 | UX | **Stream responses** on by default; **Allow tool use** and **Include visitor page context** on — not wired to backend. |
| 278 | UX | **Conversation memory** default 12 turns — spinbutton present; no save path. |
| 279 | Bug | **Save changes** posts to `XANO_AUTH_API` + `authRoutes.workspaceBranding` — not ported to FastAPI `workspaces_portal` in bokito mode (save would fail even when enabled). |
| 280 | UX | Save disabled when `draft === saved` — editing welcome text should enable save; if not, workspace `messengerAppearance` may be uninitialized. |
| 281 | UX | Sidebar on Messenger pages shows resolved **HTTP 500 [/agents]** text (not infinite loading) after agents API fails. |
| 282 | Copy | Agent handoff copy references **Inbox later** for routing rules — cross-module dependency unclear. |
| 283 | Question | Port messenger save to `PATCH` tenant appearance on FastAPI first, or block page until ready? |
| 284 | Question | Persist agent settings to `AssistantPersona` / agent table, or hide tab until API exists? |
| 285 | Idea | Single **Publish** action: appearance + agent config + embed snippet validation. |

### AF. Project create wizard (286–291)

| # | Type | Finding |
|---|------|---------|
| 286 | UX | Step **1 of 2** visible with progress dots; **Continue** disabled until 30 non-space chars in scope — clear counter `0 / 30`. |
| 287 | UX | **URL slug** auto-generates from project name when slug not manually touched — corrects earlier “no auto-slug” note. |
| 288 | UX | Wizard uses full main layout (rail visible) — only section sidebar hidden; acceptable but noisy for focus mode. |
| 289 | UX | On success, navigates to **project orchestrator** path — step 2 (repo connect) may be skipped depending on API response. |
| 290 | Data | `GET /api/workforce/projects` returns `[]` — create flow is only path to get projects today. |
| 291 | Question | Lower scope minimum (e.g. 10 chars) for local dev, or keep 30 for quality? |

### AG. Communication hub vs thread inbox (292–298)

| # | Type | Finding |
|---|------|---------|
| 292 | UX | `/communication` defaults to **Decisions** tab with empty state **No open decisions right now** — not thread list. |
| 293 | UX | Header **Messages** + subtitle about AI team decisions — different metaphor than `/support/inbox/*/t/:id` threads. |
| 294 | IA | Same **Inbox** rail item opens either decisions feed or thread UI depending on URL — mental model split. |
| 295 | UX | Tabs **Decisions / Updates / Results** — Updates and Results not audited for content in phase 4. |
| 296 | UX | Inbox sidebar on `/communication` shows **Open** queue selected while hub is decisions — queue highlight may desync. |
| 297 | Question | Should rail **Inbox** land on `/support/inbox/mine` or `/communication` by default? |
| 298 | Idea | Rename `/communication` to **Decisions** in nav or add sub-nav **Conversations | Decisions**. |

### AH. Integrations MCP (299–304)

| # | Type | Finding |
|---|------|---------|
| 299 | UX | `/integrations/mcp`: tabs **External servers** (default) and **Bokito client** — second tab not opened in audit. |
| 300 | UX | **New MCP connection** CTA visible; **Configured connections** section empty in snapshot. |
| 301 | UX | Link **Read integrations documentation** — good cross-link to docs tab. |
| 302 | UX | Page hides duplicate `h1` via CSS (`[&_h1]:hidden`) — relies on AppHeader title. |
| 303 | Question | Is **Bokito client** MCP for internal tools only — show to all admins? |
| 304 | Idea | Empty MCP list: CTA to Marketplace filtered to MCP providers. |

### AI. Help centers, AI communicatie, misc routes (305–312)

| # | Type | Finding |
|---|------|---------|
| 305 | UX | `/settings/help-centers` slow to paint — initial empty document; needs KB API (`listKbCollections`). |
| 306 | UX | `/ai/communicatie` (Communication agent settings) — slow/empty shell on first snapshot; uses mailbox + `email-api` (not fully verified). |
| 307 | UX | `/workforce/po` and `/settings/general` not opened in phase 4 — still **unaudited**. |
| 308 | UX | `/account`, `/billing` control-plane pages not revisited. |
| 309 | Redirect | Catch-all `*` → `/` still ejects unknown routes to workspace picker. |
| 310 | Code | Pages with mock-only data not routed in bokito: `UsageDashboard`, `AuditLog`, `CloudAgent` — dead code risk. |
| 311 | Code | `Home.tsx` + `mock-data` stats unused when `USE_BOKITO_API` shows Cockpit — OK but increases confusion for contributors. |
| 312 | Question | Hide **Help centers** nav until KB API is ported to FastAPI? |

### AJ. Staff, floating messenger, accessibility (313–318)

| # | Type | Finding |
|---|------|---------|
| 313 | Missing | **Staff tenant bar** not visible for `admin@bokito.ai` — expected; staff flow with `staff@bokito.ai` still needs dedicated pass. |
| 314 | UX | `FloatingMessengerHost` loads `@bokito/messenger-ui` on every authenticated page — separate from restored `bokito-chat`. |
| 315 | UX | Floating **Assistant** button (snapshot) coexists with widget preview launcher — triple chat chrome on Messenger pages. |
| 316 | A11y | Several routes render with **0 interactive refs** briefly — route transition accessibility gap. |
| 317 | UX | `inbox.contactPanel.open` persisted in `localStorage` — good; not surfaced in settings UI. |
| 318 | Idea | Staff mode: banner **Viewing tenant X** with exit action (verify `StaffTenantBar` when staff logs in). |

### AK. Backend error surface (319–325)

| # | Type | Finding |
|---|------|---------|
| 319 | Bug | `GET /api/workforce/agents` → 500 (blocks sidebar + library). |
| 320 | Bug | `GET /api/workforce/work_logs?status=running` → 500 (Workforce overview banner). |
| 321 | Bug | `GET /api/workforce/workspace/doc` → 500 (Blueprint / Project hub docs). |
| 322 | Bug | `/database` crash — `useDatabase` outside provider (finding 220); separate from API 500s. |
| 323 | UX | Error format `HTTP 500 Onbekende fout [/path]` — path leaked; Dutch **Onbekende fout** in EN UI. |
| 324 | Fix order | Suggested: (1) database provider, (2) agents list, (3) work_logs query, (4) workspace doc service, (5) messenger save port. |
| 325 | Question | Single **error copy component** with retry + support id for all API failures? |

### AL. Session completeness and plan-mode flags (326–335)

| # | Type | Finding |
|---|------|---------|
| 326 | Gap | Logged-out **login / forgot-password / reset-password** not re-tested in phase 4 (session was active). |
| 327 | Gap | **Mobile / 375px** viewport not tested in any pass. |
| 328 | Gap | **Keyboard / focus** order not tested (FAB, modals, inbox composer). |
| 329 | Gap | **Marketplace Connect** OAuth flows not clicked (only docs + connected list in earlier passes). |
| 330 | Gap | **Project step 2** (`/projects/new/:id/connect`) not reached — requires successful create. |
| 331 | Ready | Widget preview restore verified visually — good baseline for extern site parity work. |
| 332 | Ready | Cockpit + inbox threads + MCP shell are usable enough for demos once API 500s fixed. |
| 333 | Blocked | Tables, Blueprint, Agent library, Messenger save — blocked on backend/architecture fixes. |
| 334 | Doc | This file is the **single source of truth** for UX audit until plan mode cuts scope. |
| 335 | Next | Plan mode should pick **one north-star journey** (e.g. admin lands → inbox → customize widget → embed) and fix P0s on that path only. |

---

## Plan mode decision backlog

Use this section when opening **Plan mode** in a follow-up prompt. Each item needs an owner decision before implementation ordering.

### A. Product entry and IA (decide first)

| ID | Decision | Options | Audit refs |
|----|----------|---------|------------|
| D1 | Post-login landing | Workspace picker always vs skip when one tenant vs role-based (`/home`, `/support/inbox/mine`, `/projects`) | 2, 10, 70, 297 |
| D2 | Primary inbox metaphor | Thread conversations first vs Decisions feed first vs split nav labels | 36, 44, 118, 292–298 |
| D3 | AI OS trio | Keep Orchestra + Agenda + Cockpit vs merge vs hide until wired | 26–34, 79–92 |
| D4 | Rail density | 9 icon-only items vs grouped **Operate / Build / Configure** | 20, 11–20 |
| D5 | Workspace picker role | Required for multi-tenant vs dev shortcut to Cockpit | 4, 10, 187 |

### B. Widget and messenger (high visibility)

| ID | Decision | Options | Audit refs |
|----|----------|---------|------------|
| D6 | Widget stack | `bokito-chat` only vs messenger-ui FAB only vs both with clear roles | 175–177, 314–315 |
| D7 | Preview chrome | Hide launcher FAB in preview mode vs keep for WYSIWYG | 167, 177 |
| D8 | Messenger save | Port to FastAPI appearance API vs disable save with banner | 279–280, 283 |
| D9 | Agent settings tab | Hide until persisted vs show with “coming soon” vs wire to persona API | 274–278, 284 |
| D10 | Livechat streaming | Implement FastAPI `stream-chat` vs disable chat send in local mode | 166–174, livechat 501 |

### C. Backend P0 (blocks multiple surfaces)

| ID | Decision | Options | Audit refs |
|----|----------|---------|------------|
| D11 | Database fix | Lift `DatabaseProvider` in `Layout` vs remove `DatabaseTablesPanel` from sidebar until ready | 219–221, 228 |
| D12 | Agents 500 | Fix query/schema vs mock list for local vs hide Workforce agent sections | 229–237, 319 |
| D13 | work_logs 500 | Fix endpoint vs remove “running” strip from overview | 51, 94, 320 |
| D14 | workspace/doc 500 | Fix `workspace_doc` service vs hide Blueprint until ready | 93, 321 |
| D15 | projects seed | Auto-seed demo project + agents on tenant bootstrap vs manual create only | 95, 259–260, 290 |

### D. Locale, copy, and errors

| ID | Decision | Options | Audit refs |
|----|----------|---------|------------|
| D16 | Language | NL-only vs EN-only vs per-user toggle with full i18n pass | 35, 59, 154, 242 |
| D17 | API errors | User-safe messages vs support reference id vs both | 51, 323, 325 |
| D18 | Notifications settings | Ship local-only draft vs hide page vs implement API | 149–150, 295 |

### E. Scope for v1 demo (what to hide)

| ID | Decision | Hide vs fix | Audit refs |
|----|----------|-------------|------------|
| D19 | Tables | Hide rail item vs fix provider + seed | 55–56, 219–228 |
| D20 | Agenda | Hide vs wire to Orchestra tasks | 31–34, 82–84 |
| D21 | Help centers | Hide vs port KB API | 305, 312 |
| D22 | Integrations docs | Rewrite for FastAPI vs keep engineer doc | 212–217 |
| D23 | Mock pages | Delete unrouted mock pages vs leave | 310–311 |

### F. Suggested implementation waves (after decisions)

| Wave | Goal | Likely work | Depends on |
|------|------|-------------|------------|
| W0 | Unblock crashes | Database provider; agents + work_logs + workspace/doc 500s | D11–D14 |
| W1 | Admin happy path | Open workspace → `/home`; inbox threads default; messenger save + preview | D1, D2, D8 |
| W2 | Build path | Seed project; fix project hub selector; Blueprint read | D15, D14 |
| W3 | Polish | i18n, error component, hide/fix scaffolds, Orchestra/Agenda | D16–D23 |

---

## Questions for you (product / layout) — extended

1. **Entry point:** After login, should users always see workspace picker, or only when `memberships.length > 1`?
2. **Default landing:** Cockpit, Inbox, or Project hub for admin role?
3. **Language:** Single locale (NL vs EN) per workspace, per user, or follow browser?
4. **Inbox vs Decisions:** Is the `/communication` decisions feed legacy; should rail **Inbox** open thread list first?
5. **Orchestra vs Agenda vs Workforce:** One "AI planning" area or three distinct mental models?
6. **Database:** Required for v1 demo, or hide Tables rail until crash fixed?
7. **Assistant button:** Hide in bokito mode, wire to internal messenger, or restore widget?
8. **Staff tenant bar:** Should `staff@bokito.ai` be the default demo account for multi-tenant UX?
9. **Workspace URL on cards:** What should display in local, staging, and production?
10. **Error policy:** Replace raw HTTP paths with user-safe messages everywhere?
11. **Rail density:** Keep 9 icon-only items or group (Operate / Build / Configure)?
12. **Blueprint vs Orchestra docs:** Single doc product or separate concerns?
13. **Notification settings:** Ship local-only draft or block page until API exists?
14. **Marketplace:** Show all providers or curated "bokito mode" subset?
15. **Project creation:** Lower min description length for MVP (e.g. 10 chars)?
16. **Tenant subdomain editing:** Allow on local dev or disable outside production?
17. **Inbox default queue:** `all`, `mine`, or `unassigned` for admins?
18. **Public vs internal assistant:** Same config screen order (Intern first) for all customers?
19. **Billing in-app:** Merge workspace picker billing into Settings or keep separate?
20. **Empty states:** Illustration + primary CTA standard on every major page?
21. **Widget dual stack:** Standardize on `bokito-chat` only, or keep messenger-ui for FAB?
22. **Preview launcher:** Remove FAB in editor preview mode?
23. **Database provider:** Fix in Layout vs move tables panel inside outlet only?
24. **Agents 500:** P0 same tier as work_logs — block release?
25. **Help centers:** Ship in v1 or hide nav item until KB API works?
26. **Integrations docs:** Rewrite for FastAPI-only local docs?
27. **Inbox queue naming:** Open vs All vs Alle kanalen — pick one vocabulary?
28. **Extern vs Intern defaults:** Which audience do most admins configure first?
29. **Embed copy button:** Show toast on copy success?
30. **User menu theme:** Match profile theme control (System/Light/Dark)?
31. **Project seeding:** Auto-create demo project on tenant bootstrap?
32. **Degraded sidebar:** Show partial Workforce nav when agents API fails?
33. **Floating Assistant:** Wire to internal chat or hide until stream-chat works?
34. **Module Tools tab:** Add toggle or remove from preview nav?
35. **Save on Messenger:** Enable save when dirty + API PATCH appearance?
36. **Route loading:** Accept blank 1–2s flashes or add skeletons everywhere?
37. **Mock routing users:** Replace with real members list from auth API?
38. **Health strip:** Optional admin-only API status on Cockpit?
39. **Mobile audit:** Dedicated narrow-viewport pass needed?
40. **Audit process:** Continue to 365 findings or switch to fix P0 list?

---

## Suggested priority (engineering)

| Priority | Item |
|----------|------|
| P0 | Fix `/database` crash: wrap `SectionSidebar` + outlet in `DatabaseProvider` (see finding 220). |
| P0 | Fix `GET /api/workforce/agents` 500 (blocks Messenger sidebar + Agent library). |
| P0 | Fix `GET /work_logs?status=running` and `GET /workspace/doc` 500s. |
| P1 | Fix `resolveTitle` / `iconForLink` defaults (Orchestra, Agenda → not Inbox). |
| P1 | Fix section sidebar title (always "Inbox" → dynamic from route). |
| P1 | Workspace **Open** → `/home` (or remembered route), fix `bokito.0.1` URL display. |
| P1 | User-safe API error copy (NL/EN consistent). |
| P2 | Orchestra load/empty state + CTA; wire Agenda to orchestra tasks or hide. |
| P2 | Inbox default view: threads vs decisions; complete assignee/mailbox fields. |
| P2 | Project list empty state + seed visibility. |
| P3 | Cockpit drill-downs, onboarding empty states, i18n pass, Assistant button decision. |

---

## Routes exercised

| Route | Result |
|-------|--------|
| `/` | Workspace picker |
| `/home` | Cockpit metrics |
| `/orchestra` | Loading → scheduled tasks empty |
| `/agenda` | Kanban placeholders |
| `/projects` | Hub loading / 0 projects |
| `/projects/new` | 2-step create form |
| `/communication`, `/support/inbox/unassigned`, `/support/inbox/mine` | Decisions vs threads |
| `/workforce/overview` | 500 on work_logs |
| `/database` | Error boundary |
| `/integrations/connected` | Loaded integrations |
| `/integrations/marketplace` | Slow spinner; then full provider grid |
| `/integrations/api` | Coming soon placeholder |
| `/settings/notifications` | 21 toggles; local-only draft banner |
| `/settings/profile`, `/settings/branding`, `/settings/members` | OK |
| `/ai/assistent/internal/customization` | Widget preview OK; save disabled; sidebar agents 500 |
| `/ai/assistent/internal/installation` | Embed copy + preview; Xano paths in copy |
| `/ai/assistent/external/customization` | Same layout as internal; Extern tab selected |
| `/projects/docs` | HTTP 500 workspace doc |
| `/forgot-password` | NL form; validation on empty |
| `/billing`, `/support` (control plane) | Placeholder copy only |
| `/login` | Redirect when session active |
| `/settings/inbox` | NL mailbox UI; unnamed icon buttons |
| `/integrations/docs` | Full MCP catalog; stale repo references |
| `/support/inbox/all/t/2` | Three-pane thread UI; filters partially disabled |
| `/database` | Error boundary (provider bug) |
| `/workforce/agents` | Empty/broken (agents 500) |
| User menu | Profile, theme, workspaces, sign out |
| `/home` | Cockpit KPIs loaded (zeros); API 200 |
| `/ai/assistent/internal/agent` | UI-only agent settings; preview hidden |
| `/ai/assistent/internal/customization` (Styling) | Accent + favicon upload |
| `/integrations/mcp` | External servers tab; empty connections |
| `/projects/new` | Step 1 wizard; auto-slug; 30-char scope gate |
| `/communication` | Decisions tab empty state |
| API probe | cockpit 200; agents/work_logs/workspace/doc 500 |

---

## Audit session complete

Further UX discovery should happen **after** W0 fixes, not as a fifth passive pass. For planning, start from **Plan mode decision backlog** (D1–D23) and **Suggested implementation waves** (W0–W3).

## Implementation status (2026-06-04)

Dashboard UX remediation plan executed in-repo:

- **W0:** `init_db` imports all models; Alembic `002_schema_sync`; `OperationalError` → 503; tenant bootstrap seeds demo project + blueprint overview; Tables rail hidden; `DatabaseTablesPanel` removed from sidebar; `apps/api/DEV_DATABASE.md`.
- **W1:** Open workspace → `/home`; single-tenant picker skip; rail inbox → `/support/inbox/mine`; unified inbox tabs; `/communication` redirect; `ApiErrorBanner`; workforce sidebar hidden on agents API failure; FAB removed; branding + persona + livechat SSE; Cockpit KPI links.
- **W2:** Full Orchestra tabs UI; Agenda wired to orchestra tasks; project create min 10 chars.
- **W3:** Notification preferences API; integrations docs bokito card; help centers coming soon; mock pages removed (`CloudAgent`, `UsageDashboard`, `AuditLog`).

**Local QA:** If API returns 503 `schema_out_of_date`, stop API, delete `apps/api/dev.db`, run `uv run python scripts/seed.py`.

### Remaining manual QA (post-fix)

- Staff tenant switcher (`staff@bokito.ai`)  
- Logged-out auth flows  
- Mobile 375px + keyboard pass  
- Marketplace OAuth Connect per provider  
- Project wizard step 2 after successful create  
- Help centers + `/ai/communicatie` full load  
- Click **Kopieer embed-HTML** clipboard feedback  
