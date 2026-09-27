---
title: How Playbooks work
intro: A playbook is a repeatable step-by-step process agents execute — with a full worklog per run.
description: Define playbooks with six ordered step kinds, one run per tracked signal, and a readable worklog.
keywords: workstreams, playbooks, steps, runs, worklog, decision, reply, schedule, templates
sort: 45
related: projects,agenda,agents,knowledge,cases
---

# How Playbooks work

A playbook is a defined process for work that comes back: collecting figures for a filing, closing the month, updating a report. Open **Playbooks** (Work group) to define the steps once and let agents execute them, run after run, with a worklog you can read back.

## Create a playbook

1. Open **Playbooks** and choose **New playbook**. Name the process and press Enter.
2. Optionally bind it to a project. A project-bound playbook may edit that project's documentation; agent edits to project docs only happen inside playbook runs.
3. Keep **Enabled** on. A disabled playbook keeps its definition and history but cannot start new runs.

## Define the steps

1. Open the playbook and choose **Add step**. A playbook needs at least one step; steps run in order.
2. Pick one of six kinds per step:
   - **Send message** — send a message in the tracked conversation. Fields such as `{amount}` use values from the run input.
   - **Agent task** — give an agent a goal. Pick a specific agent or let Bokito resolve the lead agent.
   - **Wait for reply** — park the run until the contact replies; optional reply branches route matching answers to another step.
   - **Ask decision** — show an inline decision in the conversation; each option may branch to another step.
   - **Call tool** — run a named Bokito tool with JSON arguments. Arguments support the same field templates.
   - **Schedule** — wait the configured number of hours, then continue.
3. Link knowledge sections to a step so the agent reads exactly the handbook material that step needs.
4. Reorder or remove steps at any time; running runs keep the step list they started with.

## Start and follow a run

1. **Start run** stays disabled until the playbook has at least one step and is **Enabled** (not paused). Add a step first, then choose **Start run**, type the input (the request, period, or context this run is about), and confirm. Auto-start comes from the signal type (**Start the playbook right away** under [Signals](/docs/ai/cases)) or from accepted intake on the About card — at most one run per tracked signal and playbook, even when multiple recognized signals on the conversation resolve to it.
2. The run detail shows the status (**Running**, **Waiting**, **Awaiting gate**, **Completed**, **Failed**, **Cancelled**), the input, and a step-by-step worklog: what each agent step did, when the run waited, and which decisions were taken.
3. A waiting run continues when you **Resume** it with the reply it waits for. A decision resolves inline in the tracked conversation; the selected branch determines the next step.
4. **Cancel** stops a run; the worklog stays.

## Handle a failed step

1. Bokito retries a failed or stalled step automatically. The workspace default is two retries.
2. After the retry limit, the tracked signal becomes **Waiting** and a decision card appears in the same conversation.
3. Choose **Retry**, **Skip step** or **Stop playbook**. Completed agent runs appear as agent-authored messages in that conversation, so the thread remains the worklog.

## Promote a run to knowledge

1. Open a completed run.
2. Choose **Promote to knowledge**. The agent distills the outcome into a knowledge section, so the next run starts smarter.

## Install a playbook from a module

Modules ship pre-built playbooks (for example VAT filing preparation on Accounting). Install one from the module page under **Playbook templates**; the copy is yours to edit. Before every run, Bokito re-checks that the module is installed, the connection works, and the agents exist — a run with a broken requirement pauses with a decision instead of failing silently.

## Draft a playbook from chat

1. Tell an agent which playbook to create or how to change its ordered steps.
2. The agent proposes `create_workstream` or `update_workstream` as a PlatformChange with the complete step list.
3. Review the draft in Govern. Applying it updates the same playbook shown on **Playbooks**; `/os` remains the map view.

## What to do next

Route recurring queue work through playbooks on [Projects](/docs/ai/projects). Accept chat intake on the About card — see [Signals](/docs/ai/cases). Schedule a playbook with a trigger on the [Agenda](/docs/ai/agenda). Templates come from [Integrations](/docs/integrations/integrations).
