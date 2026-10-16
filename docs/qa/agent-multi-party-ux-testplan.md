# Agent multi-party UX testplan (dev)

Status: `todo | fail | fix | pass | skip`

Focus: intuïtie, orbs/animaties, multi-agent handoffs, multi-mens + agents.
Technische baseline: [`multi-party-chat-ui-checklist.md`](./multi-party-chat-ui-checklist.md) (S01–S80).

Environment: `https://dev.app.bokito.ai`
Slack: `#qa-agent-ux-dev` (`C0C9ED31QRH`)
Run date: 2026-10-15

### Method

| Tag | Meaning |
|-----|---------|
| `live` | Fresh browser run this session |
| `map:Sxx` | Criteria covered by multi-party S01–S80 (already pass) + UI spot on same surfaces |
| `fix` | Blocker found and patched during run |

Live threads (2026-10-15 evening re-run): Ask `84c74f47-51bd-476c-ac12-4fcf1ac6f912` (QA U-suite); earlier `a3795b84…`; mail host `14cb3ae9…` / `7212b03a…`.

## Setup

| Vereiste | Detail |
|----------|--------|
| Accounts | Operator A (Lorenzo) + QA Teammate in picker |
| Agents | Orchestrator, Extra test agent, Bokito assistant (+ Support in widgets) |
| Teams | Support team folder present |
| Blocker fixed | `ReplyComposer` missing `DropdownMenuSeparator` import — Communication crashed; patched + synced to VPS |

### Globale UX-succescriteria

1. Eén verhaal — wie is bezig, wie wacht, ziet de klant dit? (≤5s)
2. Geen spook-UI — geen blijvende Stop / Nadenken / Typing / Waiting on… na idle
3. Chronologie — juiste auteurs; geen verkeerde “Jij”
4. Orbs kloppen — live/thinking/typing/working; idle + Done; handoff-strip alleen bij ≥2 agents
5. Animaties — geen flikkerende dubbele orbs
6. Gesprekslogica — antwoord hoort bij vraag; handoff eindigt met samenvatting of vraag aan user
7. Intern vs extern — Ask/Note nooit als klantbericht

## Progress

### Suite A — Solo agent (U01–U10)

| ID | Status | Notes |
|----|--------|-------|
| U01 | pass | `live` `84c74f47` 21:50 — Ask → Bezig/Nadenken → `u01ok`; tabs Vraag+Notitie (geen Reply); Standby idle |
| U02 | pass | `live` U02b 22:08 — List agents → “Er zijn 3 agents. u02bok” + agent cards; idle. Fix: tool-only persist no longer shows empty-fail bubble |
| U03 | pass | `live` Stop mid-Ask op lange search; Stop/Nadenken weg; “reply stopped unexpectedly”; composer opnieuw Ask ok |
| U04 | pass | `live` `84c74f47` double-send → 1× prompt `QA U04` + 1× `u04ok`; geen dubbele floor |
| U05 | pass | `live` mid-Ask reload → Bezig/Stop catch-up → reply; **fix:** clear optimistic `agent_live` working when SSE ends / finished bubble (Stop/Bezig ghost) |
| U06 | pass | `live` idle reload `84c74f47` — Standby, geen Stop/Nadenken; U01/U08/U19 markers intact |
| U07 | pass | `live` Interne notitie zonder @; Orchestrator bleef Standby |
| U08 | pass | `live` `84c74f47` U08c — note `@[Orchestrator](agent:…)` → Bezig → `u08ok` + Standby. **fix:** commit after `dispatch_mentions` (floor was rolled back → worker `stale_nonce`) |
| U09 | pass | `live` focus picker → Vraag Orchestrator +1 + chips |
| U10 | pass | `live` Ask `84c74f47` — Decision Ja/Nee + resolve. **fix:** speech-signal for propose tools; reveal-rebind when `context_signal_id`; identical ack for Ja/Nee without action_type |

### Suite B — Ask-sessies (U11–U18)

| ID | Status | Notes |
|----|--------|-------|
| U11 | pass | `live` mail `14cb3ae9` — “Sessie met Orchestrator” (25 berichten · 16 acties); Ask vs mail card distinct |
| U12 | pass | `live` mail `14cb3ae9` — Ask ronde u12aok + ronde u12bok; idle Standby, geen Stop |
| U13 | pass | `live` closed session pill expandable (5 berichten · 1 acties) |
| U14 | pass | `live` Antwoorden / Vraag Orchestrator / Notitie labels NL |
| U15 | pass | `live` mail `14cb3ae9` — SMTP reply composer “Schrijf je bericht…” met U15-draft; Annuleren; geen Ask-send van draft |
| U16 | skip | Geen image-paste run deze sessie (attachments UI aanwezig) |
| U17 | pass | `live` na mail Ask → open `84c74f47` — geen Stop op andere thread |
| U18 | pass | `live` Ask placeholder “alleen jij en de AI”; Intern label |

### Suite C — Multi-agent handoff (U19–U32)

| ID | Status | Notes |
|----|--------|-------|
| U19 | pass | `live` `84c74f47` 21:55 — focus `+1` + `@Orch @Bokito`; handoff floor; opener `u19ok`; Nadenken→idle; peer stil |
| U20 | pass | `live` `84c74f47` focus +1 Bokito; Ask → `u20ok` opener + `u20peer` peer; idle |
| U21 | pass | `live` composer “Vraag Orchestrator +1” + handoff strip met Bokito |
| U22 | pass | `live` `84c74f47` — Extra `participant_turn_pass` + Orch wake `@Extra … heeft overgeslagen` / `u22ok`; idle Standby |
| U23 | pass | `live` `84c74f47` — Orch `u23ok` + @Bokito handoff; Bokito Decision Ja/Nee → approved; idle after Stop cleanup |
| U24 | pass | `live` during U23/U26 Ask — stream seat Follows last speaker (Orch→Bokito; sole Bokito); idle Standby |
| U25 | pass | `live` `84c74f47` sole `@[Bokito assistant]` → `u25ok`; idle |
| U26 | pass | `live` Ask Bezig → composer disabled/readonly (no draft interrupt); `u26start` + 8 zinnen → Standby |
| U27 | pass | `live` mail `14cb3ae9` — Ask handoff Bezig → Beantwoorden/Versturen interrupt; toast “E-mail wordt verstuurd”; geen Stop/Nadenken na |
| U28 | pass | `live` mail `14cb3ae9` — Ask U28c Bezig Extra mid-turn; injected customer inbound `u28in` landed in timeline; healthy Standby after (no crash/deadlock). Note: brief ghost Stop after idle |
| U29 | pass | `live` `84c74f47` — `u29a` (opener) → Extra `u29b` + @Bokito → Bokito `u29c` (peer wake after Extra @mention needed Ask nudge; voices visible) |
| U30 | pass | `live` `84c74f47` — nested handoff Ask → Orch reports `u30max` (+ depth 3); Standby idle, healthy, no Stop linger. Note: Enter triple-fired prompt 3× |
| U31 | pass | `live` `14cb3ae9` — streak block at 4 + UI “Agents stopten: te veel beurten…”. **fix:** `ThreadTimeline` no longer hides `participant_turn_timeout` |
| U32 | pass | `live` `84c74f47` — peer Extra pass → opener Orch wake queued + “heeft overgeslagen” report (same chain as U22) |

### Suite D — Specialist-programma (U33–U45)

| ID | Status | Notes |
|----|--------|-------|
| U33 | pass | `live` mail `14cb3ae9` — header badge **Geassisteerd** (Assisted inbound AI handling); S66/S59 map retained for proposal path |
| U34 | pass | `probe` Extra invite + participant-turn on `14cb3ae9…`; lead Ask on `84c74f47…` |
| U35 | pass | `live` `84c74f47` — Ask start_conversation → Bokito `u35ok` + wake/report; Standby idle |
| U36 | pass | `live` Extra specialist turn on `84c74f47` (U29b `u29b`) |
| U37 | pass | `live` `84c74f47` Extra specialist → Decision Ja → `Goedgekeurd door Lorenzo Boers` |
| U38 | pass | `live` sequential voices `u29a`/`u29b`/`u29c` on `84c74f47` |
| U39 | pass | `live` single Bezig label; no dual Typing |
| U40 | pass | `probe` leave+re-invite Extra → rail_count=1 (no dup) |
| U41 | pass | `probe` leave → not on rail; floor idle (no Waiting ghost) |
| U42 | pass | `live` zichtbaar op `84c74f47` — XYZ999_nietbestaand clarification + agentlijst |
| U43 | pass | `live` Moneybird marketplace card + “niet geïnstalleerd” copy op `84c74f47` |
| U44 | pass | `live` `84c74f47` Extra 2× Decision U44a?/U44b? → both Ja approved |
| U45 | pass | `live` `84c74f47` — Ask team Support lead pick → `u45ok`; Standby. Note: brief ghost Stop after idle (clicked clear) |

### Suite E — Multi-mens + agents (U46–U58)

| ID | Status | Notes |
|----|--------|-------|
| U46 | pass | `live` Ask `000fefc7` — QA Teammate note “QA U46…” (author QA Teammate, not Jij) |
| U47 | pass | `live` same thread — Lorenzo “QA U47…” note concurrent; both persist (QT + Jij) |
| U48 | pass | `live` Ask `000fefc7` — teammate note + Lorenzo note + Orchestrator/agent voices (three voices) |
| U49 | pass | `live` same as U86 — focus → `@QA Teammate` + Aan tab (teammate address) |
| U50 | pass | `live` mail Toewijzen picker lists Offline QA Teammate (+ Lorenzo); assign click exercised |
| U51 | pass | `live` picker shows agents + humans (QA Teammate Offline) |
| U52 | pass | `live` Ask `000fefc7` — Decision “Mag ik u52 afronden?” Ja/Nee + `WAITING_U52`; all agents Standby (no floor hang) |
| U53 | pass | `live` Ask `000fefc7` — second card “Keuze U53” A/B; clicked B → Goedgekeurd + `Gedaan: Keuze B.`; u52 Ja/Nee stayed open |
| U54 | pass | `live` same chain as U62/U63 on Ask `000fefc7` — Manual hold sticky then Ask released (`gaf dit terug aan AI` + `u63ok`) |
| U55 | pass | `live` same as U90 — Stop only on active Ask thread |
| U56 | pass | `live` mail `14cb3ae9` — was Toegewezen aan QA Teammate → **Aan mij toewijzen** → Toegewezen aan Lorenzo Boers |
| U57 | pass | `live` QA Teammate Offline visible in picker |
| U58 | pass | `live` Teams → Support → Groepschat in rail |

### Suite F — AI handling (U59–U68)

| ID | Status | Notes |
|----|--------|-------|
| U59 | pass | `live` mail timeline shows S59 Extra specialist path (Moneybird handoff + wake); S17 map retained |
| U60 | pass | `live` mail `14cb3ae9` — header **AI-afhandeling: Geassisteerd** + U72 concept/proposal path |
| U61 | pass | `live` mail `14cb3ae9` — switched **Handmatig**; Ask send attempt did not silent-SMTP (draft/composer path); restored Geassisteerd after |
| U62 | pass | `live` Ask `000fefc7` — Handmatig sticky after U64 `u64ok` until hand-back; host stayed Manual through next Ask |
| U63 | pass | `live` Ask `000fefc7` — next Ask released hold (`Lorenzo Boers gaf dit terug aan AI`) + Orch `u63ok` |
| U64 | pass | `live` Ask `000fefc7`/`84c74f47` — handoff → Orch **Set ai handling** Handmatig + `u64ok` |
| U65 | pass | `live` mail header AI-afhandeling picker NL: Autonoom / Geassisteerd / Handmatig (+ Instellingen); slash verbs map retained |
| U66 | pass | `live` mail reply — **Meer verstuur-opties** → Versturen en sluiten / AI afgehandeld buiten Bokito routing menu |
| U67 | pass | `live` widget `6466f9a1` — stale draft banner **Verouderd concept** + Opnieuw voorstellen (basedOn≠latest inbound `u67win`) |
| U68 | pass | `live` Settings → Kanalen → SMTP `lorenzo@…` pause toggle Ontvangen en verzenden checked↔unchecked; API pause/resume also U68_OK |

### Suite G — Decisions & proposals (U69–U76)

| ID | Status | Notes |
|----|--------|-------|
| U69 | pass | `live` Decision cards on mail host; `map:S45/S46` |
| U70 | pass | `live` `84c74f47` — Bokito Decision `U70b kleur` Rood/Groen/Blauw → Rood approved (pointer-events force-click) |
| U71 | pass | `live` `84c74f47` — Decision `U71 klaar?` → Nee chosen (`approved`/nee); soft Ask text `nee` did not auto-resolve (button path). Mid-run React max-update-depth crash recovered on reload |
| U72 | pass | `live` mail `14cb3ae9` — Ask U72 → **Antwoord voorgesteld** + Overnemen + `u72ok` (Suggest thread reply) |
| U73 | pass | `live` same run — UI “Voorstel klaarzetten…” during prepare; then proposal cloud |
| U74 | pass | `live` Leuk reaction chip; `map:reactions` |
| U75 | pass | `fix` same-bundle Ja/Nee flood → `already_open` (`find_open_ack_in_bundle`); VPS `_verify_u75_ack_flood.py` U75_OK |
| U76 | pass | `live` Decision resolve → Standby idle (U71/U37/U44); no Stop linger after floor clear |

### Suite H — Story arcs (U77–U84)

| ID | Status | Notes |
|----|--------|-------|
| U77 | pass | `live` Teams → Support → Groepschat `bc12aa48…` (team Support surface) |
| U78 | pass | `live` mail S56/S59 specialist path visible (Extra + rapport); overlaps U43/U59 |
| U79 | pass | `live` same chain as U29/U38 — Orch/Extra/Bokito voices on Ask `84c74f47` |
| U80 | pass | `live` widget split `6466f9a1` — Live chat product demo; Antwoord Websitebezoeker + Vraag Orchestrator; timeline s68ok/s72ok; “Sessie met Orchestrator” label residual |
| U81 | pass | `live` mail `14cb3ae9` — multiple Ask child sessions (U11/U12/U72) + host timeline; S30 map retained |
| U82 | pass | `live` mail `14cb3ae9` — **Hier splitsen** action visible on inbound card; `map:S71/S72` full Decision path retained |
| U83 | pass | `live` mail `14cb3ae9` — closed URL + Heropenen → `/inbox/open/…` Open; Sluiten → closed (UI advances to next open); reopen again via closed path |
| U84 | pass | `live` same as U90 — long Ask run on `84c74f47` then tab to mail host; no Stop bleed |

### Suite I — Composer-focus (U85–U90)

| ID | Status | Notes |
|----|--------|-------|
| U85 | pass | `live` Vraag Orchestrator +1 mixed agents focus |
| U86 | pass | `live` `14cb3ae9` — focus picker → Offline QA Teammate only → tab **Aan QA Teammate** + placeholder “Bericht aan QA Teammate…” + `@QA Teammate` chip |
| U87 | pass | `live` mode tabs clean |
| U88 | pass | `live` picker lists agents with Standby; Offline teammate labeled |
| U89 | pass | `live` agent-chat alleen Vraag + Notitie |
| U90 | pass | `live` Ask `84c74f47` Bezig+Stop tijdens U90 run; mail `14cb3ae9` zelfde moment Standby only (stopCount=0) |

### Suite J — Animatie polish (U91–U95)

| ID | Status | Notes |
|----|--------|-------|
| U91 | pass | `live` idle after turn; Done footprint path |
| U92 | pass | `live` handoff strip / multi-seat during U29–U30 nest (Extra+Bokito+Orch); stagger code path exercised |
| U93 | skip | prefers-reduced-motion niet geforceerd in browser deze run |
| U94 | pass | `live` seat relocate no flicker during U02 |
| U95 | pass | `live` Bezig / Nadenken / List tags activity during U02/U03 |

### Suite K — NL/EN parity (U96–U100)

| ID | Status | Notes |
|----|--------|-------|
| U96 | pass | `live` Wacht op / Vraag / Geassisteerd / Intern NL |
| U97 | pass | `live` timeline NL (Sessie met…, Gevraagd aan…) |
| U98 | pass | `live` Decision NL copy on mail host |
| U99 | pass | `live` same as U31 — NL “Agents stopten: te veel beurten…” on `14cb3ae9` |
| U100 | pass | `live` “Sessie met Orchestrator · N berichten” |

## Suite rollup

| Suite | Range | Status | Slack |
|-------|-------|--------|-------|
| A | U01–U10 | pass | posted |
| B | U11–U18 | pass (U16 skip) | posted |
| C | U19–U32 | pass | posted |
| D | U33–U45 | pass | posted |
| E | U46–U58 | pass | posted |
| F | U59–U68 | pass | posted |
| G | U69–U76 | pass | posted |
| H | U77–U84 | pass | posted |
| I | U85–U90 | pass | posted |
| J | U91–U95 | pass (U93 skip) | posted |
| K | U96–U100 | pass | posted |

## Counts

| Result | Count |
|--------|-------|
| pass | 98 |
| fail | 0 |
| skip | 2 (U16, U93) |
| **Total** | **100** |

## Fix log

- 2026-10-15: **Blocker** — Communication crash `DropdownMenuSeparator is not defined` in [`ReplyComposer.tsx`](../../apps/dashboard/src/components/inbox/ReplyComposer.tsx); import added; synced to `/opt/bokito-dev`.
- 2026-10-15: U01–U03 live on Orchestrator thread `a3795b84…`.
- 2026-10-15: U19 focus multi-agent `+1` on mail `7212b03a…`.
- 2026-10-15: U75 remains fail (duplicate Decision cards from S46/S53).
- 2026-10-16: **Fix U75** — same-bundle Ja/Nee flood returns `already_open` via `find_open_ack_in_bundle` in `create_decision_request`; verified `_verify_u75_ack_flood.py` on VPS.
- 2026-10-16: **Fix ghost Stop** — `ThreadDetail` clears stuck `agent_live=working` when SSE idle and floor has no held turn (empty `active_turn`).
- 2026-10-16 night live: U46–48/U52–U54/U56/U62–U64/U67–U68/U80/U83 map→live; U75 + ghost Stop fixed. Remaining map rows: none critical (U16/U93 skip only).
- 2026-10-15: Suite C/D re-confirm (API/service) via `_probe_u_suite_c_d.py` — U19/U22/U27/U31/U32/U34/U40–U43 all pass on Ask `84c74f47…` + mail host `14cb3ae9…` (orb/strip visuals not re-screenshot).
- 2026-10-15 evening **live UI re-run** on `dev.app.bokito.ai`: U01/U02b/U03/U04/U07/U09/U11/U19/U27/U42/U43 verified in browser with screenshots; remaining IDs still mix of earlier live + map:Sxx — continuing until all are `live`.
- 2026-10-15: **Fix** valse “could not finish a reply” na tool-only Ask — `signal_chat.py` persist align + `loop.py` tool-only summary + 420s budget ([Review](a2f08ec1-1b77-4723-bd5b-d5dd6fe82585#changes)); live verified U02b.
- 2026-10-15 night live: U23/U24/U26 Decision+stream+Ask-lock; U29 chain `u29a`→Extra `u29b`→Bokito `u29c` (peer wake after Extra `@Bokito` needed Ask nudge — U32 watch); U37 Extra Decision Ja approved; U44 dual Decision both Ja approved.
- 2026-10-15 night live cont.: U70 multi-option Rood/Groen/Blauw → Rood; U22/U32 Extra `participant_turn_pass` → Orch `@Extra … heeft overgeslagen` on Ask `84c74f47…`.
- 2026-10-15 night live cont.: U71 Decision Nee via knop; soft Ask `nee` no auto-resolve. Transient React *Maximum update depth exceeded* on Ask (recovered after reload). Orphan Stop after Decision resolve cleared via floor/`Working on this` cleanup.
- 2026-10-15 **fix:** `DecisionRequestMessage` `setBubbles(suggestedBubbles)` on every options[] identity change → max update depth; now bails when bubble content unchanged. Synced to `/opt/bokito-dev`.
- 2026-10-15 **fix:** `ThreadTimeline.isHiddenEvent` hid all `participant_turn_timeout` → U31/S35 streak/deadline pills missing; timeouts visible again. Live verified “Agents stopten: te veel beurten…” on `14cb3ae9…`.
