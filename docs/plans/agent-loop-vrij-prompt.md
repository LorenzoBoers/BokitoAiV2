# Plan-mode prompt: agents kiezen zelf hun tempo

Plan mode. Lever eerst je plan (bestanden, wat weg gaat, wat erbij komt, tests), wacht op akkoord, bouw daarna. Lees eerst `.cursor/rules/bokito-core-intent.mdc`: één object per idee, oude oppervlak in dezelfde wijziging weg, backend is de ruggengraat.

## Doel
Agents voelen nu als "invoer → antwoord". Ze moeten vrijer werken, zoals een goede collega: eerst kort zeggen wat ze gaan doen, dan één of meer acties, tussendoor iets melden als dat nut heeft, en eindigen met het resultaat. Het model kiest zelf per stap of het nadenkt, praat of een tool aanroept. Wij leggen alleen de grenzen vast: effort, maximum aantal rondes, harde eindeisen.

Simpel houden. Geen routermodel, geen extra modelcall vooraf, geen nieuw framework.

## Wat er al is (niet opnieuw bouwen)
- `apps/api/app/services/agent/loop.py` is al een echte agent-loop: per ronde streamt het model tekst en `tool_use` door elkaar (`turn.speech`), tools draaien, resultaten gaan terug, tot het model stopt of `max_loops` (standaard 15) op is. Tekst vóór een toolcall komt al in de bubble.
- `stop_gate.py`: harde eindeisen (inbound-uitkomst) en berichten van een bovenliggende agent. Werkt.
- Subagents en achtergrondruns (`services/subagents.py`, `ask_agent`, `handoff_to`) dekken "werk later afmaken en terugmelden". Daar verandert niets aan.

## Wat het stijf maakt
1. **Regex kiest het tempo vóór het model het bericht leest.** `reasoning_policy.py` (`turn_pace`, `turn_needs_reasoning`, `turn_is_action_request`, `turn_thinking_budget`) gokt met NL/EN-woordlijsten tussen `reply`, `reply_then_think` en `think`. `reply` zet denken uit. `reply_then_think` geeft ronde 1 geen denktijd (`ack_first` in `loop.py`, beide stream-loops, rond r.1973–1982 en r.2110–2122), waardoor het model "ik ga het doen" zegt zonder plan.
2. **Effort wordt afgeleid van een tokenbudget.** `llm.py::_thinking_effort(budget)` maakt van `thinking_budget` een effort. Bij budget 0 gaat er geen `thinking` en geen `effort` mee, dus het model valt terug op zijn standaard (Opus 5.5: `medium`, veel andere: `high`). "Snel" is dus niet snel.
3. **Denk-instellingen wisselen binnen een beurt** (ronde 1 budget 0, daarna vol; na een fout tool-resultaat naar 0 of 1024, r.~1903). Wisselende thinking-parameters kunnen de prompt-cache breken: trager en duurder per actie-beurt.
4. **Regex-lapmiddelen achteraf.** `_WORK_ANNOUNCE_RE`, `_STORY_ASK_RE`, `_looks_like_work_announce`, `_looks_like_unfinished_story` en de `ANNOUNCE_REMINDER` in de stop gate raden wat het model bedoelde en sturen het terug. Grotendeels nodig geworden door punt 1.

## Wat het moet worden

### 1. Eén knop: effort per agent
- Vervang `Agent.thinking_budget: int` door `Agent.effort: str` met waarden `low | medium | high` (optioneel `xhigh`/`max` alleen als het model het ondersteunt; anders clampen naar `high`). Standaard `medium`.
- Vervang `settings.chat_thinking_budget` door `settings.chat_default_effort = "medium"`.
- Alembic-migratie: bestaande `thinking_budget` → effort via de huidige mapping (`0` → standaard `medium`, `≤2048` → `low`, `≤8192` → `medium`, hoger → `high`). Daarna kolom weg. Pas `orchestration/profiles.py` en `managed_resources.py` aan (snapshot-sleutel `effort`, met fallback voor oude snapshots met `thinking_budget`).
- Dashboard: waar thinking budget nu instelbaar is, wordt het één keuze "Denkwerk: licht / normaal / grondig" (i18n via de bestaande locales en `glossary.yaml`; draai `check-copy.mjs`). Geen tokengetallen in de UI.
- Subagents draaien standaard op `low`, tenzij de agentdefinitie anders zegt.

### 2. Elke modelcall: adaptive thinking + vaste effort
- `AnthropicLLMProvider._create_kwargs`: voor modellen met adaptive thinking (`_uses_adaptive_thinking`) altijd `thinking={"type": "adaptive"}` en `output_config={"effort": <effort>}`. Het model slaat denken zelf over bij eenvoudige berichten en denkt tussen toolcalls door (interleaved, geen beta-header nodig).
- Oudere modellen zonder adaptive: houd `{"type": "enabled", "budget_tokens": ...}` met een vaste mapping uit effort (`low` 1024, `medium` 4096, `high` 12000); bij `low` mag thinking uit. Zet die mapping op één plek.
- Controleer in de docs (platform.claude.com/docs/en/build-with-claude/effort en …/extended-thinking) wat per model mag: op sommige modellen kan thinking niet uit, en `effort` is geen thinking-type. Geen 400's introduceren; de bestaande `_learn_adaptive_thinking`-fallback blijft.
- OpenAI-compatibele providers: effort → `reasoning_effort` waar het model dat kent (nu alleen Mistral `high`); anders niets meesturen.
- `max_tokens`: ruim genoeg voor effort (`_resolve_max_tokens` op effort baseren, niet op budget).
- **Thinking- en effortparameters blijven gelijk binnen één beurt**, alle rondes. Haal het verlagen na een fout tool-resultaat weg (r.~1903): adaptive thinking houdt korte herstelantwoorden zelf kort.

### 3. Regex-tempo eruit
- Verwijder `turn_pace`, `turn_needs_reasoning`, `turn_is_action_request`, `turn_is_lookup_request`, `turn_thinking_budget`, `PACE_*`, `ack_first` en `_resolve_thinking_budget`.
- Eén uitzondering blijft, als goedkope kortere weg: `turn_is_small_talk` (groet/bedankje zonder bijlage) → die beurt op `low`. Kong (`bokito-kong`) krijgt minimaal `high`. Zet dit in een kleine functie `turn_effort(agent_effort, user_text, has_attachments, model_slug) -> str`; `reasoning_policy.py` wordt daarmee een bestand van een paar regels (of hernoem naar `effort_policy.py`).
- Let op: `turn_effort` mag alleen per beurt verschillen, nooit per ronde. Wordt de effort per beurt anders dan de vorige beurt in dezelfde conversatie, check of het de cache breekt; zo ja, overweeg de per-bericht effort-beta (`mid-conversation-output-config-2026-07-01`) achter een vlag. Niet verplicht in deze ronde.

### 4. De werkwijze staat in de prompt, niet in regex
Voeg één kort blok toe aan de systeemprompt van chat-agents (bij de stijlregels in `style.py`, in het Engels zoals de rest van de prompts):

```
How you work a turn:
- If the answer is quick, just answer.
- If the work takes more than a few seconds, start with one short sentence
  saying what you are going to do, then call the tools in the same response.
- Call tools that do not depend on each other in parallel.
- Between steps, only write when there is something worth telling: a finding,
  a choice you made, a question. No "still working on it".
- After the last tool, end with the result, not with an announcement.
- Long work that does not need to happen now: hand it off (ask_agent,
  handoff_to or a background run) and say when they will hear back.
```

Pas `reply_mode.py` niet aan: de korte openingszin wordt gewoon de eerste bubble.

### 5. Stop gate: alleen harde eisen
- Houd: berichten van een bovenliggende agent, `completion_requirement`, `inbound_requirement`, `MAX_STOP_CONTINUATIONS`.
- Verwijder de regex-detectie (`_WORK_ANNOUNCE_RE`, `_STORY_ASK_RE` en de twee `_looks_like_*`). Vervang `announced_work` door één structureel signaal: de beurt eindigt zonder tool en de enige tekst is de openingszin van vóór de eerste toolronde (dus geen tekst na de laatste tool). Dan één keer de `ANNOUNCE_REMINDER`. Meet via de bestaande turn-logging hoe vaak die nog vuurt; is het bijna nooit, dan mag hij in een volgende ronde weg.
- `is_progress_filler` + `discard_open_speech` mogen blijven (alleen letterlijke fillers).
- De "Summarizing"-pass (tool-calls zonder eindtekst → een call zonder tools) blijft als vangnet.

### 6. Niet aanraken
Canvas-flow (`_canvas_turn_done`), failover (`_MAX_FAILOVER_STEPS`), `_post_progress`, subagents, `turn_persist.py`, `reply_mode.py`, voice (`agent_call_voice.py`) behalve als het `thinking_budget` gebruikt.

## Tests
- Vervang `tests/test_reasoning_policy.py` door tests voor `turn_effort`: groet → `low`; groet met bijlage → agent-effort; gewone vraag → agent-effort; Kong → minimaal `high`.
- `test_provider_failover.py` / een nieuwe test op `_create_kwargs`: Claude 5+ krijgt altijd `thinking.type == "adaptive"` en `output_config.effort`; ouder model krijgt `budget_tokens` uit de mapping.
- Loop-test met de `MockLLMProvider`: een actieverzoek levert in ronde 1 tekst **en** `tool_use`; de tekst staat als eerste bubble vóór het tool-resultaat; de eindtekst komt na de tool.
- Loop-test: `thinking`/`output_config` zijn in elke ronde van één beurt identiek (ook na een tool-fout).
- `test_stop_gate.py`: announce-reminder vuurt alleen bij het structurele signaal, maximaal één keer; inbound-requirement ongewijzigd.
- Migratietest: `thinking_budget` 0/1024/4096/16000 → `medium/low/medium/high`.
- Dashboard: vitest voor de nieuwe keuze; copy-check groen.

## Klaar als
- Geen code meer die het tempo uit woordlijsten raadt (alleen de groet-regex).
- Eén effort-veld per agent, zichtbaar als "Denkwerk", migratie gedraaid.
- Een vraag als "kan je de flow contentmaand op altijd beoordelen zetten" geeft live: eerst één zin, dan de toolcall, dan het resultaat, in één beurt.
- "hoi" antwoordt zonder merkbare denktijd.
- Alle tests groen; in de PR een korte vergelijking (drie voorbeeldbeurten: groet, vraag, actie) van latency en tokens vóór/na.

## Bronnen
- Anthropic, Building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- Effort: https://platform.claude.com/docs/en/build-with-claude/effort
- Adaptive/extended thinking: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
