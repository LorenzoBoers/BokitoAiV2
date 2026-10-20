---
title: Thread messaging protocol
intro: One conversation model for hub, agents, and peers — participants, ordered messages, and a turn queue in the database.
description: REST thread detail includes participants, message seq, and active_turn; tools invite, ask, hand over, and post.
keywords: participants, active turn, seq, agent turns, ask_agent, handoff_to, invite_to_thread, start_conversation, chat client
sort: 45
related: mcp-endpoint,widget-embed,agents
---

# Thread messaging protocol

Every conversation is a `Signal`. Multi-party work adds participants and a turn queue — not a separate room type.

## Thread detail

`GET /api/signals/threads/{id}` includes:

- `messages[]` — each message has `seq`, a per-conversation integer. Sort by `seq`; it is the order the server committed.
- `participants[]` — `kind`, `ref_id`, `role`, `name`, avatar fields
- `active_turn` — who is speaking or next (`kind`, `ref_id`, `name`, `nonce`, `turn_id`, `status` of `running` or `queued`, `claimed_at`)

`active_turn` is a read model of the turn queue. Gateway presence carries the same shape, so the hub can show who is writing without polling.

## Turns

Each agent turn is a row in a queue. The server claims one row per conversation at a time, so two agents never write at once.

- A human message queues one turn per agent it names, in the order named. A message that names nobody goes to the agent that holds the conversation.
- A newer human message cancels turns still queued from an older one.
- An agent message does not start other agents by itself. Agents use `ask_agent` or `handoff_to`.
- A run of agent turns stops at a budget (turn count, the same two agents back and forth, tokens). The server then posts one line that hands the floor back to the people in the conversation.

Live events on the gateway: `message.start`, `message.delta`, `message.part`, then the stored message with its `seq`.

## Agent tools

| Tool | Effect |
|------|--------|
| `ask_agent` | Ask another agent a question; the answer comes back as a new turn for the asker, with any images |
| `handoff_to` | Hand the conversation to another agent with a short brief |
| `invite_to_thread` | Add user/agent/team as a participant |
| `leave_thread` | Leave (not owner) |
| `post_thread_message` | Message when participant (never external customer send) |
| `start_conversation` | `mode=chat` peer thread, or `mode=task` background job |

`signal_participants.unread_count` counts messages for human members who do not have the thread open.

## Stop

`POST /api/signals/conversations/{id}/cancel` stops the running turn and cancels every queued turn on that conversation.

## Module hire

`POST /api/connections/modules/{slug}/agents/hire` creates or reuses a managed specialist (`managed_origin=module`), adds the roster, and opens a setup conversation.

## Client package

`@bokito/chat-client` normalizes thread detail (participants + active_turn) for hub and other surfaces. Architecture notes live in `docs/architecture/multi-agent-threads.md` in the repo.
