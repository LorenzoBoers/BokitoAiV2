# IA restructuring, phase 2 (implementation spec)

**Status:** ready to implement, not started.
**Follows:** phase 1 (Slack parked, `/modules` → `/connections`, decision provenance + deep link, platform check-in on the agent channel).
**Scope:** four blocks — channels hub, agenda/automations split, runs terminology, help doors. Phase 3 (playbooks, proactive agent, mobile shell) stays a direction, not a spec.

Guiding rules from [`docs/CORE_INTENT.md`](CORE_INTENT.md): one mental model per surface, no parallel stacks, no back-compat shims during the build phase. Every block below ships with its own tests and product-help update.

---

## P2.1 Channels hub on `/settings/channels`

### Today

Communication settings are three unrelated nav entries under `settings.groups.communication`
(`components/shell/SettingsLayout.tsx` L29-35):

| Nav label | Route | Page | Size |
| --- | --- | --- | --- |
| Email & messages | `/settings/channels` | `pages/InboxSettings.tsx` | ~780 lines |
| Inbox AI | `/settings/communication` | `pages/AiCommunicationSettings.tsx` | ~778 lines |
| Chat widget | `/ai/assistant/:audience/:section` | `pages/MessengerSettings.tsx` | ~1034 lines |

Two of the three pages already cross-link with `PageRelatedLinks`, which is the symptom: the
operator has to know that "who answers email" lives on one page and "who answers the widget" on
another.

"Who answers" exists three times over the same `ChannelBinding` rows:

1. `components/inbox/ChannelList.tsx` L422-426 — `AgentBindingPicker` per channel row (`channelAccountId={row.id}`, priority 20).
2. `pages/MessengerSettings.tsx` L661-664 — `AgentBindingPicker` with `channel="widget"`, channel-wide (priority 10).
3. `pages/AiCommunicationSettings.tsx` L675 — `ChannelBindingsPanel`, a tenant-wide CRUD table with editable priority.

`AgentBindingPicker` replaces a binding by deleting the matching rows and creating one;
`ChannelBindingsPanel` does real POST/PATCH/DELETE. Same table, two write styles.

### Target

`/settings/channels` becomes a hub with four route-based subsections. Keep the existing pages as
the section bodies; do not merge their internals in this block.

| Section | Route | Body |
| --- | --- | --- |
| Connections | `/settings/channels` (index) | channel list + add channel, from `InboxSettings` |
| Inbox AI | `/settings/channels/ai` | `AiCommunicationSettings` |
| Widget | `/settings/channels/widget` | redirect to `WEBSITE_WIDGET_PATH` (the widget hub keeps its own audience/section URLs) |
| Rules | `/settings/channels/rules` | `AutomationRulesManager` + `FoldersAndTagsManager` + `SavedRepliesManager` + routing dialogs, lifted out of `InboxSettings` |

Steps:

1. Add `components/shell/ChannelsTabs.tsx` in the shape of `components/shell/IntegrationsTabs.tsx`
   (`NavLink` strip, `end` on the index tab). Reuse it, do not invent a second tab primitive.
2. Split `pages/InboxSettings.tsx` into `pages/ChannelsHub.tsx` (intro, alerts,
   `OauthRedirectAlert`, `ChannelList`, `AddChannelDialog`, mailbox dialogs) and
   `pages/ChannelRules.tsx` (the three managers plus `RoutingRulesManager`). The `location.hash`
   scroll targets `#channels` / `#inbox-automations` (L462-469) disappear with the split; redirect
   `#inbox-automations` to the Rules tab.
3. Routes in `App.tsx`: the four paths above inside `SettingsLayout`, plus redirects from
   `/settings/communication` → `/settings/channels/ai` and from `/settings/inbox` (already a
   redirect at L462) to the index. Keep `/ai/assistant/*` as the widget's own routes.
4. `SettingsLayout.tsx`: the communication group collapses to one link (`settings.links.channels`,
   `/settings/channels`, `match: '/settings/channels'`). Widget and Inbox AI leave the sidebar;
   the hub tabs own that level. Update `SETTINGS_PALETTE_LINKS` (L60-84) so the palette still finds
   "Inbox AI" and "Chat widget" by their new paths.
5. `lib/page-crumbs.ts` and `lib/page-guides.ts`: crumbs for the three new leaves; the `channels`,
   `communication` and `widget` guide keys stay, but `communication` now resolves under the hub.

### One binding component

Keep `AgentBindingPicker` as the only writer and delete `ChannelBindingsPanel`.

- Extend the picker with an optional `priority` prop (default: 20 with an account id, 10 without)
  and make it PATCH an existing binding instead of delete-then-create, so a picker write no longer
  drops a contact-scoped row that happens to match.
- The tenant-wide table on the Inbox AI page becomes a read-only overview of `GET /channels/bindings`
  ("who answers what") with an edit affordance that scrolls to the matching channel row on the
  Connections tab. Contact-scoped bindings, which no picker can express, keep a row in that
  overview with a link to the contact.
- i18n: fold `channelsPage.bindings.*` into `bindingPicker.*`; drop the keys that only the deleted
  panel used.

### Tests

- New vitest: `ChannelsTabs` renders one active tab per route; `lib/page-crumbs.test.ts` gains the
  three leaves; a route test asserting `/settings/communication` and `/settings/inbox` resolve to
  the new paths (same pattern as the `/modules*` test from phase 1).
- Pytest: no new endpoints, so the existing `test_orchestration.py::test_triggers_crud_and_bindings`
  and `test_prod_hardening.py` binding cleanup cover the model. Add one case for the PATCH path if
  the picker starts using it.
- Product-help: `inbox/channels.md`, `inbox/communication.md`, `ai/widget-embed.md` and the
  `surface-map.yaml` rows for `/settings/channels`, `/settings/communication` (routes change), EN
  and NL, then `python apps/api/scripts/dev/sync_product_help.py`.

---

## P2.2 Agenda and automations as two routes

### Today

`/agenda` carries three views in one query param (`pages/AgendaPage.tsx` L46-51, L192-214,
L511-517): `week`, `list`, `automations`. The automations view is a different job — triggers,
workstreams and task runs (`components/agenda/AutomationsPanel.tsx` L317-689) — and the page even
skips the agenda fetch when it is active (L262-266). `/automations` already exists in `App.tsx`
L456, but only as a redirect *into* the query param.

### Target

- `App.tsx`: `/automations` renders a new `pages/AutomationsPage.tsx`; `/agenda?view=automations`
  redirects to `/automations` (reverse of today's redirect, preserving `project=` and `agent=`
  through `RedirectPreserveSearch`).
- `pages/AgendaPage.tsx` keeps `week` and `list`; `ViewTab` loses `automations`, `parseAgendaView`
  loses the branch, and the `Tabs` strip drops the third trigger. The dialogs
  (`TriggerDialog`, `CalendarEventDialog`, `CalendarEventDetailDialog`) are needed on both pages —
  move the trigger dialog wiring into `AutomationsPage` and keep the calendar dialogs on Agenda.
- `lib/navigation.ts`: `AGENDA_AUTOMATIONS_PATH` becomes `'/automations'`; add `automations` to
  `TAB_PATHS`/`tabFromPath` only if it gets its own rail item. Default: it does **not** — it stays
  under the Agenda rail tab (`tabFromPath` maps `/automations` → `'agenda'`), because the rail must
  not grow a tab per layer.
- Call sites already use the constant (`AutomationRulesManager.tsx` L182, `AiAgentDetail.tsx`
  L615-617, `ProjectDetail.tsx` L328 with `&project=`, `CockpitPage.tsx` L134 as a literal). Change
  the literal in Cockpit to the constant; `ProjectDetail` becomes `${AGENDA_AUTOMATIONS_PATH}?project=`.
- `lib/page-guides.ts` L56/L68 related links, `lib/page-crumbs.ts` (new `crumbs.automations`),
  `CommandPalette.tsx` (add an "Open automations" action next to `action-open-agenda`).
- Screenshots and docs: `apps/api/scripts/dev/capture_product_help_screenshots.py` L42,
  `surface-map.yaml` L231, `ai/agenda.md` L45-52 in EN and NL — the automations use-case moves to
  its own article `ai/automations.md` with a map row, since it is now its own route.

### Tests

Vitest for `tabFromPath('/automations') === 'agenda'`, the crumbs entry, and a route test for the
`?view=automations` → `/automations` redirect.

---

## P2.3 One meaning per run surface

### Today

Four surfaces list overlapping things under six names:

| Surface | Data | Called |
| --- | --- | --- |
| `/activity` (`ActivityTerminalPage.tsx`) | `GET /cockpit/activity` | "Activity", rows are "events" (`activityPage.eventTypes.runStarted` = "Run started") |
| `/communication/runs/*` (`Communication.tsx`) | `GET /signals?folder=internal` | "Agent runs" (`runsChips.heading`), rows are threads |
| `/agents/:id` (`WorkLogsTable.tsx`) | `GET /work_logs` | "Run history", rows are work logs |
| `/automations` runs tab (`AutomationsPanel.tsx` L647-686) | `GET /orchestration/tasks` | "Runs", rows are `AgentTask`s |

`WorkLogsTable` also links differently per call site: `AiAgentDetail.tsx` L815-820 prefers the
matching internal thread and falls back to `/agents/{id}/runs/{workLogId}`, while
`ProjectDetail.tsx` L624-638 falls back through `workLogDetailUrl` to `/activity`
(`lib/workforce-run-urls.ts` L6-14) whenever `agent_id` is missing.

### Target

Fix the labels, not the data model. One noun per surface, spelled the same in EN and NL:

- **Communication** owns the conversation: `/communication/runs/*` is where an agent's work
  *reads as a thread*. Keep "Agent runs".
- **`/activity`** is telemetry: rename the surface to "Activity log" (`support.activity.label`,
  `activityPage.*`) and keep event-type strings as events. Nothing there is clickable-as-a-run
  except the deep link into the owning thread.
- **Agent detail** is the work log: `workforce.agents.historyTitle` becomes "Work log",
  `workforce.runLog.title` becomes "Work log entry", and the columns stay.
- **`/automations`** lists task runs: keep "Runs" inside the automations context, where the
  surrounding page already says triggers and flows.

Then make the links single-valued:

- `lib/workforce-run-urls.ts`: `workLogDetailUrl` loses the `/activity` fallback. Without an
  `agent_id` a work log has no detail page, so the row is not a link — call sites pass
  `runTo` = `undefined` and `WorkLogsTable` renders plain text.
- `WorkLogsTable` gets one `runTo` implementation, `workLogRunsPath` (`lib/agenda-thread.ts`
  L105-113), used by both call sites; the per-page fallback argument disappears.
- `messageWorkLogUrl` (same file, L17-23) follows the same rule.

### Tests

Extend `lib/agenda-thread.test.ts` for the single `runTo`, and add a vitest that
`workLogDetailUrl` returns `null` without an agent id. Copy changes need no test; the i18n
completeness check (EN/NL parity) already guards them.

---

## P2.4 Two help doors instead of four

### Today

Four entry points over one corpus (`docs/product-help/`):

- `/docs` and `/docs/:section/:slug` — public, unauthenticated, `DocsChrome` header, SEO.
- `/learn` and `/learn/:slug` — in-app, same articles plus app back-links; the destination of every
  `PageGuideBanner` (`pageGuidePath()` in `lib/page-guides.ts`).
- `/settings/help` — `HelpHubPage.tsx`, a curated link list to setup, tour, `/docs`, `/docs/api`,
  email and the assistant. It has an i18n entry for Learn (`helpHub.items.learn`) that the
  `guides` array L32-53 never renders.
- `/settings/setup` — `SetupHubPage`, the onboarding checklist.

### Target

Keep **`/learn`** (in-app reading) and **`/docs`** (public reading). `/settings/help` stops being a
third catalogue:

- `HelpHubPage.tsx` shrinks to: continue setup (`/settings/setup`), restart the tour, open Learn
  (`/learn`), open public docs (`/docs`, `/docs/api`), and support contact. No section lists — the
  index lives on `/learn`.
- `/learn` becomes the single in-app index: `LearnIndex` already reads `getProductHelpIndex`, so it
  gains the section grouping that `HelpHubPage` renders today.
- `ShellTopbar.tsx` L243-245 and `CommandPalette.tsx` L294-298 point at `/learn` instead of
  `/settings/help`; the settings sidebar help group (`SettingsLayout.tsx` L52-56) keeps
  `/settings/help` as the settings-scoped door.
- Docs: `getting-started/tour.md` L53 describes the split; update EN and NL plus the `welcome`,
  `setup-guide` and `tour` rows in `surface-map.yaml`.

### Tests

Vitest for `pageGuidePath()` (unchanged) and a route test that `/settings/help` still resolves;
pytest `test_product_help.py` already asserts the documented routes exist, so update its route
list.

---

## Order and risk

1. **P2.2 agenda split** — smallest blast radius, one new route, constant already centralised.
2. **P2.4 help doors** — copy and links only.
3. **P2.3 run labels** — i18n plus two link helpers; watch for stale deep links in product-help.
4. **P2.1 channels hub** — largest: two page splits, one component deleted, redirects.

Risks: the channels hub touches the most-used settings page, so keep the section bodies intact and
change only routing and chrome in the first pass. Deleting `ChannelBindingsPanel` removes the only
UI that can edit priority and contact-scoped bindings — the read-only overview must ship in the
same change, otherwise those rows become invisible.
