---
title: How Workstreams works
intro: A workstream is a repeatable step-by-step process agents execute — with a full worklog per run.
description: Define workstreams with agent, wait, and gate steps, start runs with any input, follow the worklog, and promote results to knowledge.
keywords: workstreams, steps, runs, worklog, gate, wait, deadline, playbook, templates
sort: 45
related: projects,agenda,agents,knowledge,cases
---

# How Workstreams works

A workstream is a defined process for work that comes back: collecting figures for a filing, closing the month, updating a report. Open **Workstreams** (AI group) to define the steps once and let agents execute them, run after run, with a worklog you can read back.

## Create a workstream

1. Open **Workstreams** and choose **New workstream**. Name the process and press Enter.
2. Optionally bind it to a project. A project-bound workstream may edit that project's documentation; agent edits to project docs only happen inside workstream runs.
3. Keep **Enabled** on. A disabled workstream keeps its definition and history but cannot start new runs.

## Define the steps

1. Open the workstream and choose **Add step**. A workstream needs at least one step; steps run in order.
2. Pick a kind per step:
   - **Agent step** — write the goal the agent must reach. Pick a specific agent or a role; the role resolves to an active agent at run time.
   - **Wait step** — the run parks until input arrives, an event fires, or time passes. Set a deadline in hours and what happens when it lapses: continue, remind then continue, or fail.
   - **Gate step** — the run pauses for human approval. The decision lands in Messages.
3. Link knowledge sections to a step so the agent reads exactly the handbook material that step needs.
4. Reorder or remove steps at any time; running runs keep the step list they started with.

## Start and follow a run

1. Choose **Start run**, type the input (the request, period, or context this run is about), and confirm. Runs also start from a queue item on a project, from a trigger on the Agenda, from a module, or from a [case](/docs/ai/cases) bound to this workstream.
2. The run detail shows the status (**Running**, **Waiting**, **Awaiting gate**, **Completed**, **Failed**, **Cancelled**), the input, and a step-by-step worklog: what each agent step did, when the run waited, and which decisions were taken.
3. A waiting run continues when you **Resume** it with the input it waits for. A gate resolves from the decision card in Messages; approval also promotes doc sections the run wrote from **Review** to **Final**.
4. **Cancel** stops a run; the worklog stays.

## Promote a run to knowledge

1. Open a completed run.
2. Choose **Promote to knowledge**. The agent distills the outcome into a knowledge section, so the next run starts smarter.

## Install a workstream from a module

Modules ship pre-built workstreams (for example VAT filing preparation on Accounting). Install one from the module page under **Workstream templates**; the copy is yours to edit. Before every run, Bokito re-checks that the module is installed, the connection works, and the agents exist — a run with a broken requirement pauses with a decision instead of failing silently.

## What to do next

Route recurring queue work through workstreams on [Projects](/docs/ai/projects). Accept chat intake on the About card — see [Cases](/docs/ai/cases). Schedule a workstream with a trigger on the [Agenda](/docs/ai/agenda). Templates come from [Integrations](/docs/integrations/integrations).
