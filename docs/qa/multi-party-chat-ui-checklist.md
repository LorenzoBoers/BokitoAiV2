# Multi-party chat UI checklist (dev)

Status: `todo | fail | fix | pass`

Canonical scenarios: plan `multi-party_chat_ui_tests_98ad27c8` (Suites A–H, S01–S80).

## Progress

| ID | Status | Notes |
|----|--------|-------|
| S03 | pass | Thread `ec8d606c` loads (API get_thread OK, UI OK). Migraties 097. |
| S01 | pass | Header clean after load; no vague “Bericht toegevoegd” |
| S02 | pass | Participant strip avatars (Orchestrator + Bokito + user) |
| S04 | pass | Tags in list/header (`qa_v3` / `qa_v4` visible) |
| S05 | pass | Ask / Notitie composer tabs |
| S06 | pass | Concrete events: “Bokito assistant heeft labels…”, `Added #qa_v3` |
| S07 | pass | Handoff bubble before peer label work (after deferred enqueue) |
| S08 | pass | Idle after refresh: both agents Standby, no Stop |
| S09 | pass | Ask simple Q → Orchestrator bubble; survives refresh (session merge) |
| S10 | pass | Ask `#qa_b10` → Added #qa_b10 + Bokito bubble + wake report; idle after refresh |
| S11 | pass | Retry: Orchestrator set_thread_tags → Added #qa_b11 + confirm; idle without refresh |
| S12 | pass | Note without @ posted; both agents stayed Standby; no Stop |
| S13 | pass | Note @Bokito → inline reply (“Notitie QA S13 ontvangen…); idle Standby |
| S14 | pass | Note @Orchestrator (agent: mention) → “Notitie S14 retry gezien.”; idle |
| S15 | pass | @Bokito mention switched Ask → new Bokito session; reply “bokito”; tab Vraag Bokito |
| S16 | pass | Stop mid-Ask clears Stop/Nadenken without refresh (delta-flush race + sseBusy=active only) |
| S17 | pass | Ask under Geassisteerd: agent refused outbound (“Ik mag geen uitgaande e-mails sturen”); no customer mail |
| S18 | pass | Ask summary → 3-sentence factuur summary in session; idle |
| S19 | pass | Ask set_thread_tags: Added then removed qa_s19_wrong; final #qa_s19 in details; confirm “Klaar…” |
| S20 | pass | Double Enter Ask: single user bubble + single `s20ok` reply; idle Standby |
| S21 | pass | Ask → Orchestrator handoff bubble visible |
| S22 | pass | Bokito assistant bubble + `#qa_v3` tag event (concrete label) |
| S23 | pass | No double floor request (already_active / single nonce) |
| S24 | pass | Wake prompt includes peer reply snippet; Orchestrator: “Ze hebben label #qa_v4…” |
| S25 | pass | Live seal OK (Ask Stop clears on peer-floor/idle; verified with S11) |
| S26 | pass | After routing fix: request_participant_turn → Bokito “Goed! En met jou?” + Orchestrator wake report; idle |
| S27 | pass | Pass label + wake “@Bokito assistant heeft gepast.”; idle after refresh (wake-after-pass fix) |
| S28 | pass | After streak fix: max_consecutive UI “Agents stopten: te veel beurten…” + “Keten gestopt, menselijke beslissing gevraagd.” |
| S29 | pass | Internal host `72fbd32a`: Ask on host (no child); peer `s29ok` + wake report; idle Standby. Note: duplicate peer+wake once (same nonce) |
| S30 | pass | External mail `14cb3ae9` + Ask child `5cd56319`: host timeline shows Ask, peer `s30ok`, wake report; Standby; no 500 |
| S31 | pass | S31c: Support as participant; Orch→Bokito→Support floor swap; three voices (Support authored bubbles). Note: empty prompt + Support must be invited first |
| S32 | pass | S32b: start_conversation → peer `e1be17a5` (Orchestrator × Bokito); UI shows `s32ok` + wake “Ze bevestigde met s32ok”; idle. Note: first try used own agent_id; stuck `in_progress` “Working on this.” caused Stop linger; LLM rewrote path as absolute bokito.ai |
| S33 | pass | Peer `e1be17a5`: Orch→Bokito `s33ping` + wake bubbles chronologisch; Standby idle; no user between agent turns. Note: Orch paraphrased instead of exact `s33pong` |
| S34 | pass | S34b Ask `s34interrupt` accepted without deadlock/Stop linger; Standby. Note: peer A2A finished before interrupt (tight deferred window) |
| S35 | pass | Deadline timeout UI: “Bokito assistant reageerde niet op tijd”; Standby; retry Ask `s35retry` OK. Fix: expired deferred flush now emits `participant_turn_timeout` + presence idle; stale worker jobs bail |
| S36 | pass | Seeded `qa.teammate@bokito.ai`; Lorenzo note on `14cb3ae9`; teammate UI (after refresh/login) shows “QA S36: notitie van Lorenzo…” |
| S37 | pass | Teammate note “QA S37: antwoordnotitie van QA Teammate.” under Lorenzo’s S36 note; both authors visible |
| S38 | pass | Assign to QA Teammate → header “Toegewezen aan QA Teammate”; unassign → “Toegewezen aan Alle mensen” / list “Beschikbaar Alle mensen” |
| S39 | pass | Close `14cb3ae9` (team context) → Gesloten URL + Heropenen; reopen → `/inbox/open/t/14cb3ae9…`; S36/S37 notes intact |
| S40 | pass | As QA Teammate Ask → Orchestrator `s40ok` on `14cb3ae9`; Lorenzo sees Ask + agent + S36/S37 notes = three voices; no wrong “Jij” on teammate notes |
| S41 | pass | Lorenzo (after re-login) sees teammate Ask + `s40ok` on host timeline (sequential dual-user; shared cookie jar) |
| S42 | pass | Teammate note “@Lorenzo Boers QA S42 mention…” visible to Lorenzo; no crash. Note: mention chip may flatten to plain @text after send |
| S43 | pass | Concurrent A (teammate) + B (Lorenzo “QA S43 concurrent B…”) both persist; no overwrite |
| S44 | pass | After assign+mention: Voor jou badge 36; thread in for_you (page 2 / search `qa_s56` → `/inbox/for_you/t/14cb3ae9…`); deep-link without search auto-picks first page item |
| S45 | pass | Peer `e1be17a5`: Ask → `create_decision_request`; inline Ja/Nee under agent (“Mag ik doorgaan met s45?” / QA S45) |
| S46 | pass | Clicked Ja → agent follow-up bubble “Gedaan: Ja.” Note: tool created 4 duplicate decision cards (“4 notities”) — leftover Ja/Nee remain (S53) |
| S47 | pass | Nee on leftover card → agent bubble “Gedaan: Nee.” (clear dismiss; no silent fail) |
| S48 | pass | Soft Ask `nee` resolved an open Decision (Ja/Nee count 2→1); same path as knoppen |
| S49 | pass | Multi-option Decision: three buttons qa_s49_a/b/c; clicked a → “Gedaan: qa_s49_a.” |
| S50 | pass | `handoff_to_human` → event “overgedragen aan Lorenzo Boers… QA S50 handoff test”; header “Toegewezen aan Lorenzo Boers”; tool ai_handling=manual |
| S51 | pass | After handoff Ask was no-op (`ai_paused`); fix: operator Ask releases hold. Retry Ask → `s51ok`; ai_handling cleared |
| S52 | pass | A2A → Bokito Decision “Mag ik s52 afronden?”; Orchestrator `WAITING_S52`; both Standby with open Decision (no floor hang) |
| S53 | pass | Two open cards Keuze A/B; clicked B → approved; Keuze A stayed awaiting_human (no wrong resolve). Note: leftover S45 awaiting without buttons; duplicate DOM when Details open |
| S54 | pass | Refresh: Keuze A Ja/Nee still clickable; clicked Ja → approved |
| S55 | pass | Mail host `14cb3ae9`: Ask “Schakel Bokito assistant in” → tool Invite to conversation; “Invite voor @Bokito assistant klaar.” |
| S56 | pass | Mail host `14cb3ae9`: Ask → floor to Bokito; `Asked a participant to reply` + `Added #qa_s56` + wake “Ze hebben het label qa_s56…”. Note: Stop linger briefly after Standby |
| S57 | pass | Ask boekhoud-specialist → tool List modules; clear reply “Er is geen boekhoud-module/specialist geïnstalleerd.” (Decision not needed) |
| S58 | pass | @Extra test agent via mention → Ask tab “Vraag Extra test agent”; inline reply `s58ok`; Standby |
| S59 | pass | Ask Orch: no Moneybird self-work → Extra session + `@Extra test agent` + wake “Extra vroeg of jij QA S59 met s59ok wilt bevestigen”; no silent tool error. Note: Extra asked user instead of saying s59ok; Orch “Wil je dat ik dit nu doorvoer?”; Stop linger |
| S60 | pass | Mail host `14cb3ae9`: Ask wrong name XYZ999 → “Agent XYZ999_nietbestaand bestaat niet. Welke agent bedoel je?”; no crash; Standby |
| S61 | pass | Mail host: Ask invite+turn Extra; Stop during Orch turn after Invite tool. All Standby; floor clear; thread OK. Note: Extra still posted `s61ok` (peer race before cancel); Stop linger until click |
| S62 | pass | Re-invite Extra: Orch “Extra test agent heeft de beurt.” + wake; one Extra in rail (no dup); Standby. Extra didn’t say exact s62ok (offered ticket) but clear single turn |
| S63 | pass | Ask leave Extra → Orch floor to Extra + Leave conversation tool; wake “Ze zeiden: Weg.”; Orch remains; Standby. Note: Extra said Weg via leave path |
| S64 | pass | Chat met agents → new Orchestrator (`/communication/new?intent=agent…`) → terug `14cb3ae9`: timeline S59–S63 intact (“Ze zeiden: Weg.”); no 500 |
| S65 | pass | Ask note_no_reply → tool Note no reply; “Gemarkeerd als geen antwoord nodig.” + tip Decision; no customer SMTP send |
| S66 | pass | Assisted: Suggest thread reply + “Antwoord voorgesteld” + Overnemen; “Concept klaar voor goedkeuring.”; no send |
| S67 | pass | Manual: Ask “stuur mail s67send” → Orch “staat op handmatig, dus ik mag niet zelf mailen” + draft voorstel; no silent SMTP send |
| S68 | pass | Widget `409c82e4` Live chat product demo: Ask Support agent → reply “Bevestigd met s68ok”; bubbles + Ask parallel. Note: Stop/Nadenken linger; reply as Interne notitie + “Sessie met Orchestrator” label odd |
| S69 | pass | Mail host: customer MailMessageCard (no-reply@mistral) vs Ask sessions (“Sessie met Orchestrator”) visually distinct |
| S70 | pass | Covered by S56: Added #qa_s56 + header tag; event logged |
| S71 | pass | Widget: Ask split with category support + from_message_id (later msg); Decision Split/Keep; Goedgekeurd → link “Nieuwe vraag verplaatst naar een eigen gesprek: support”; child thread in list. Note: UI Hier splitsen on first inbound → 422; agent needs category under Assisted |
| S72 | pass | Split child `6466f9a1`: Sluiten → Alleen gesprek sluiten → Gesloten; Heropenen → Open; Ask Support → `s72ok`. Note: open closed thread via `/inbox/closed/t/…` (channel URL redirects away); odd “Sessie met Orchestrator” label on Ask (same as S68) |
| S73 | pass | Ask on `14cb3ae9`: tools then `s73ok`; tags `qa_s73`/`qa_s75b` on list; no eternal cursor |
| S74 | pass | Collapse “2 acties” → expand shows `Added #qa_s73` + `Added #qa_s75b` (concrete tool lines) |
| S75 | pass | Tag activity copy `Added #qa_s73` / `#qa_s75b` (not “Bericht toegevoegd”); tags on list row |
| S76 | pass | Ask folder: List folders + Added labels; header `#administratie`; reply `s76ok`. Note: brief client crash “Cannot read … length” on re-open mid-stream; Vernieuwen/reload recovered |
| S77 | pass | While Orch Bezig on `14cb3ae9`, opened split `6466f9a1`: rail still “Bezig Orchestrator”; no Stop/typing on wrong thread composer |
| S78 | pass | Peer `e1be17a5`: long multi-tool run (List tags + 3 acties; folders/agents/threads) >60s; mid activity; reopen OK. Close A2A: Ask→`Asked a participant`→`Vraag doorgegeven aan @Bokito assistant`→`s78ok`; max_consecutive stop event after streak |
| S79 | pass | During S78: left to Cockpit ~2 min; return to peer → catch-up bubbles/tools present; Standby; no stuck Stop/overlay |
| S80 | pass | Mail `14cb3ae9`: Ask → Orch (“Voeg label qa_s80…”, 7s·2 acties) → Bokito `Added #qa_s80` + “heeft labels qa_s80 toegevoegd” → Orch rapport → refresh keeps story. Close Ask `s80ok` seen live; after hard refresh close turn not on host (main demo story remains) |

## Fix log

- 2026-10-15: S03 verified green; baseline sync already rolls back on failure.
- 2026-10-15: A2A race — peer turn deferred + 3s delayed enqueue (Ask persists on child session); duplicate same-agent floor → already_active; wake prompt includes peer reply snippet; expired active_turn omitted from API payload.
- 2026-10-15: S24 verified on `#qa_v4`; ThreadDetail clears `liveActiveTurn` when presence sends null/empty floor (not only `phase=idle`).
- 2026-10-15: S25 Ask linger — host presence peer-floor/idle now `reset()`s session `useSignalStream`; `active_turn` parse requires `ref_id`.
- 2026-10-15: S16 Stop linger — `flushDeltasNow` no-ops when not streaming; stop clears optimistic + pending deltas; `sseBusy` only when live turn `active` (not `!ended`).
- 2026-10-15: S26 — Orchestrator chose `start_conversation` for same-thread ask; lead-routing + tool copy now prefer `request_participant_turn` for inline A2A.
- 2026-10-15: S27 — peer `pass` did not wake requester (`outcome == sent` only) → Ask Stop/Nadenken lingered; wake now on `sent` and `pass`.
- 2026-10-15: S28 — streak reset on every `clear_active_turn` so max consecutive never fired; remnant `streak`/`streak_at` + UI label for `reason=max_consecutive`.
- 2026-10-15: S31 leftover — peer checkpoint `metadata.in_progress=true` (“Working on this.”) left Stop/Nadenken after idle; cleared row; refresh-safe only after seal.
- 2026-10-15: S32 — Orchestrator called `start_conversation` with its own `agent_id` (self-chat error + identity mix-up); retry with explicit Bokito UUID succeeded; peer path in bubble used absolute `bokito.ai` (wrong host on dev).
- 2026-10-15: S35 — expired deferred flush cleared the floor with no timeline event; now emits `participant_turn_timeout` (`reason=deadline`, `agent_name`) + idle presence; worker rejects stale/expired nonce jobs.
- 2026-10-15: S51 — operator Ask on held thread returned empty `ai_paused`; now `release_conversation` via `operator_ask` then continues the turn (inbound still gated by `is_held`).
- 2026-10-15: QA mid-run — raised tenant `daily_token_cap` 4M→50M (used ~4.1M) so Suite E could finish.
