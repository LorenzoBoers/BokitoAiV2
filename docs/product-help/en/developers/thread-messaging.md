---
title: Thread messaging protocol
intro: One conversation model for hub, agents, and peers — participants, ordered messages, and a turn queue in the database.
description: REST thread detail includes participants, message seq, and active_turn; tools invite, ask, hand over, and post.
keywords: participants, active turn, seq, agent turns, ask_agent, handoff_to, invite_to_thread, start_conversation, spawn_subagent, subagents, stop reason, chat client
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

- A human message queues one turn per agent it addresses, in the order named. A chip addresses an agent when it opens the message or a sentence (after a greeting such as "Hi"), closes the message, or is followed by a comma or colon. A chip inside a sentence ("ask @Bo about it") only names that agent: it starts no turn, and the agent that answers is told who was named. A plural word ("both", "all of you", "allebei", "jullie") with two or more chips addresses all of them.
- A message that addresses nobody goes to the agent holding the floor, then to the team: the server picks who answers. By default that is the agent that spoke last; a small model may pick another participant only when it is sure, and after two seconds the default stands. The stream endpoint takes no `agent_id`; the client sends the text with its `@[Name](agent:id)` chips.
- A message that names only colleagues posts as a chat message and starts no agent.
- A newer human message cancels turns still queued from an older one.
- An agent asks another agent only with `ask_agent`. An agent chip (`@[Name](agent:id)`) in an agent's text is a link and wakes nobody, also at the start of the reply. To give the conversation away, agents use `handoff_to`.
- A run of agent turns stops at a budget (turn count, the same two agents back and forth, tokens). The server then posts one line that hands the floor back to the people in the conversation.

Live events on the gateway: `message.start` (a bubble opens, still empty), `message.delta`, `message.part`, then the stored message with its `seq`. One agent turn is one bubble: speech before and after a tool call lands in the same bubble, and the work sits above it. Every live event carries `author` (`{kind, id, name}`), so a client names the bubble from the turn itself, not from whoever holds the floor next. An agent that has nothing to add sends no bubble. Clients show one bubble at a time: the next opens after the previous one finished revealing.

Saved messages carry `payload.mentions` (`[{kind, id, name}]`) with the current name of every mentioned agent, team or person, so a renamed agent shows its new name in old messages.

## Event log

Every operator event on `signal:{id}` belongs to one ordered log per conversation. The data of each event carries:

- `event_id` — grows with every event (`"<ms>-<n>"`, compare as a pair)
- `prev_id` — the event before it on the same conversation
- `type` — the normalized name: `turn.started`, `item.created`, `item.delta`, `item.updated`, `turn.completed`, `message.saved`, `floor.changed`
- `ts` — server time in seconds

Turn events also carry `stream_id` (the turn) and `surface` (the whole live turn as the server renders it), so one event is enough to draw a turn. Several turns can be open at once; each has its own `stream_id`. Every `turn.started` ends in exactly one `turn.completed` with `stop_reason`: `end_turn`, `passed` (the agent had nothing to add), `cancelled`, `superseded` (a newer human message) or `error` (the worker stopped; the server closes the turn after two minutes without events). A saved message names the live turn and bubble it replaces with `payload.turn_id` and `payload.segment_id`. A `floor` event carries `active_turn` whenever the floor changes. No thread message stands in for an open turn.

To join or rejoin, send a `sync` frame on the gateway after `sub`:

```json
{"type": "sync", "topic": "signal:<id>", "after": "<last event_id or null>"}
```

With `after`, the server replays every event after it, then sends `log.synced` with `head` and `complete`. `complete: false` means the log no longer reaches back that far: reload the thread detail. Without `after`, the server sends the last event of every open turn plus the floor, then `log.synced`. When an event's `prev_id` is not the last id you applied, send `sync` with that id. Ignore events at or before your cursor, and events for a turn that already completed.

## Agent tools

| Tool | Effect |
|------|--------|
| `ask_agent` | Ask another agent a question; the answer comes back as a new turn for the asker, with any images |
| `handoff_to` | Hand the conversation to another agent with a short brief |
| `invite_to_thread` | Add user/agent/team as a participant |
| `leave_thread` | Leave (not owner) |
| `post_thread_message` | Message when participant (never external customer send) |
| `start_conversation` | Open a peer thread with another agent (`agent_id`, `title`, `message`) |
| `spawn_subagent` | Run a side task as a subagent: `prompt`, `description`, optional `agent_id`, `persona`, `role`, `model`, `run_in_background`, `resume_from` |
| `get_subagent_output` | Status and result of a subagent run |
| `send_subagent_message` | Message a running subagent (`delivery`: `steer`, `queue` or `interject`) |
| `kill_subagent` | Stop a subagent run (stop reason `user_interrupt`) |

`signal_participants.unread_count` counts messages for human members who do not have the thread open.

## Subagents

A subagent is an `AgentRun` with `run_role=delegate` and `trigger_type=subagent`. It never posts in the thread; the thread gets one `system_event` row with `payload.kind=subagent`. `GET /api/signals/{signal_id}/subagents/{run_id}` returns the run status, stop reason, result and transcript.

- At most 32 subagents run at once per workspace. Over the limit, `limit_behavior=queue` queues the run and `fail` returns `QuotaExceeded`. Set both under tenant settings `subagents`.
- Depth is 1: a subagent cannot spawn another.
- At most 4 messages in flight per parent and subagent pair, and 32 outbound messages per attempt.
- A foreground run waits up to 120 seconds, then continues in the background. A finished background run wakes the parent with a `subagent_result` turn.

Every turn ends with a stop reason on its run: `end_turn`, `max_turns`, `no_progress`, `user_interrupt`, `permission_rejected` or `requirement_forced`.

## Stop

`POST /api/signals/conversations/{id}/cancel` stops the running turn and cancels every queued turn on that conversation.

## Module hire

`POST /api/connections/modules/{slug}/agents/hire` creates or reuses a managed specialist (`managed_origin=module`), seats it in the module department, and opens a setup conversation.

## Client package

`@bokito/chat-client` normalizes thread detail (participants + active_turn) for hub and other surfaces. Architecture notes live in `docs/architecture/multi-agent-threads.md` in the repo.
