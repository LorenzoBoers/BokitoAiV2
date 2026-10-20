# grok-build in Bokito: what was adopted and what changed

Source: [xai-org/grok-build](https://github.com/xai-org/grok-build) at commit
`2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, Copyright 2023-2026 SpaceXAI,
Apache License 2.0 (see [`LICENSE`](LICENSE)).

Bokito copies no grok-build source files. It re-implements five parts in
Python: their schemas, contracts, limits and default values are taken over as
they are. This file lists every place where Bokito deviates, as required by
section 4(b) of the license.

## 1. Tool permissions

Bokito modules: `apps/api/app/tools/permission_rules.py`, `apps/api/app/tools/policy.py`.

Adopted:

- Rule shape `{action, tool, pattern, pattern_mode}` with actions
  `allow | deny | ask`; a rule without an action denies (CWE-1188).
- Tool filters `any`, `mcp`, `web_fetch`, `agent_message`; glob patterns;
  `pattern_mode=domain` for URL hosts; `server:tool` patterns on `mcp`.
- Among matching rules deny wins, then ask, then allow.
- Ordered pipeline: PreToolUse hooks, then rules, then remembered grants,
  then read-only auto-approve, then the mode. Hook outcomes
  `allow | deny | ask | defer`; a hook `ask` cannot be approved away.

Changed:

- The filters `bash`, `edit`, `read` and `grep` are dropped (Bokito has no
  shell or file tools). The prefixes `tool:<name>` and `category:<name>` are
  added for Bokito's tool registry.
- `permissionMode` is replaced by Bokito's autonomy posture
  (`manual | assisted | autonomous`), the per-category sliders and the agent
  `autonomy_level`.
- Category sliders set to deny become rules. They apply only to gated tools,
  so an ungated read is never blocked by a slider; an explicit rule can still
  deny it.
- Hard agent rules map onto the pipeline: "Always ask" becomes an ask rule,
  "Autonomous" becomes a remembered grant.
- A consequential tool is a fixed ask that no allow rule or grant can widen.
- Tighten-only clamps run last and only on gated tools: member role,
  external trust, AI handling on `send_reply`, and `clamp:untrusted_input`
  from the prompt guard.
- Hooks are in-process Python callables, not external commands.

## 2. Agent definition

Bokito module: `apps/api/app/services/agent_definition.py`.

Adopted:

- `disallowed_tools`, `capability_mode`, `prompt_mode` (`extend | full`),
  `skills`, `completion_requirement` and `mcp_inheritance`
  (`all | none | named | except`), with their validation rules.
- Personas and roles for subagents: a persona's description defaults to the
  first paragraph of its instructions; model order is explicit, then role,
  then persona, then agent.

Changed:

- `capability_mode` has no `execute` value. `read-only` allows tools that do
  not mutate or are not gated; `read-write` allows everything except
  consequential tools; `all` allows everything the passport allows.
- `completion_requirement` names Bokito tools (`tool` or `any_of`) instead of
  shell checks.
- Personas and roles live in the tenant settings (Govern), not in files.

## 3. Compaction

Bokito module: `apps/api/app/services/compaction.py`.

Adopted:

- Auto-compaction at 85% of the model context window
  (`auto_compact_threshold_percent`, clamped 10-100).
- Tool-result pruning: `keep_last_n_turns=3`, `soft_trim_threshold=4000`,
  head and tail of 1500 characters, `hard_clear_age_turns=10`, and the
  placeholders `"[Tool result omitted — too old]"` and
  `"\n\n[…trimmed…]\n\n"`.

Changed:

- A pruning "turn" is one LLM round (one assistant message), because a Bokito
  turn can run several rounds.
- Each compaction is stored as a row in `signal_compactions` (summary,
  trigger, message counts, context window) so it is auditable.
- Bokito's earlier trigger of more than 40 messages stays next to the 85%
  token threshold; the last 12 messages are always kept verbatim.
- Durable facts from the summary are flushed to agent memory.

## 4. Subagents

Bokito module: `apps/api/app/services/subagents.py`. Tools `spawn_subagent`,
`get_subagent_output`, `kill_subagent`, `send_subagent_message` replace
`delegate_to_agent`.

Adopted:

- At most 32 concurrent subagents (0 clamps to 1), `limit_behavior`
  `queue | fail`, `QuotaExceeded` on fail, depth 1 (a subagent cannot spawn).
- Messaging limits: 4 messages in flight per pair, 32 outbound messages per
  attempt; deliveries `steer | queue | interject` with interject first.
- Foreground and background runs, `resume_from`, output and kill contracts,
  stop reasons on the run.

Changed:

- The outbound-per-attempt counter is kept in-process per turn.
- `spawn_subagent` also takes `agent_id` (another Bokito agent), `persona` and
  `role`.
- A subagent never speaks in the conversation. Its run shows as one row in
  the thread; its result goes back to the parent agent, which wakes on a
  background result.
- A foreground run waits at most 120 seconds, then continues in the
  background.
- Runs are `AgentRun` rows (`run_role="delegate"`, `trigger_type="subagent"`)
  executed by the ARQ worker, with an in-process fallback.

## 5. Stop rule per turn

Bokito module: `apps/api/app/services/agent/stop_gate.py`.

Adopted:

- At most 8 continuations, the `stop_hook_active` flag, and the stop reasons
  `end_turn | max_turns | no_progress | user_interrupt | permission_rejected`.

Changed:

- Added stop reason `requirement_forced`: the turn ran out of continuations
  while the completion requirement was still unmet.
- Inbound customer turns get a default requirement: the agent must call one
  of `suggest_thread_reply`, `note_no_reply`, `create_decision_request` or
  `send_reply`.
- The gate also delivers queued subagent messages and replaces Bokito's
  earlier one-time "you announced work but did not do it" nudge.
- A final text that only says the agent is working on it ("Working on this.",
  "Ik ben ermee bezig", "I'll ask ...") counts as an announcement; the
  reminder tells the agent to do the work or call `ask_agent` instead.

## 6. Session update stream

Bokito modules: `apps/api/app/services/thread_log.py`,
`apps/api/app/gateway/router.py` (`sync` frame),
`apps/dashboard/src/lib/thread-log.ts`, `apps/dashboard/src/hooks/useThreadLog.ts`.

Adopted:

- One ordered stream of updates per session, each with a server-issued,
  monotonic event id (`_meta.eventId` in grok-build, `event_id` here).
- Items are created once and then updated by the same id; a turn ends with
  exactly one completion event carrying a stop reason.
- A client that rejoins replays from its last event id.

Changed:

- The session is a conversation (`Signal`), not a coding session; one
  conversation can hold several agent turns at once, each with its own
  `stream_id`.
- Events keep Bokito's gateway names (`agent.turn`, `agent.activity`,
  `message.delta`, ...) for older clients; the grok-style name is in `type`
  (`turn.started`, `item.created`, `item.delta`, `item.updated`,
  `turn.completed`, `message.saved`, `floor.changed`).
- Every event also carries `prev_id`, so a client detects a gap without a
  timer, and every turn event carries the whole rendered turn (`surface`).
- Stop reasons on the stream are `end_turn | passed | cancelled | superseded
  | error`; `passed` and `superseded` are Bokito's (multi-agent floor).
- Storage is a Redis Stream per conversation (about 5000 events, 48 hours)
  plus a hash of open turns for a cold start. Replay runs over the WebSocket
  (`sync` frame, answered by `log.synced`), not over a separate session API.
- A turn whose worker died is closed by the server with `error` after two
  minutes without events.

## Not from grok-build

The prompt guard (`apps/api/app/services/prompt_guard.py`) and the
auto-reviewer (`apps/api/app/services/auto_review.py`) are Bokito's own work.
The auto-reviewer follows one rule from grok-build: a classifier may refuse,
but never silently approves an action that must ask.
