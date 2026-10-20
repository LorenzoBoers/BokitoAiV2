# Multi-agent threads

ADR: conversations stay one `Signal`. Multi-party work uses participants and a
turn floor — not a separate “Room” noun.

## Participants

Table `signal_participants`: `kind` (`user` | `agent` | `contact` | `team`),
`ref_id`, `role` (`owner` | `member` | `watcher`). Owner stays singular for
For-you; participants track involvement.

Thread detail returns `participants[]` and `active_turn`. Owner changes call
`apply_owner` → `sync_owner_participant`.

## Chat runtime

`app.services.chat_runtime` is the shared entry for durable messages and agent
turns (`trust`: operator | widget | agent | system). Hub, widget, and A2A paths
should call this rather than inventing parallel stacks.

## Tools

| Tool | Purpose |
|------|---------|
| `invite_to_thread` | Add participant; optional `wake` for agents |
| `leave_thread` | Leave (not owner) |
| `post_thread_message` | Visible message when participant (never external send) |
| `request_participant_turn` | Give the floor (SENT / PASS / TIMEOUT) |
| `start_conversation` | `mode=chat` peer thread or `mode=task` → `delegate_to_agent` |

Composer `@agent` → ensure participant + `request_participant_turn`.

## Turn protocol

`Signal.active_turn_json` holds kind, ref_id, nonce, deadline, streak. Max
consecutive turns for one agent then forces a human Decision. Presence publishes
`active_turn` so the hub can show “Waiting on …”. Worker job
`run_participant_turn_job` runs the turn when Redis is available.

## Agent turns and bubbles (2026-10)

Turns are rows in `agent_turns` (`services/agent_turns.py`); the floor is a
read model written from them.

- Agents ask each other only with `ask_agent` and hand over with `handoff_to`.
  An `@agent` chip in an agent's text is a link and wakes nobody, also at the
  start of a reply.
- One turn is one bubble. `TurnRecorder` streams a single `segment_id` per
  turn; speech after a tool call joins it with a blank line, and
  `plan_turn_messages` in chat mode saves one message with the work above it.
- Every live event carries `author`. Clients name the live bubble from it,
  never from the floor, which already points at the next speaker.
- A turn that says only `pass` publishes no bubble: speech is held while it
  can still become the pass word, and `agent.turn` end carries
  `outcome: "silent"`.

## Module hire and ownership

`ModulePackage.agent_template` describes a managed specialist.
`install_module` auto-hires the specialist onto the roster (no setup chat).
`hire_module_agent` / `POST .../modules/{slug}/agents/hire` uses
`ensure_managed_agent(managed_origin="module")`, adds the roster default, and
optionally opens a setup conversation.

Module tools stay behind roster ACL (`filter_tools_for_agent_modules`); the
specialist passport lists module verbs + minimal messaging. Leads should
`recommend_module` / `invite_to_thread` rather than call `{slug}_*` tools.

Uninstall / disable: soft-archive managed specialists (`managed_origin=module`)
and clear the roster; partner connections stay on Connections. Re-hire restores
via Govern when the specialist was archived.

## Roles / passports

`ROLE_TOOL_TEMPLATES` in `workforce_runtime` seeds narrow `tools_json` on create.
Leads get routing guidance: invite / request turn / delegate instead of doing
module work themselves.

## Mapping from Grok Bot concepts

| Grok | Bokito |
|------|--------|
| ROOM | Conversation (`Signal`) with participants |
| Member turn | `request_participant_turn` |
| Plugins/skills | Passport + module roster + docs |
| Marketplace bot | Module hire managed agent |

## Client

`@bokito/chat-client` exposes typed helpers for thread detail (including
participants / active_turn) for hub and future widget/mobile reuse.
