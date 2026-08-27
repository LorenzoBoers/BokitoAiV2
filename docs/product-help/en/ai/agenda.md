---
title: How Agenda works
intro: Everything that should happen on a clock or an incoming event is planned here.
description: Schedule one-off, recurring, repeating, check-in and incoming webhook wakes, then pause or run them now.
keywords: agenda, scheduler, automations, cron, webhook, heartbeat
sort: 50
related: agents,projects,communication,agent-runs
---

# How Agenda works

Agenda is when agents wake up. This is not a meeting calendar. Open it to attach a wake, pause an automation, or see what fires next.

## See the week

![Agenda week view](/api/docs/assets/agenda/week.png)
*Week shows planned wakes on each day.*

1. Open **Agenda**. **Week** shows planned runs on each day.
2. Switch to **List** for the same schedule as a feed.
3. Today is highlighted so you can see what fires next.

## Attach a wake to an agent

1. Choose **New**. The dialog is **New schedule**. You can also open **Schedule** from [Agents](/docs/ai/agents). Later edits open **Edit schedule**.
2. Fill **Name**, pick a **Type**, a **Target** agent, **When**, and **Instructions for the agent** (except **Event**, which has no run). Choose **Save**. **Delete** removes the item.
3. Types:
   - **One-off task** — wakes once at the time you set, then completes.
   - **Event** — a reminder on the agenda. No agent run.
   - **Recurring schedule** — **Cron expression (UTC)** (for example weekday mornings).
   - **Repeating** — **Every (minutes)**.
   - **Check-in** — a heartbeat. The agent reports only when something needs attention.
   - **Incoming trigger** — an external system POSTs JSON to the **Hook URL**. After save, copy **Incoming secret (shown once)**. Send it as header `X-Bokito-Secret` or `?secret=`. Use **Test ping** and **Rotate secret** later. Incoming hooks are limited to 60 POSTs per minute.

Leave **Enabled** on. Disabled items stay on the agenda but never fire.

## Pause or run an automation

![Agenda automations](/api/docs/assets/agenda/automations.png)
*Pause, edit or run an automation now.*

1. Open **Automations**. An empty list offers **Create automation**. An empty week day offers **Schedule**. The type filter is kept in the URL as `kind`.
2. **Pause**, edit, or **Run now**.
3. Heartbeats check workspace docs on a timer. On-demand chat runs belong in Activity, not here.

If the linked agent is paused, the wake waits until you resume that agent.

## What to do next

Finished runs appear under [Agent runs](/docs/inbox/agent-runs). Longer work that spans days belongs in [Projects](/docs/ai/projects).
