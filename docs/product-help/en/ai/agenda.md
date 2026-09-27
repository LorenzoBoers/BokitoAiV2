---
title: How Agenda works
intro: Planned check-ins, one-off wakes, conversation look-ats, and calendar blocks share one timeline, with who looks shown on every item.
description: Review what is scheduled, plan agent wakes, and show connected calendar events alongside conversation look-ats.
keywords: agenda, schedule, check-in, wake, look-at, google calendar, outlook calendar
sort: 50
related: agents,projects,communication,agent-runs,integrations,workstreams
---

# How Agenda works

Agenda is what is scheduled. It combines upcoming moments with past occurrences and names the agent or person responsible.

## Review what is scheduled

![Agenda week view](/api/docs/assets/agenda/week.png)
*Week shows planned wakes, look-ats, and calendar events on each day.*

1. Open **Agenda**. **Timeline** shows the previous seven days and the next three weeks.
2. Each item shows its state and actor: **Agent** for a scheduled wake or **Person** for a human look-at or calendar event. Choose an item to open its run, conversation, calendar event, or schedule.
3. Filter with **All items**, **Wakes**, **Look-ats**, or **Calendar**. Choose **Week** when a day grid is more useful.

## Sync Google or Outlook Calendar

1. On Agenda, choose **Google Calendar** or **Outlook Calendar** in the connect strip, or open **Marketplace** and filter by **Calendar**.
2. Finish OAuth. Events sync into the week grid (mock demo events appear in local development).
3. Choose **Sync** to refresh. Choose **Calendar block** to create an event on a connected calendar. Click a calendar chip to open details — **Edit** to change title, times, location or description, or **Delete** to remove it.

Agents with calendar tools can list upcoming events (with stable ids) and propose new blocks or reschedules that wait for your approval in Communication.

## Attach a wake to an agent

1. Choose **Schedule**. The dialog is **New schedule**. You can also open **Schedule** from [Agents](/docs/ai/agents). Later edits open **Edit schedule**.
2. Fill **Name**, pick a **Type**, a **Target** agent, **When**, and **Instructions for the agent** (except **Event**, which has no run). Choose **Save**. **Delete** removes the item.
3. Types:
   - **One-off** — wakes once at the time you set, then completes.
   - **Event** — a reminder on the agenda. No agent run.
   - **Recurring schedule** — **Cron expression (UTC)** (for example weekday mornings).
   - **Repeating** — **Every (minutes)**.
   - **Check-in** — a heartbeat. The agent reports only when something needs attention, in its own channel in Communication.
   - **Incoming** — an external system POSTs JSON to the **Hook URL**. After save, copy **Incoming secret (shown once)**. Send it as header `X-Bokito-Secret` or `?secret=`. Use **Test ping** and **Rotate secret** later. Incoming hooks are limited to 60 POSTs per minute.

Leave **Enabled** on. Disabled items stay on the agenda but never fire.

Agents can plan work themselves: in any conversation, ask an agent to "check this again on Friday" or "remind the team to review the proposal".

1. The agent uses its schedule tools to create a wake (once, cron, or every N minutes) for itself or a colleague agent.
2. Depending on your [autonomy posture](/docs/govern/autonomy), the schedule is created directly or lands as a decision card in Communication for approval first.
3. Approved wakes appear on the Agenda timeline. Conversation look-ats (**What next** on a thread) also appear here as person items — open them to return to that conversation.

## What to do next

Finished runs appear under [Agent runs](/docs/inbox/agent-runs). Longer work that spans days belongs in [Projects](/docs/ai/projects). Connect more apps under [Integrations](/docs/integrations/integrations).
