# ADR 001 — Cases, trust, and governed agents

Status: accepted
Date: 2026-09-04

## Context

Operators and customers talk to agents on the same `Signal` thread. Agents may
read, propose, and mutate — but only through the existing Govern stack. The
product needed typed intake, visitor confirmation, and a clear split between
routine case work and structural type/binding edits.

## Decisions

- **D1 Naming.** UI NL = Signaal. Code, API, and database = `Case` / `CaseType`
  / `CaseTypeBinding`. The conversation entity stays `Signal`.
- **D2 Nodes.** A case is typed intake. One thread has zero or more cases.
  Project and workstream are optional links, not parents.
- **D3 Modes.** Per type: `ask_customer` | `ask_operator` | `auto` |
  `manual_only`, plus certainty thresholds and optional `requires_verification`.
- **D4 Routing.** `CaseTypeBinding` follows the ChannelBinding pattern.
  Zero hits stay on the thread. One hit auto-links per flags and mode. N hits
  ask the operator. Project-scoped bindings beat tenant-scoped, then `priority`.
- **D5 Sinks.** v1 sinks are workstream and project only. Agents receive the
  binding map in prompt context. There is no per-agent type-config UI.
- **D6 Ask operator.** Short customer status line plus an internal
  `DecisionRequest` on the thread. The widget is not an operator approve UI.
- **D7 Verify.** Silent Contact or accounting-party match, then a 20-minute
  single-use magic link, then ~45 minutes of thread assurance. Copy is always
  neutral. No permanent Contact login. Customer verbs are opt-in.
- **D8 Exposure.** `ToolContext` plus `ModuleToolCard.exposure`. Sensitive
  reads are denied in `execute_tool` unless audience, toggle, and assurance match.
- **D9 Govern.** Operational case tools use category `cases`. Structural
  type and binding mutations use category `govern` and `PlatformChange`.
  No parallel agent RBAC. YOLO is not the v1 default.
- **D10 Theme.** In-app widget follows dashboard `data-theme`. Site widget
  follows `prefers-color-scheme` only.
- **D11 Hours.** Office hours are reachability, not offline chat. In hours:
  `handoff_to_human`. Out of hours: `request_callback`. Chat stays open.
- **D12 Docs.** EN and NL product-help, surface-map, and sync ship with the
  feature.

## Locked API choices

- Operator API prefix is `/api/cases` (never `/api/signals` for cases).
- Product-help slug is `ai/cases` (EN title Cases, NL title Signalen).
- Workstream `input_kind` adds `case`. Unused `signal` stays reserved.
- Certainty defaults: `ask_threshold=6`, `auto_threshold=9` (11 = auto off).
- Posture for `cases`: manual = ask, assisted = allow, autonomous = allow.

## Consequences

There is no `/cases` inbox and `Signal` is not renamed. Agents open one case
per intent. Type mode plus certainty plus verify remain the real gate;
the tenant `cases` slider can only deny agent intake entirely.
