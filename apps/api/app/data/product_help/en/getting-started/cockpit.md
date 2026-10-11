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

1. Open **Overview** in the left rail. You land on the scan. The in-page heading is the workspace name; the help icon next to **Overview** in the top bar opens this guide. The subtitle greets you and shows today's date. The gray line `environment · tenant-slug · Live · 1.2.01` is for support (API environment, this tenant, websocket, release version). Click the slug to copy the whole line. The same line sits at the bottom of the account menu. The dev host shows the next patch, one step ahead of production.
2. **Needs you** sits first and full width: open decisions and conversations assigned to you (the same exception list as **For you** in Communication). When it is empty, use **Open For you** or **Connect a channel**.
3. Below that, **AI activity** shows token use over the last 24 hours by hour as a chart (no vertical scale), **Time saved** (estimated minutes from AI outcomes this week: autonomous sends, assisted drafts sent or continued by a person, quiet no-reply triage, confirmed no-reply closes, AI-filed tickets, completed flows) and **Resolved** (conversations closed without a takeover that stayed closed for 72 hours, and matured in the last 7 days), plus a donut of weighted **Autonomous**, **Assisted** and **Manual** actions this week (with open conversation counts under the legend). **AI handling settings** opens the workspace dial.
4. Under **More workspace context**, scan the three secondary blocks: **Open tickets by category**, **Running and next up**, and **Trajectory**. **Running and next up** warns about due check-ups and overdue look-ats, lists the next few [Agenda](/docs/ai/agenda) items, then the runs in progress, and ends with **Open Agenda**. Trajectory compares this week with last week: **Tickets filed (7 days)** counts confirmed tickets only, and the block links to completed runs, Govern proposals, and Usage.
5. Click any row to open its conversation, run, or filtered list. A row under **Open tickets by category** opens that category's row in Communication. When an open conversation has had no message for 14 days, **Quiet for 14 days** lists it with **Close**. With no recurring task yet, a one-time banner **Let an agent help you move forward** offers **Set up task**. That opens **Plan** already filled: every weekday at 09:00, the lead agent, and a task that names what is open and suggests next steps. After **Save** you land in that conversation, where the agent writes each time. **Hide** dismisses the banner for this workspace.

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

1. Open **Activity** from Communication (or an agent's **Activity** row) when you need the full stream. Overview itself keeps **Needs you** first, then the secondary context blocks.
2. Scan outcomes, not every thinking step.
3. Jump into a thread or agent when a row needs follow-up.

## Check Usage

1. Open the **Usage** tab on Overview. At the top, **Token use** shows a per-day chart for **7 days**, **30 days** or **90 days**, with **Tokens** and **Cost** for that period beside it. Below that sit **Budget (platform keys)** (tokens today and billable spend this month), **Outcomes** (this week’s conversations, autonomy rate, time saved, average feedback, customer rating, and open decisions), and **Breakdown** (**By model**, **By agent**, **By user**, **By data region**). **Time saved** is a 7-day estimate: fixed minutes for autonomous replies, assisted drafts (including when a person answered after a draft), quiet no-reply triage, confirmed no-reply closes, AI-filed tickets and completed flows. Data-region mix is under **By data region**; change the policy under [Data & privacy](/docs/govern/privacy-security). Choose **Export CSV** in the header.
2. Owners and admins choose **Edit caps**. Set a **Daily token cap** and a **Monthly spend cap (USD)**, or leave a field empty for **No cap**. Alerts fire at 80% and 100%.
3. When the budget is exhausted, AI calls on Bokito platform keys pause until you raise the cap or the period resets. Models on your own keys keep working (**Your own key (no charge)**).
