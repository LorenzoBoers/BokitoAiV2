# Code-opschoning: efficiëntie, modulariteit, eenvoud

> Analyse van 2026-10-21 (statisch, op `main` na v1.2.21). Doel: schoner en effectiever **zonder gedrag te breken**.
> Ronde 1 = mechanisch en veilig. Ronde 2 = structureel, pas na een sterker vangnet.

## Regels voor elke stap

- Geen gedragswijziging in ronde 1: alleen verplaatsen, verwijderen van bewezen dode code, en interne vereenvoudiging achter dezelfde publieke signatures.
- Na elke stap groen: `cd apps/api && uv run pytest -q`, `ruff check app tests`, `cd apps/dashboard && npx tsc --noEmit && npx vitest run`, `npm run test:e2e`.
- Eén stap = één commit/PR. Imports die verplaatsen krijgen een re-export op de oude plek zodat niets breekt.
- Dode code pas verwijderen na `rg <naam>` over de hele repo (incl. `apps/mobile`, `apps/chat-widget`, `packages/`, `e2e/`, dynamische imports en string-referenties).

---

## Ronde 1 — veilig en mechanisch

### Stap 1. CI-vangnet voor het dashboard (eerst!)

**Probleem:** de dashboard-job in `.github/workflows/ci.yml` draait alleen `vite build`. Vite checkt geen types; vitest draait niet in CI. Lokaal geeft `tsc --noEmit` nu ~37 type-fouten (o.a. `pages/Communication.tsx` (PatchThreadInput → `Promise<boolean>` vs `Promise<void>`), `components/inbox/ThreadDetail.tsx`, `components/inbox/AgentThreadPanel.tsx`, `components/channels/ChannelPanel.tsx`, `components/integrations/ConnectionScopeEditor.tsx`, `lib/signals-api.ts`, en meerdere `*.test.ts` in `lib/`).

**Doen:**
- [ ] Type-fouten fixen (types aanpassen, geen runtime-gedrag).
- [ ] In `ci.yml` dashboard-job toevoegen: `npx tsc --noEmit -p apps/dashboard` en `npm test -w bokito-dashboard`.
- [ ] Optioneel: `npm run lint -w bokito-dashboard` (boundaries/design/copy checks) ook in CI.

### Stap 2. Dode code verwijderen

**Frontend (bevestigd zonder importeurs):**
- [ ] `components/inbox/ChatMarkdown.tsx` (292)
- [ ] `context/KeyboardNavigationContext.tsx` + `hooks/useKeyboardNavigation.ts` (~370)
- [ ] `components/ui/file-upload.tsx` (185)
- [ ] `components/mcp/McpServerSetupTab.tsx`
- [ ] Stubs die alleen `return null` doen: `components/projects/ProjectAgentsSection.tsx`, `ProjectBudgetEditor.tsx`, `ProjectOrchestratorSection.tsx`, `ProjectRepoSection.tsx` (en hun call-sites)

**Frontend (kandidaten, eerst verifiëren):** `components/agenda/CalendarConnectBar.tsx`, `folders/FolderTitleTags.tsx`, `inbox/InboxHeaderSearch.tsx`, `projects/ProjectBudgetBar.tsx`, `projects/ProjectFolderFlows.tsx`, `shell/RouteTabs.tsx`, `ui/progress.tsx`, `ui/TagIcon.tsx`, `lib/block-editor-caret.ts`, `lib/budget-copy.ts`, `lib/github-oauth.ts`, `lib/orchestration-tasks-api.ts`, `lib/project-hub-last-opened.ts`, `lib/run-status-label.ts`, `lib/slug.ts`, `lib/user-facing.ts`, `types/inbox.ts`, `types/mcp.ts`.

**Backend:**
- [ ] Retired tools `add_graph_node` en `connect_graph_nodes` (`tools/builtin.py` ~r. 5193–5240) uit de registry halen — ze komen nu in agent-tooldefinities en de MCP-lijst en kosten tokens. Check eerst of agents/permissies ze bij naam noemen.
- [ ] De 7 OS-graph-endpoints in `routers/workforce.py` die alleen `os_graph_retired_response()` (410) geven: bevestig dat geen client (dashboard, mobile, externe MCP) ze aanroept, dan verwijderen samen met `services/os_graph.py`/`models/os_graph.py` waar mogelijk.
- [ ] `decision_actions._retired_step_run` en legacy-aliassen (`"off"`/`"on"` in `modules/catalog.py`) inventariseren; verwijderen waar geen opgeslagen data meer van afhangt.

**Repo-hygiëne:**
- [ ] Bestand `-w` in de root verwijderen (per ongeluk opgeslagen Vite-HTML).
- [ ] `restructuring plan/` naar `docs/` archief of verwijderen.
- [ ] `apps/api/scripts/smoke_cycle27.py`, `smoke_cycle32.py`: nog nodig?
- [ ] `BOKITO_KNOWLEDGE.md` (943 KB): opsplitsen naar `docs/` en in `.cursorignore` overwegen, zodat het niet standaard in context belandt.

### Stap 3. `apps/api/app/tools/builtin.py` opsplitsen (7.187 regels, 101 tools)

De architectuur (één registry, één executor, één policy) blijft. Alleen verplaatsen, zoals al gedaan voor `calendar.py`, `contacts.py`, `tickets.py`.

- [ ] `tools/messaging.py` — send_reply, internal notes, invite/leave/post thread, ask_agent, handoff, start_conversation, suggest/no-reply, react, take_over, close, mark_handled, record_read, whatsapp/callback/verify
- [ ] `tools/decisions.py` — create_decision_request, proposal_cooldown, propose_action, resolve_decision, `_DECISION_ACTIONS`
- [ ] `tools/tags.py` — list/create/update/delete/merge tags, label plans, set_thread_tags, contact tags
- [ ] `tools/scheduling.py` — schedule_task, thread schedule, schedule_wake, `_parse_when`
- [ ] `tools/work.py` — dispatch/follow_up/cancel_work, report_progress, ask_question, attach_artifact
- [ ] `tools/platform.py` — `_make_platform_handler`, `_snapshot_before`, platform-change tools, ai_handling setters, posture
- [ ] `tools/subagents.py`, `tools/trash.py`, `tools/workspace_read.py` (overview, activity, list agents/flows/triggers/teams)
- [ ] `tools/builtin.py` wordt een dunne module die de submodules importeert (registratie gebeurt bij import), zodat bestaande imports blijven werken.
- [ ] Gedeelde helpers (`_get_tenant`, `_target_signal_id`, `_resolve_messaging_signal`) naar `tools/_common.py`.
- [ ] Na de split: function-local imports (nu 187 in dit bestand) waar mogelijk naar module-niveau.

**Check:** het aantal geregistreerde tools en hun namen is voor en na identiek (kleine test: snapshot van `iter_tool_specs()` namen).

### Stap 4. `apps/api/app/services/signal_threads.py` naar een package (5.081 regels)

- [ ] `services/signal_threads/serialize.py` — serialize_thread/message/event, proposal_payload, bundle_entry_payload, previews, mentions
- [ ] `.../queries.py` — predicates (`_search_predicate`, `_visibility_predicate`, `_needs_reply_predicate`, `_hub_predicate`, …), list_threads, get_thread, attention_counts, nav_badge_counts
- [ ] `.../mutations.py` — patch_thread, bulk_update_threads, delete_thread, set_read, notes
- [ ] `.../reply.py` — reply_to_thread, outbound delivery, scheduled messages, agent-reply scheduling
- [ ] `.../pins.py` — pins, stack, list_members
- [ ] `.../decisions.py` — resolve_message_decision, resolve_decision_bundle, follow-ups
- [ ] `services/signal_threads/__init__.py` re-exporteert alle publieke namen → geen import breekt.

### Stap 5. Dashboard API-client vereenvoudigen (`apps/dashboard/src/lib/api.ts`)

**Probleem:** ~35 bijna identieke wrappers (7 base-prefixes × get/post/patch/put/delete: `apiGet`, `appScopedGet`, `workforceGet`, `foldersGet`, `settingsGet`, `staffGet`, `apiGetAuth`, …). Daarnaast nemen 118 API-functies een `token`-parameter, terwijl `resolveAccessToken()` al terugvalt op de token-provider.

- [ ] Eén `createClient(base)` die `{ get, post, patch, put, delete }` teruggeeft; bestaande wrappers worden one-liners daarop (zelfde signatures, dus niets breekt).
- [ ] `token`-parameters optioneel laten en geleidelijk weghalen bij call-sites.
- [ ] Losse `fetch(`-aanroepen die de client omzeilen naar de client brengen (o.a. `lib/workforce-api.ts` 13×, `hooks/useChatStack.ts`, `hooks/useThreadDetail.ts`, `hooks/useThreads.ts`, `lib/mcp-oauth-api.ts`). Let op streaming/SSE-calls: die mogen apart blijven.

### Stap 6. Eén preferences-store

**Probleem:** negen modules doen elk een eigen GET/PATCH op `/me/preferences`, met eigen localStorage-cache en eigen CustomEvent: `rail-prefs`, `email-close-pref`, `language-preference`, `landing-preference`, `outbound-channel-pref`, `inbox-folder-prefs` (+ `hooks/useInboxFolderPrefs`), `communication-sidebar-prefs`, `tour-api`, `pages/OnboardingWizardPage`. Gevolg: meerdere identieke requests bij opstart en verspreide logica.

- [ ] `lib/preferences.ts`: één fetch (gedeelde inflight-promise), één cache, `getPref(key)`, `setPref(key, value)` (PATCH per key), één subscribe-mechanisme.
- [ ] Hook `usePreference(key, fallback)`.
- [ ] Bestaande modules worden dunne wrappers op de store (publieke functies blijven bestaan), daarna geleidelijk inline.
- [ ] Localstorage-keys behouden zodat bestaande gebruikers hun gecachte waarden houden.

---

## Ronde 2 — structureel (na ronde 1 en met sterker vangnet)

### 7. Services loskoppelen van HTTP
103 servicebestanden bevatten samen 378 `raise HTTPException`, terwijl services ook door workers, tools en MCP worden aangeroepen. `app/exceptions.py` heeft al `AppError`, `NotFoundError`, `ForbiddenError`, … (nu 28× gebruikt). Migreren per domein; de exception-handler mapt naar dezelfde HTTP-responses, dus API-contract blijft gelijk.

### 8. Circulaire afhankelijkheden / platte `services/`
2.922 imports binnen functies (top: `tools/builtin.py` 187, `services/signal_threads.py` 145, `routers/signals.py` 83, `services/agent/loop.py` 79, `routers/integrations.py` 78, `workers/tasks.py` 68). Oorzaak: 230 platte servicebestanden. Groeperen in domeinpackages: `conversations/`, `decisions/`, `agents/`, `integrations/`, `channels/`, `models_llm/`, `tenants/`. Daarna import-regels afdwingen (bijv. `import-linter`).

### 9. Eén decision-service
Resolutie zit nu op 5–6 plekken: `notifications.resolve_decision`, `decisions.resolve_decision_message`, `signal_threads.resolve_message_decision` (424 r.), `signal_threads.resolve_decision_bundle`, `proposal_items._resolve_one` (417 r.), tool `_resolve_decision`, plus `decision_actions.py` en `signal_decisions.py`. Eén pad: valideren → optie kiezen → actie uitvoeren → follow-up/publish.

### 10. Megafuncties opknippen (28 functies > 200 regels)
`workers/tasks.py::_process_inbound_signal` (665), `org_flow.build_org_flow` (620), `proposal_items._resolve_one` (417), `time_items.list_time_items` (404), `org_graph.build_org_graph` (391), `tools/executor._execute_tool` (360), `signal_threads.get_thread` (312), `triggers.fire_trigger` (302), `signal_threads.list_threads` (293), `signal_threads.reply_to_thread` (285), `agent/loop._build_system_prompt` (243). Eerst karakteriseringstests, dan extract-function.

### 11. Tests op Postgres, SQLite-convergentie weg
Tests draaien op SQLite, productie op Postgres. Daarvoor bestaat ~1.600 regels converge-code (`db/schema_patch.py` — frozen maar draait nog op SQLite — `db/sqlite_converge.py`, `db/ai_handling_converge.py`). Postgres-service in CI + Alembic voor tests → converge-code grotendeels verwijderbaar en echte Postgres-bugs worden gevangen.

### 12. Frontend data-laag: één patroon
Drie cachepatronen naast elkaar: module-cache met inflight (`hooks/useAgents.ts`, `useMembers`, `usePinnedIds`), `lib/live-store` (`useTeams`), en losse `useEffect`-fetches (234 bestanden met `useEffect`). Kiezen voor één patroon (voorstel: TanStack Query met invalidatie vanuit de websocket/live-bus). Handgeschreven API-types (`lib/bokito-api.ts` e.a.) genereren uit de FastAPI OpenAPI-spec (`openapi-typescript`) zodat front en back niet uit elkaar lopen.

### 13. Tenant-/vendor-specifieke code naar modules
`services/alpaca.py`, `services/king_finance.py`, `services/moneybird.py`, `services/bjorn_lunden.py` (clients) staan in de core, terwijl de adapters in `modules/accounting/adapters/` staan. Client + adapter onder de module samenbrengen. `scripts/tenants/autotrading` uit de core-repo of naar een tenant-plugin.

### 14. Grote frontend-componenten
`components/inbox/TimelineItem.tsx` (3.300), `components/inbox/ThreadDetail.tsx` (2.565), `pages/Communication.tsx` (2.139), `lib/signals-api.ts` (2.002), `components/org/OrgMakeScene.tsx` (1.860), `lib/inbox-api.ts` (1.691), `components/inbox/ReplyComposer.tsx` (1.641). Per bericht-type een subcomponent voor `TimelineItem`; hooks extraheren uit `ThreadDetail`/`Communication`.

### 15. Terminologie
"signal", "thread" en "conversation" zijn hetzelfde begrip (elk in ~160–210 Python-bestanden). Eén naam kiezen voor nieuwe code; bestaande namen geleidelijk aliassen. Langetermijn, maar draagt direct bij aan begrijpelijkheid.

---

## Kanttekeningen
- Statische analyse; backend-tests niet gedraaid tijdens de analyse.
- De dode-code-lijst voor de frontend is heuristisch (geen importeur gevonden op bestandsnaam); per bestand verifiëren.
- Een deel van de `tsc`-fouten (`@bokito/shared` niet gevonden) kwam door module-resolutie in de analyse-omgeving, niet per se in CI.

---

# Analyse-ronde 2 (2026-10-22): security, performance, kosten, runtime

## A. Urgent — security

### A1. Reset-/verificatietokens in de API-response buiten productie
`routers/auth.py::_dev_magic_link` geeft `dev_token` + `dev_link` terug zodra `ENVIRONMENT` niet `prod`/`production` is. `scripts/setup-remote-dev.sh` zet `ENVIRONMENT=dev`; staging gebruikt `ENVIRONMENT=staging`. Gevolg op publiek bereikbare omgevingen (dev.app.bokito.ai, staging): `POST /api/auth/password-reset-request` met alleen een e-mailadres levert direct een geldige reset-token op → account-overname. Geldt ook voor `/verify-email`.
- [ ] Vervangen door expliciete vlag, bv. `EXPOSE_DEV_AUTH_TOKENS` (default `False`), alleen aan in lokale dev/e2e.
- [ ] e2e en `ForgotPassword.tsx` / `VerifyEmailBanner.tsx` / `ProfileSettingsContent.tsx` blijven werken waar de vlag aan staat.
- [ ] Daarna: reset-tokens op dev/staging roteren (bestaande tokens verlopen na 60 min).
- [ ] Bijvangst: alle checks die nu `not is_production` betekenen langslopen (`config.py` r. 226, 312, 325) — dev/staging op een publiek domein zijn geen "veilige" omgevingen.

### A2. Rate limiter is te omzeilen via `X-Forwarded-For`
`middleware/rate_limit.py::_client_ip` neemt de **eerste** waarde van `X-Forwarded-For`. Die is door de client zelf te zetten (Caddy voegt alleen toe), dus elke request kan een nieuw "IP" claimen → login/2FA/reset-limieten werken niet.
- [ ] Laatste hop gebruiken (gezet door Caddy), of uvicorn met `--proxy-headers --forwarded-allow-ips=<caddy>` en dan `request.client.host`.
- [ ] Limiter staat in-process; bij meer workers → Redis-backed (Redis draait al).

### A3. Verouderde auth-dependencies
`python-jose` (onderhoud gestopt, bekende CVE's) en `passlib` (onderhoud gestopt; dwingt `bcrypt<5`). Vervangen door `PyJWT` en `bcrypt` direct (of `pwdlib`). Klein oppervlak: 4 resp. 2 bestanden.

## B. LLM-kosten en latency

### B1. Geen prompt caching
`grep cache_control` → 0 treffers. Elke agent-turn stuurt de volledige tooldefinities (100+ tools) en system prompt opnieuw ongecachet naar Anthropic. Ook geen tracking van `cache_read_input_tokens`.
- [ ] `cache_control` breakpoint op de tools en het statische deel van de system prompt in `services/agent/llm.py::_create_kwargs`. Dynamisch deel (`extra_context`, `user_query`-retrieval uit `_build_system_prompt`) achteraan zetten zodat de prefix stabiel blijft.
- [ ] Tool-volgorde deterministisch houden (anders mist de cache).
- [ ] `cache_creation_input_tokens` / `cache_read_input_tokens` meenemen in usage/spend (`spend_guard`, usage-tabellen).
- Verwachting: fors lagere input-kosten en snellere eerste token bij multi-turn agent-loops.

### B2. Nieuwe SDK-client per LLM-call
`AsyncAnthropic(...)` en `AsyncOpenAI(...)` worden per `chat`/`stream_chat` aangemaakt (`llm.py` r. 568, 617, 791, 859; `embeddings.py`; `image_providers.py`) → geen connection reuse, extra TLS-handshakes. Idem 51× `httpx.AsyncClient(` in 31 bestanden.
- [ ] Clients cachen per (provider, api_key, base_url); gedeelde `httpx.AsyncClient` per integratie met lifespan-close.

## C. Frontend performance

### C1. Alle vertalingen in de initiële load
`src/i18n/index.ts` importeert statisch en/nl × 10 namespaces (~960 KB JSON); `manualChunks` bundelt ze in één `locales`-chunk die in `index.html` als modulepreload staat: **~240 KB gzip** bij elke eerste load, terwijl de gebruiker één taal ziet.
- [ ] Per taal (en evt. namespace) lazy laden, bv. `i18next-resources-to-backend` met `import(\`../locales/${lng}/${ns}.json\`)`; `common` + `nav` van de actieve taal eager.

### C2. Main chunk
`index-*.js` is 750 KB (213 KB gzip) ondanks 54 lazy routes. Met `rollup-plugin-visualizer` uitzoeken wat er in de shell meelift (vermoedelijk inbox/timeline-code en zware libs die vanuit gedeelde componenten geïmporteerd worden).

### C3. Interval-metingen
`ChatStack.tsx` meet elke 500 ms, `TourContext.tsx` elke 400 ms (layout reads → reflow). Vervangen door `ResizeObserver`/`MutationObserver`.

### C4. Google Fonts extern
`index.html` laadt Inter/JetBrains Mono van fonts.googleapis.com. Voor een EU-SaaS (AVG; Duitse rechtspraak over IP-doorgifte) beter self-hosten via `@fontsource/*` — ook sneller (geen extra origin).

## D. Backend runtime

### D1. Sync werk in async routes
`doc_ingest.extract_text` (pypdf/python-docx) wordt synchroon aangeroepen in `routers/kb.py` en `routers/workspace.py` → blokkeert de event loop bij grote uploads. In `asyncio.to_thread` zetten (zoals `module_sources._crawl_in_thread` al doet).

### D2. Queries in loops
155 `await session.execute/get` binnen for-loops in 71 bestanden (top: `org_graph.py` 9, `signal_threads.py` 8, `signal_tags.py` 6, `agent_turns.py` 5, `model_catalog.py` 5). Niet alles is een probleem (bulk-mutaties), maar in read-paden (`list_threads`, `get_thread`, nav counts, org graph) per geval batchen met `IN (...)`/`selectinload`.
- [ ] Eerst meten: SQLAlchemy query-count per request loggen in dev (middleware die `before_cursor_execute` telt) en de top-endpoints aanpakken.

### D3. `datetime.utcnow()` — 534 aanroepen
Deprecated sinds Python 3.12 en naïeve datetimes (zie pin `sqlmodel<0.0.45` in `pyproject.toml`). Eén helper `utcnow()` in `app/core/time.py` → later in één keer naar aware datetimes.

### D4. Python-versie drift
CI draait 3.11, Docker `python:3.12-slim`, lokaal draait 3.14 (zie `__pycache__/*.cpython-314.pyc`). Eén versie kiezen (3.12) en vastleggen in CI, Dockerfile, `.python-version` en `requires-python`.

### D5. Breed `except Exception`
258 keer, waarvan ~20 met alleen `pass`. De `pass`-gevallen minimaal laten loggen (`logger.exception`), anders verdwijnen fouten in agent-/sync-paden stil.

## Status ronde 2 (2026-10-22, uitgevoerd door Claude, niet gecommit)

Gedaan (getest op een schone checkout van `master` @ 9ba160f, daarna dezelfde wijzigingen in de werkmap gezet):
- [x] A1 `EXPOSE_DEV_AUTH_TOKENS` (default uit) — `config.py`, `routers/auth.py`; aan in `tests/conftest.py`, `scripts/run_e2e_api.py`, `apps/api/.env.example`. Test: `tests/test_auth_hardening.py`.
- [x] A2 rate limiter: laatste trusted hop uit `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`, default 1 = Caddy). Test: `tests/test_auth_hardening.py`.
- [x] A3 `python-jose` + `passlib` → `PyJWT` + `bcrypt` (`services/auth.py`, `dependencies.py`, `routers/uploads.py`, `services/livechat_compat.py`, 2 tests, `pyproject.toml`, `uv.lock`). Bestaande hashes/tokens blijven geldig: `tests/test_auth_libs.py`.
- [x] B1/B2 prompt caching + gedeelde SDK-clients: nieuw `services/agent/llm_efficiency.py`, hooks in `services/agent/llm.py`, `LLM_PROMPT_CACHING` in `config.py`. `input_tokens` = billing-equivalent (cache writes ×1.25, reads ×0.1), ruwe cache-tellers erbij. Test: `tests/test_llm_efficiency.py`.
- [x] C1 vertalingen per taal lazy (`src/i18n/index.ts`, `main.tsx` wacht op de actieve taal, `vite.config.ts` chunk per taal, `DocsChrome.tsx` laadt docs-taal). NL-gebruiker: ~126 KB gzip i.p.v. ~240 KB. Test: `src/i18n/index.test.ts`.
- [x] C4 fonts self-hosted via `@fontsource/inter` + `@fontsource/jetbrains-mono` (latin). **Na pull: `npm install` draaien.**
- [x] D1 `extract_text` via `asyncio.to_thread` in `routers/kb.py` en `routers/workspace.py`.

Bewust (nog) niet gedaan:
- C2 main chunk / D2 queries in loops: eerst meten (visualizer / query-teller), niet blind refactoren.
- C3 intervals: na inspectie laag rendement (2×/s één DOM-meting); MutationObserver zou bij streaming chat juist vaker meten.
- D3 `utcnow()` (534×) en D5 `except Exception: pass` (20×): repo-breed, botst met de lopende ronde-1-wijzigingen. Uitvoeren zodra die gecommit zijn.
- D4 Python-versie: in `.github/workflows/ci.yml` twee keer `python-version: '3.11'` → `'3.12'` (gelijk aan Docker). Kon het bestand niet schrijven vanuit deze sessie.
