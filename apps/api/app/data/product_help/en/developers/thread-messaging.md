---
title: Thread messaging protocol
intro: One conversation model for hub, agents, and peers — participants, turns, and shared event shapes.
description: REST thread detail includes participants and active_turn; tools invite, leave, post, and request turns.
keywords: participants, active turn, invite_to_thread, request_participant_turn, start_conversation, chat client
sort: 45
related: mcp-endpoint,widget-embed,agents
---

# Thread messaging protocol

Every conversation is a `Signal`. Multi-party work adds participants and an optional turn floor — not a separate room type.

## Thread detail

`GET /api/signals/threads/{id}` includes:

- `participants[]` — `kind`, `ref_id`, `role`, `name`, avatar fields
- `active_turn` — who has the floor (`ref_id`, `name`, `nonce`, `deadline`, `prompt`)

Gateway presence may carry `active_turn` on composing events so the hub can show **Waiting on …**.

## Agent tools

| Tool | Effect |
|------|--------|
| `invite_to_thread` | Add user/agent/team; `wake=true` starts an agent turn |
| `leave_thread` | Leave (not owner) |
| `post_thread_message` | Message when participant (never external customer send) |
| `request_participant_turn` | Floor to an agent; outcomes sent / pass / timeout |
| `start_conversation` | `mode=chat` peer thread, or `mode=task` background job |

Composer `@agent` mentions invite and request a turn.

## Module hire

`POST /api/integrations/modules/{slug}/agents/hire` creates or reuses a managed specialist (`managed_origin=module`), adds the roster, and opens a setup conversation.

## Client package

`@bokito/chat-client` normalizes thread detail (participants + active_turn) for hub and other surfaces. Architecture notes live in `docs/architecture/multi-agent-threads.md` in the repo.
