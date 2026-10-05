---
title: How Projects works
intro: A project holds a goal — its home, snapshot canvas, documentation, who leads it, and how much it may spend.
description: Land on the project Home for the signals board and links, ask an agent to write the snapshot canvas, keep documentation, and cap spend.
keywords: projects, canvas, dashboard, snapshot, signals, documentation, sections, resources, repository, budget, orchestration
sort: 40
related: agenda,knowledge,communication,workstreams
---

# How Projects works

A project is work that spans days. Open **Projects** when a goal should have a home instead of living only in chat. A project detail has four tabs: **Project** (landing: metadata, signals board, linked surfaces), **Canvas** (snapshot dashboard written by agents), **Documentation** (what is true), and **Settings** (who runs it and what it works on). The URL keeps the tab (`?tab=canvas`, `?tab=docs`, `?tab=settings`) so you can share that surface.

## Create or open a project

![Projects list](/api/docs/assets/projects/project.png)
*Each card shows the project agent, open signals, and budget.*

1. Open **Projects**. Choose **New project** (or search **New project** in the command palette) and name the goal, then press Enter. The URL slug is generated for you; open **Advanced: URL slug** only if you need to change it.
2. Read the card: project agent, open signals (the same board as Project Home), documentation health, repo status, remaining budget. Search by name or agent when the list grows. If nothing matches, **Clear search** shows every project again.
3. Open it. You land on the **Project** tab. Click the project agent to open it. Admins choose the pencil in the card header to pick another company agent as the project default, or create one. Members can read a project; they cannot delete it or edit the name.

## Read Home and move a signal

The **Project** tab is the landing: the project agent (avatar, status, last active; click opens the agent, admins change it from the header pencil), remaining budget with a pencil in the card header, linked playbooks, one **Signals** kanban, and attached resources. **Settings** holds the name, repository, playbooks, and resources — not a second copy of the agent or budget.

1. Open the **Project** tab. The **Signals** board is the typed work for this project, left to right: **Proposed**, **Open**, **Waiting**, **Done**.
2. Drag a card to the next stage, or open the thread icon on a card to return to that conversation in [Communication](/docs/inbox/communication).
3. Refresh the snapshot on the **Canvas** tab if the board should match the new state.

## Ask an agent to write a canvas

A project can have several snapshot canvases (not live tiles). You add, delete and set **Refresh**; only agents write the document with `bokito/canvas` under [Govern](/docs/govern/govern). The project agent owns them by default. Refresh is an [Agenda](/docs/ai/agenda) wake (daily at 07:00 UTC by default), not a separate scheduler.

1. Open the **Canvas** tab. Canvas names sit left to right. **Add canvas** is the tab after the last canvas. That opens a dialog: **Title**, **What it should contain**, and **Refresh** (**Manual**, **Daily**, **Weekly**, **Hourly**, **Monthly**). Daily is the default. Save. The managing agent starts writing from your brief.
2. Canvases appear as tabs from left to right. While the document is empty, the tab shows that the agent is writing. After apply you see cards, stats, tables or charts from the last write.
3. Admins can **Show source**. Choose **Ask agent to update** for a one-off rewrite, or change Refresh so Agenda keeps waking the agent. Workspace canvases live on Overview **Canvas**.

## Link conversations so signals land on the board

1. Link a thread to a project in the conversation's detail panel (**Project**).
2. When the agent types that work as a signal, the card appears on the **Signals** board in **Proposed**.
3. Drag it through **Open**, **Waiting**, and **Done**. How much an agent may do without asking is one workspace-wide dial: see [Autonomy](/docs/govern/autonomy).

## Track project documentation

1. Open the **Documentation** tab (a contextual view of the same docs as Knowledge filtered to this project). Choose **New document**, give it a name, and write in **Write** or **Markdown**. Content always saves as markdown.
2. Active linked queue requests show as chips on the document. Request status stays on the queue item.
3. Expand **Sections** to work per `##` section, each with a status: **Draft**, **Review**, or **Final**. A section an agent writes during a workstream run moves to **Review**; gate approval promotes it to **Final**.
4. You edit directly; agents may only edit project documentation inside a [workstream](/docs/ai/workstreams) run, so every agent change has a worklog behind it.
5. Choose **Open in Knowledge hub** to edit the same document under Knowledge → Projects.

## Link resources

1. Open the **Settings** tab. The repository card connects a GitHub repo as before; status moves from **Indexing repo** to **Repo ready**.
2. Under **Resources**, choose **Link a resource** to attach other surfaces the project works on: a drive folder, a Notion page, a spreadsheet, a coding tool, or a website.
3. Pick a type, add a label and a reference (URL or ID), then choose **Link**. Resources are linked by reference for now; connectors that sync and act on them attach later.

## Cap spend

1. Open the project's **Project** tab. The budget card shows usage against today's cap.
2. Choose the pencil in the budget header. Set **Daily token cap** and **Hourly token cap** so one goal cannot consume the whole workspace cap. Leave a field empty to inherit Cockpit **Usage**. Choose **Save budget**.
3. When a project hits its cap, the card shows **Cap reached** and agents pause on that project. Workspace caps still live on Cockpit **Usage**.

## What to do next

Define the recurring processes behind the project under [Workstreams](/docs/ai/workstreams). Attach a schedule on the [Agenda](/docs/ai/agenda). Browse the same project docs under [Knowledge](/docs/ai/knowledge) by clicking that project name; organization-wide knowledge stays on the workspace chip.
