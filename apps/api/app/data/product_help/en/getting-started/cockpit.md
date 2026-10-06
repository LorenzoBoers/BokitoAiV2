---
title: How Overview works
intro: Start here when you want to know whether work is flowing and where attention is needed.
description: Use Overview for the daily scan, Canvas for workspace dashboards, Activity for the event log and Usage for token budget caps and spend.
keywords: overview, reports, cockpit, dashboard, usage, budget, activity
sort: 50
related: communication,categories,agent-runs,decisions,agenda
---

# How Overview works

Overview is the morning scan. Open it from the left rail to see what needs you, open tickets, running work and weekly trajectory, then jump into the underlying conversation or run. Under **Settings → Profile** you can set Overview as your start page after sign-in; Communication remains the default.

## Scan the day on Overview

![Overview](/api/docs/assets/cockpit/overview.png)
*Overview shows open work, decisions and recent runs.*

1. Open **Overview** in the left rail. You land on the scan. The in-page heading is the workspace name; the help icon next to **Overview** in the top bar opens this guide. The subtitle greets you and shows today's date. The gray line `environment · tenant-slug · Live` is for support (API environment, this tenant, websocket). Click the slug to copy. The same line sits at the bottom of the account menu. A dashboard build id appears there only on a deployed release.
2. Scan the four fixed blocks: **Needs you**, **Open tickets by category**, **Running and next up**, and **Trajectory**. **Running and next up** warns about due check-ups and overdue look-ats, lists the next few [Agenda](/docs/ai/agenda) items, then the runs in progress, and ends with **Open Agenda**. Trajectory compares this week with last week: **Tickets filed (7 days)** counts confirmed tickets only, and the block links to completed runs, Govern proposals, and Usage.
3. Click any row in the four blocks to open its conversation, run, or filtered list. A row under **Open tickets by category** opens that category's row in Communication. Overview itself does not change operational data.
4. Below that, **AI handling** counts open conversations per mode (**Autonomous**, **Assisted**, **Manual**) and shows **Autonomous replies**, **Handed to a person** and **Drafts edited before sending** over the last 30 days.

On a new workspace, Overview may still show setup progress. Finish those from the [setup guide](/docs/getting-started/setup-guide).

## Read workspace canvases

Workspace canvases are snapshot dashboards (not live tiles). They sit on the **Canvas** tab next to Overview and Usage. The lead agent writes them; you add, delete and set refresh.

1. Open **Overview**, then the **Canvas** tab. Canvas names sit left to right; **Add canvas** is the tab after the last canvas. That opens a dialog: **Title**, **What it should contain**, and **Refresh** (**Manual**, **Daily**, **Weekly**, **Hourly**, **Monthly**). Daily is the default.
2. Save. The lead agent starts writing from your brief. Refresh is an [Agenda](/docs/ai/agenda) wake on that agent — not a separate scheduler.
3. Edit content only through agents. Choose **Ask agent to update** for a one-off rewrite, or change Refresh so Agenda keeps waking the agent. Project canvases live on the project [Canvas](/docs/ai/projects) tab.

## Open work that is waiting on you

![Overview attention items](/api/docs/assets/cockpit/awaiting-decision.png)
*Awaiting decision jumps to the same list as Agent runs.*

1. Find the conversation under **Needs you**. The row uses the same avatar, subject and decision mark as Communication.
2. Open it. You land on the matching thread in Communication.
3. Handle the decision in the thread, then return to Overview.

## Read Activity

1. Open **Activity** from Communication (or an agent's **Activity** row) when you need the full stream. Overview itself keeps to the four blocks.
2. Scan outcomes, not every thinking step.
3. Jump into a thread or agent when a row needs follow-up.

## Check Usage

1. Open the **Usage** tab on Overview. The **Budget (platform keys)** card shows **Tokens today** and **Billable spend this month**, plus breakdowns **By model**, **By agent**, **By user** and **By data region**. The **EU-hosted share** stat shows which part of live tokens ran on EU-hosted models; change the policy under [Data & privacy](/docs/govern/privacy-security). Switch the period with **7 days**, **30 days** or **90 days**, or choose **Export CSV**.
2. Owners and admins choose **Edit caps**. Set a **Daily token cap** and a **Monthly spend cap (USD)**, or leave a field empty for **No cap**. Alerts fire at 80% and 100%.
3. When the budget is exhausted, AI calls on Bokito platform keys pause until you raise the cap or the period resets. Models on your own keys keep working (**Your own key (no charge)**). Empty ratings say **No customer ratings yet** with **Install website chat**.
