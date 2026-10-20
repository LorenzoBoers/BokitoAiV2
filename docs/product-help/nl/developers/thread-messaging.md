---
title: Thread-berichtprotocol
intro: Eén conversatiemodel voor hub, agents en peers — deelnemers, geordende berichten en een beurtenwachtrij in de database.
description: REST thread-detail bevat participants, bericht-seq en active_turn; tools nodigen uit, vragen, dragen over en posten.
keywords: deelnemers, active turn, seq, agent turns, ask_agent, handoff_to, invite_to_thread, start_conversation, spawn_subagent, subagents, stopreden, chat client
sort: 45
related: mcp-endpoint,widget-embed,agents
---

# Thread-berichtprotocol

Elk gesprek is een `Signal`. Multi-party werk voegt deelnemers en een beurtenwachtrij toe — geen apart room-type.

## Thread-detail

`GET /api/signals/threads/{id}` bevat:

- `messages[]` — elk bericht heeft `seq`, een geheel getal per gesprek. Sorteer op `seq`; dat is de volgorde waarin de server opsloeg.
- `participants[]` — `kind`, `ref_id`, `role`, `name`, avatarvelden
- `active_turn` — wie spreekt of als volgende aan de beurt is (`kind`, `ref_id`, `name`, `nonce`, `turn_id`, `status` `running` of `queued`, `claimed_at`)

`active_turn` is een leesmodel van de wachtrij. Gateway-presence draagt dezelfde vorm, zodat de hub zonder pollen toont wie schrijft.

## Beurten

Elke agentbeurt is een rij in een wachtrij. De server pakt per gesprek één rij tegelijk, dus twee agents schrijven nooit tegelijk.

- Een bericht van een mens zet één beurt klaar per aangesproken agent, in de genoemde volgorde. Een chip spreekt een agent aan als hij het bericht of een zin opent (na een groet als "Hoi"), het bericht afsluit, of gevolgd wordt door een komma of dubbele punt. Een chip midden in een zin ("vraag @Bo even") noemt die agent alleen: er start geen beurt, en de agent die antwoordt hoort wie genoemd is. Een meervoudswoord ("allebei", "jullie", "both", "all of you") met twee of meer chips spreekt ze allemaal aan.
- Een bericht dat niemand aanspreekt gaat naar de agent die de beurt heeft, daarna naar het team: de server kiest wie antwoordt. Standaard is dat de agent die het laatst sprak; een klein model mag alleen een andere deelnemer kiezen als het zeker is, en na twee seconden blijft de standaard staan. De stream-endpoint neemt geen `agent_id`; de client stuurt de tekst met zijn `@[Naam](agent:id)`-chips.
- Een bericht dat alleen collega's noemt verschijnt als chatbericht en start geen agent.
- Een nieuwer bericht van een mens annuleert beurten die nog wachten op een ouder bericht.
- Een agent stelt een andere agent alleen een vraag met `ask_agent`. Een agentchip (`@[Naam](agent:id)`) in de tekst van een agent is een link en wekt niemand, ook aan het begin van het antwoord. Om het gesprek over te dragen gebruiken agents `handoff_to`.
- Een reeks agentbeurten stopt bij een budget (aantal beurten, dezelfde twee agents heen en weer, tokens). De server plaatst dan één regel die de beurt teruggeeft aan de mensen in het gesprek.

Live events op de gateway: `message.start` (een bubbel opent, nog leeg), `message.delta`, `message.part`, daarna het opgeslagen bericht met zijn `seq`. Eén beurt van een agent is één bubbel: tekst voor en na een toolaanroep komt in dezelfde bubbel, en het werk staat erboven. Elk live event draagt `author` (`{kind, id, name}`), zodat een client de bubbel naar de beurt zelf noemt en niet naar wie daarna aan de beurt is. Een agent die niets toe te voegen heeft stuurt geen bubbel. Clients tonen één bubbel tegelijk: de volgende opent als de vorige helemaal zichtbaar is.

Opgeslagen berichten dragen `payload.mentions` (`[{kind, id, name}]`) met de huidige naam van elke genoemde agent, elk team en elke persoon, zodat een hernoemde agent ook in oude berichten zijn nieuwe naam toont.

## Eventlog

Elk operator-event op `signal:{id}` hoort bij één geordende log per gesprek. De data van elk event draagt:

- `event_id` — groeit bij elk event (`"<ms>-<n>"`, vergelijk als paar)
- `prev_id` — het event ervoor in hetzelfde gesprek
- `type` — de genormaliseerde naam: `turn.started`, `item.created`, `item.delta`, `item.updated`, `turn.completed`, `message.saved`, `floor.changed`
- `ts` — servertijd in seconden

Beurt-events dragen ook `stream_id` (de beurt) en `surface` (de hele live beurt zoals de server hem tekent), dus één event is genoeg om een beurt te tekenen. Er kunnen meerdere beurten tegelijk open zijn; elk heeft een eigen `stream_id`. Elke `turn.started` eindigt in precies één `turn.completed` met `stop_reason`: `end_turn`, `passed` (de agent had niets toe te voegen), `cancelled`, `superseded` (een nieuwer bericht van een mens) of `error` (de worker stopte; de server sluit de beurt na twee minuten zonder events). Een opgeslagen bericht noemt de live beurt en bubbel die het vervangt met `payload.turn_id` en `payload.segment_id`. Een `floor`-event draagt `active_turn` zodra de beurt wisselt. Geen enkel threadbericht staat in voor een open beurt.

Om aan te sluiten of opnieuw aan te sluiten stuur je na `sub` een `sync`-frame op de gateway:

```json
{"type": "sync", "topic": "signal:<id>", "after": "<laatste event_id of null>"}
```

Met `after` speelt de server elk event daarna opnieuw af en stuurt daarna `log.synced` met `head` en `complete`. `complete: false` betekent dat de log niet meer zo ver teruggaat: laad het thread-detail opnieuw. Zonder `after` stuurt de server het laatste event van elke open beurt plus de beurthouder, daarna `log.synced`. Is de `prev_id` van een event niet het laatste id dat je verwerkte, stuur dan `sync` met dat id. Negeer events op of voor je cursor, en events van een beurt die al klaar is.

## Agent-tools

| Tool | Effect |
|------|--------|
| `ask_agent` | Stel een andere agent een vraag; het antwoord komt terug als nieuwe beurt voor de vrager, met eventuele afbeeldingen |
| `handoff_to` | Draag het gesprek met een korte brief over aan een andere agent |
| `invite_to_thread` | Gebruiker/agent/team als deelnemer toevoegen |
| `leave_thread` | Verlaten (niet de owner) |
| `post_thread_message` | Bericht als deelnemer (nooit externe klant-send) |
| `start_conversation` | Open een peer-thread met een andere agent (`agent_id`, `title`, `message`) |
| `spawn_subagent` | Voer een zijtaak uit als subagent: `prompt`, `description`, optioneel `agent_id`, `persona`, `role`, `model`, `run_in_background`, `resume_from` |
| `get_subagent_output` | Status en resultaat van een subagent-run |
| `send_subagent_message` | Bericht aan een lopende subagent (`delivery`: `steer`, `queue` of `interject`) |
| `kill_subagent` | Stop een subagent-run (stopreden `user_interrupt`) |

`signal_participants.unread_count` telt berichten voor mens-leden die het gesprek niet open hebben.

## Subagents

Een subagent is een `AgentRun` met `run_role=delegate` en `trigger_type=subagent`. Hij plaatst nooit iets in het gesprek; het gesprek krijgt één `system_event`-regel met `payload.kind=subagent`. `GET /api/signals/{signal_id}/subagents/{run_id}` geeft status, stopreden, resultaat en transcript van de run.

- Per werkruimte draaien maximaal 32 subagents tegelijk. Boven de limiet zet `limit_behavior=queue` de run in de wachtrij en geeft `fail` een `QuotaExceeded`. Beide staan in tenant-instelling `subagents`.
- Diepte is 1: een subagent kan geen nieuwe starten.
- Maximaal 4 berichten onderweg per paar ouder en subagent, en 32 uitgaande berichten per poging.
- Een voorgrond-run wacht maximaal 120 seconden en gaat daarna door op de achtergrond. Een klaar achtergrond-run wekt de ouder met een `subagent_result`-beurt.

Elke beurt eindigt met een stopreden op de run: `end_turn`, `max_turns`, `no_progress`, `user_interrupt`, `permission_rejected` of `requirement_forced`.

## Stoppen

`POST /api/signals/conversations/{id}/cancel` stopt de lopende beurt en annuleert alle wachtende beurten op dat gesprek.

## Module aannemen

`POST /api/connections/modules/{slug}/agents/hire` maakt of hergebruikt een beheerde specialist (`managed_origin=module`), zet de roster en opent een setup-gesprek.

## Clientpakket

`@bokito/chat-client` normaliseert thread-detail (participants + active_turn) voor hub en andere surfaces. Zie ook de ADR multi-agent-threads in de repo.
