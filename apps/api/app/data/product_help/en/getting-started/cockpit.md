---
title: How Cockpit works
intro: Start here when you want to know whether work is flowing and where attention is needed.
description: Use Cockpit for the daily scan, then Activity for the event log and Usage for token budget caps and spend.
keywords: cockpit, dashboard, overview, usage, budget, activity
sort: 50
related: communication,agent-runs,decisions,agenda
---

# How Cockpit works

Cockpit is the morning scan. Open it to see open work, waiting decisions and what agents already did, then jump into the thread that needs you.

## Scan the day on Overview

![Cockpit Overview](/api/docs/assets/cockpit/overview.png)
*Overview shows open work, decisions and recent runs.*

1. Open **Cockpit**. You land on **Overview**. The subtitle greets you and shows today's date. **Updated** next to **Refresh** is the last successful load.
2. Read the built-in cards: **Conversations 7d**, **Awaiting decision**, **Handled without you**, **Agent freedom**, **Needs attention**, **Today on the agenda**, **Recent events** and **Recent contacts**. **Agent freedom** shows **You decide**, **Ask first** or **Act first**. Each number has a short hint. Empty time-saved, handled-without-you and AI-usage cards explain when numbers appear. If the hourly scan is off, Overview says **Hourly inbox scan is off**.
3. Click a card to open Communication, [Agent runs](/docs/inbox/agent-runs), [Agenda](/docs/ai/agenda) or [Contacts](/docs/inbox/contacts). On **Needs attention**, choose **Open first** to jump to the oldest waiting thread.

On a new workspace, Overview may still show setup progress. Finish those from the [setup guide](/docs/getting-started/setup-guide).

## Add a number you care about

1. On Overview, scroll to **Your numbers**.
2. Choose **Add a number**. The dialog is **New number**. Give it a **Name**, a **Unit** (Number, Count, Percent, Currency (EUR) or Duration (minutes)), and an optional **Target**.
3. Record values yourself, or let [agents](/docs/ai/agents) keep the number current. Platform-computed numbers snapshot daily; you cannot fill those by hand.

## Open work that is waiting on you

![Cockpit attention items](/api/docs/assets/cockpit/awaiting-decision.png)
*Awaiting decision jumps to the same list as Agent runs.*

1. Find **Awaiting decision** on Overview.
2. Open it. You land on the same list as [Agent runs](/docs/inbox/agent-runs).
3. Handle the decision in the thread, then return to Overview.

## Read Activity

1. Open the **Activity** tab. This is the workspace event log (what people and agents did), not the Agent runs queue.
2. Stay on **Headlines** to hide thinking and search noise, or switch to **Full log**. Filter with **Agents**, **People**, or **Filter events...**. Those filters stay in the URL. The list groups rows under **Today**, **Yesterday** and **Earlier**. Leave **Jump to newest** on to stay at the latest row.
3. Click a row that belongs to agent work to open the matching Agent runs thread.

## Set Usage and budget

1. Open **Usage**. Switch **7 days** / **30 days** / **90 days** for the breakdowns, or **Export CSV**. The **Budget (platform keys)** card shows **Tokens today** and **Billable spend this month**, plus breakdowns by model, agent and user. Empty ratings say **No customer ratings yet** with **Install website chat**.
2. Owners and admins choose **Edit caps**. Set a **Daily token cap** and a **Monthly spend cap (USD)**, or leave both empty (confirm) to remove the limits.
3. Alerts fire at 80% and 100%. When the budget is exhausted, AI calls on Bokito platform keys pause until you raise the cap or the period resets. Models on your own keys keep working and show no Bokito charge.

Autonomous runs group under Agents / system. Chats you start are attributed to you.

## What to do next

Customer mail lives in [Communication](/docs/inbox/communication). Recurring wakes live on the [Agenda](/docs/ai/agenda).
