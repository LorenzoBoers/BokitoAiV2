---
title: Thread-berichtprotocol
intro: Eén conversatiemodel voor hub, agents en peers — deelnemers, geordende berichten en een beurtenwachtrij in de database.
description: REST thread-detail bevat participants, bericht-seq en active_turn; tools nodigen uit, vragen, dragen over en posten.
keywords: deelnemers, active turn, seq, agent turns, ask_agent, handoff_to, invite_to_thread, start_conversation, chat client
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

- Een bericht van een mens zet één beurt klaar per genoemde agent, in de genoemde volgorde. Een bericht zonder naam gaat naar de agent die het gesprek vasthoudt.
- Een nieuwer bericht van een mens annuleert beurten die nog wachten op een ouder bericht.
- Een agentbericht start zelf geen andere agents. Agents gebruiken `ask_agent` of `handoff_to`.
- Een reeks agentbeurten stopt bij een budget (aantal beurten, dezelfde twee agents heen en weer, tokens). De server plaatst dan één regel die de beurt teruggeeft aan de mensen in het gesprek.

Live events op de gateway: `message.start`, `message.delta`, `message.part`, daarna het opgeslagen bericht met zijn `seq`.

## Agent-tools

| Tool | Effect |
|------|--------|
| `ask_agent` | Stel een andere agent een vraag; het antwoord komt terug als nieuwe beurt voor de vrager, met eventuele afbeeldingen |
| `handoff_to` | Draag het gesprek met een korte brief over aan een andere agent |
| `invite_to_thread` | Gebruiker/agent/team als deelnemer toevoegen |
| `leave_thread` | Verlaten (niet de owner) |
| `post_thread_message` | Bericht als deelnemer (nooit externe klant-send) |
| `start_conversation` | `mode=chat` peer-thread, of `mode=task` achtergrondjob |

`signal_participants.unread_count` telt berichten voor mens-leden die het gesprek niet open hebben.

## Stoppen

`POST /api/signals/conversations/{id}/cancel` stopt de lopende beurt en annuleert alle wachtende beurten op dat gesprek.

## Module aannemen

`POST /api/connections/modules/{slug}/agents/hire` maakt of hergebruikt een beheerde specialist (`managed_origin=module`), zet de roster en opent een setup-gesprek.

## Clientpakket

`@bokito/chat-client` normaliseert thread-detail (participants + active_turn) voor hub en andere surfaces. Zie ook de ADR multi-agent-threads in de repo.
