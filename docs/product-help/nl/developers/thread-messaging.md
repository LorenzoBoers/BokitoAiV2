---
title: Thread-berichtprotocol
intro: Eén conversatiemodel voor hub, agents en peers — deelnemers, beurten en gedeelde eventvormen.
description: REST thread-detail bevat participants en active_turn; tools nodigen uit, verlaten, posten en vragen beurten aan.
keywords: deelnemers, active turn, invite_to_thread, request_participant_turn, start_conversation, chat client
sort: 45
related: mcp-endpoint,widget-embed,agents
---

# Thread-berichtprotocol

Elk gesprek is een `Signal`. Multi-party werk voegt deelnemers en optioneel een vloer toe — geen apart room-type.

## Thread-detail

`GET /api/signals/threads/{id}` bevat:

- `participants[]` — `kind`, `ref_id`, `role`, `name`, avatarvelden
- `active_turn` — wie de vloer heeft (`ref_id`, `name`, `nonce`, `deadline`, `prompt`)

Gateway-presence kan `active_turn` meenemen zodat de hub **Wacht op …** kan tonen.

## Agent-tools

| Tool | Effect |
|------|--------|
| `invite_to_thread` | Gebruiker/agent/team toevoegen; `wake=true` start een agentbeurt |
| `leave_thread` | Verlaten (niet de owner) |
| `post_thread_message` | Bericht als deelnemer (nooit externe klant-send) |
| `request_participant_turn` | Vloer aan een agent; uitkomsten sent / pass / timeout |
| `start_conversation` | `mode=chat` peer-thread, of `mode=task` achtergrondjob |

Composer-`@agent`-mentions nodigen uit en vragen een beurt.

## Module aannemen

`POST /api/integrations/modules/{slug}/agents/hire` maakt of hergebruikt een beheerde specialist (`managed_origin=module`), zet de roster en opent een setup-gesprek.

## Clientpakket

`@bokito/chat-client` normaliseert thread-detail (participants + active_turn) voor hub en andere surfaces. Zie ook de ADR multi-agent-threads in de repo.
