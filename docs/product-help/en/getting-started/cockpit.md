---
title: How Overview works
intro: Start here when you want to know whether work is flowing and where attention is needed.
description: Use Overview for the daily scan, then Activity for the event log and Usage for token budget caps and spend.
keywords: overview, reports, cockpit, dashboard, usage, budget, activity
sort: 50
related: communication,agent-runs,decisions,agenda
---

# How Overview works

Overview is the morning scan. Open it from the left rail to see what needs you, open signals, running work and weekly trajectory, then jump into the underlying conversation or run. Under **Settings → Profile** you can set Overview as your start page after sign-in; Communication remains the default.

## Scan the day on Overview

![Overview](/api/docs/assets/cockpit/overview.png)
*Overview shows open work, decisions and recent runs.*

1. Open **Overview** in the left rail. You land on the scan. The subtitle greets you and shows today's date. **Updated** next to **Refresh** is the last successful load.
2. Scan the four fixed blocks: **Needs you**, **Open signals by type**, **Running**, and **Trajectory**. Trajectory compares this week with last week and links to completed runs, Govern proposals, and Usage.
3. Click any row to open its conversation, run, or filtered list. Overview itself does not change operational data.

On a new workspace, Overview may still show setup progress. Finish those from the [setup guide](/docs/getting-started/setup-guide).

## Open work that is waiting on you

![Overview attention items](/api/docs/assets/cockpit/awaiting-decision.png)
*Awaiting decision jumps to the same list as Agent runs.*

1. Find the conversation under **Needs you**.
2. Open it. You land on the matching thread in Communication.
3. Handle the decision in the thread, then return to Overview.

## Read Activity

1. Stay on Overview and open **Recent events**, or open the **Activity** leaf from Communication when you need the full stream.
2. Scan outcomes, not every thinking step.
3. Jump into a thread or agent when a row needs follow-up.

## Check Usage

1. Open the **Usage** tab on Overview. The **Budget (platform keys)** card shows **Tokens today** and **Billable spend this month**, plus breakdowns **By model**, **By agent**, **By user** and **By data region**. The **EU-hosted share** stat shows which part of live tokens ran on EU-hosted models; change the policy under [Models](/docs/govern/models). Switch the period with **7 days**, **30 days** or **90 days**, or choose **Export CSV**.
2. Owners and admins choose **Edit caps**. Set a **Daily token cap** and a **Monthly spend cap (USD)**, or leave a field empty for **No cap**. Alerts fire at 80% and 100%.
3. When the budget is exhausted, AI calls on Bokito platform keys pause until you raise the cap or the period resets. Models on your own keys keep working (**Your own key (no charge)**). Empty ratings say **No customer ratings yet** with **Install website chat**.
