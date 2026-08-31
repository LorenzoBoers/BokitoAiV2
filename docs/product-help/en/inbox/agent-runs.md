---
title: Follow agent activity
intro: Scheduled scans and finished results live under Activity — open approvals sit under Decisions.
description: Open Activity to review agent work without mixing it into customer Open. Pending approvals use the Decisions leaf.
keywords: activity, agent runs, scheduled, results, queue, inbox
sort: 15
related: communication,decisions,agenda,cockpit
---

# Follow agent activity

Activity is the live work log of your AI: one terminal-style feed of everything agents did and are doing, streamed as it happens. It stays out of Open so customer mail does not compete with background jobs. Open approvals live under [Decisions](/docs/ai/decisions).

## Open the Activity terminal

![Agent activity list](/api/docs/assets/agent-runs/runs-list.png)
*One live log for the whole AI workforce.*

1. In Communication, open **Activity**, pinned at the bottom of the sidebar next to Contacts. Customer mail stays under **All communication**.
2. Read the log like a terminal: each line shows the time, the agent, the step and its result — green for finished work, red for failures, blue for work in progress. New lines stream in live; **Jump to newest** keeps the view following the tail.
3. Filter with the agent chips at the top or the search field; **Load older** pages further back in history.
4. Click a line to open the run conversation behind it. For items waiting on a yes or no, open the purple **Decisions** sub-view under All communication — the same list Reports **Awaiting decision** uses. A paused agent will not finish a wake until you resume it on [Agents](/docs/ai/agents).

## Check one agent's work log

1. In the **Agents** section of the sidebar, expand an agent's folder.
2. Open its **Activity** sub-view. It opens the same terminal filtered to that agent — your chats with the agent stay in its folder, the work log stays in Activity, never mixed into one list.

## Open a run and decide

1. Select a run to read what the agent did and why it stopped.
2. If a decision card is waiting, use **Approve**, **Reject**, **Edit** or **Escalate** in the thread. See [Decisions](/docs/ai/decisions).
3. Return to **Decisions** if you need the next open approval.

## What to do next

Customer mail stays under [Communication](/docs/inbox/communication). Recurring wakes are planned on the [Agenda](/docs/ai/agenda).
