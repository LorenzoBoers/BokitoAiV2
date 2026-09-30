---
title: Work in V2: agents, playbooks, triggers and runs
intro: Give an agent a passport, describe recurring work as steps, start it on a schedule and read the ledger.
description: Configure V2 agents with an autonomy cap, write playbooks as ordered steps, start them by hand, from a cron or webhook trigger, and read every run with its cost in the ledger.
keywords: v2, work, agents, passport, playbook, steps, trigger, cron, webhook, runs, ledger
sort: 40
related: v2-communication,v2-govern,v2-knowledge
---

# Work in V2

**Work** holds the four things that make agents productive: **Agents**, **Playbooks**, **Triggers** and **Runs**. Playbooks run in a thread under the same policy as a reply, so nothing here bypasses Govern.

## Create an agent

An agent is a passport: name, role, instructions, model and autonomy cap.

1. Open **Work**, **Agents** and press **New agent**.
2. Fill in **Name**, **Role** and **Instructions**. Instructions are the standing brief; keep procedures in Knowledge.
3. Leave **Model** empty to use the workspace default (EU managed model or your own key), or pick a connected model provider.
4. Set **Autonomy cap** or keep **Follow workspace posture**. The agent never acts above the cap.
5. Under **Tools** keep **All tools allowed by policy** or restrict the list. Save; mark one agent **Default** to own new internal threads.

## Write a playbook

A playbook is a list of steps an agent runs in order.

1. Open **Work**, **Playbooks** and press **New playbook**.
2. Give it a **Name** and a **Description**.
3. Add steps with **Add step**: a **Step title** and an **Instruction for the agent**.
4. Pick the **Agent** or leave **Default agent**.
5. Save. Saving records a change under **Govern**, **Changes** that you can roll back.

## Run a playbook now or on a schedule

1. Open a playbook and press **Run now**. If the banner **This run waits for approval.** appears, approve the decision in the internal thread that was created.
2. For recurring work open **Work**, **Triggers**, **New trigger**.
3. Pick **Kind**: **Schedule** with a **Cron expression** (five fields, UTC; `0 9 * * 1-5` is weekdays at 09:00), **Interval** with **Every (minutes)**, or **Webhook**.
4. Choose a **Playbook**, or give the default agent instructions instead.
5. For a webhook copy the URL and secret shown once: send `POST /api/hooks/{id}` with header `X-Bokito-Secret`.

## Read the ledger

Every reply, playbook, trigger and tool call is a run.

1. Open **Work**, **Runs**.
2. Filter on **Status** (**Queued**, **Running**, **Waiting**, **Done**, **Failed**, **Cancelled**) and read **Actor**, **Trust** and **Cost**.
3. Click a run for its **Events** and **Output**.
4. Runs started by the workbench (a coding agent working on a repository) appear here too, with a link to the pull request when it finishes.

## What to do next

- Load procedures and tone of voice: [/docs/v2/v2-knowledge](/docs/v2/v2-knowledge)
- Hand a run to a coding workbench or a business system: [/docs/v2/v2-connections](/docs/v2/v2-connections)
