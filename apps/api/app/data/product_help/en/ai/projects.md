---
title: How Projects works
intro: A project holds a goal — its home, snapshot canvas, documentation, who leads it, and how much it may spend.
description: Land on the project Home for the flow boards and links, ask an agent to write the snapshot canvas, keep documentation, and cap spend.
keywords: projects, canvas, dashboard, snapshot, tickets, flows, boards, documentation, sections, resources, repository, budget, orchestration
sort: 40
related: workstreams,categories,agenda,knowledge,communication
---

# How Projects works

A project is work that spans days. Open **Projects** when a goal should have a home instead of living only in chat. A project detail has four tabs: **Project** (landing: metadata, flow boards, linked surfaces), **Canvas** (snapshot dashboard written by agents), **Documentation** (what is true), and **Settings** (who runs it and what it works on). The URL keeps the tab (`?tab=canvas`, `?tab=docs`, `?tab=settings`) so you can share that surface.

## Create or open a project

![Projects list](/api/docs/assets/projects/project.png)
*Each card shows the project agent, open tickets, and budget.*

1. Open **Projects**. Choose **New project** (or search **New project** in the command palette) and name the goal, then press Enter. The URL slug is generated for you; open **Advanced: URL slug** only if you need to change it.
2. Read the card: project agent, open tickets (the same boards as Project Home), documentation health, repo status, remaining budget. Search by name or agent when the list grows. If nothing matches, **Clear search** shows every project again.
3. Open it. You land on the **Project** tab. Click the project agent to open it. Admins choose the pencil in the card header to pick another company agent as the project default, or create one. Members can read a project; they cannot delete it or edit the name.

## Read Home and move a ticket

The **Project** tab is the landing. The top row shows the project agent (click opens it; admins change it with the pencil), the project **Agenda** (check-ups that are due and planned look-ats for this project's tickets; **Open in Agenda** shows them all), and the remaining budget. Below are the **Tickets** boards and **Recent activity**. **Settings** holds the agents, repository, resources and the name.

![Flow boards on a project](/api/docs/assets/projects/boards.png)
*One board per flow on the project, with that flow's stages as columns.*

1. Open the **Project** tab. Under **Tickets**, every flow on this project is one board, stacked, titled with its action tag. Its columns are the flow's stages, for example Open, Waiting and Done.
2. Drag a card to another column to move the ticket to that stage. The move shows in the conversation's timeline.
3. Click a card to open that conversation in [Communication](/docs/inbox/communication). **Open in Communication** on the project header opens this project's folder in the Communication sidebar (it unhides the Projects section if you hid it, scrolls the folder into view, and highlights it briefly).
4. No board yet? Admins choose **Add flow** above the boards and pick a flow; **Unlink** on a board removes it again. See [Flows](/docs/ai/workstreams).

## Ask an agent to write a canvas

A project can have several snapshot canvases (not live tiles). You add, delete and set **Refresh**; only agents write the document with `bokito/canvas` under [Govern](/docs/govern/govern). The project agent owns them by default. Refresh is an [Agenda](/docs/ai/agenda) wake (daily at 07:00 UTC by default), not a separate scheduler.

1. Open the **Canvas** tab. Canvas names sit left to right. **Add canvas** is the tab after the last canvas. That opens a dialog: **Title**, **What it should contain**, and **Refresh** (**Manual**, **Daily**, **Weekly**, **Hourly**, **Monthly**). Daily is the default. Save. The managing agent starts writing from your brief.
2. Canvases appear as tabs from left to right. While the document is empty, the tab shows that the agent is writing. After apply you see cards, stats, tables or charts from the last write.
3. Admins can **Show source**. Choose **Ask agent to update** for a one-off rewrite, or change Refresh so Agenda keeps waking the agent. Workspace canvases live on Overview **Canvas**.

## Get tickets onto a project

1. On the **Project** tab, choose **Add flow** and pick the flow. Flows are attached from the project; the flow page only shows where it is used.
2. File a conversation with that flow's action tag. Filing asks which project it belongs to; pick this project. Agents make the same choice. See [Action tags and tickets](/docs/ai/categories).
3. The ticket appears on that flow's board in its first stage, and under **Projects** in the Communication sidebar.
4. How much an agent may do without asking is one workspace-wide dial: see [Autonomy](/docs/govern/autonomy).

## Track project documentation

1. Open the **Documentation** tab (a contextual view of the same docs as Knowledge filtered to this project). Choose **New document**, give it a name, and write in **Write** or **Markdown**. Content always saves as markdown.
2. Active linked queue requests show as chips on the document. Request status stays on the queue item.
3. Expand **Sections** to work per `##` section, each with a status: **Draft**, **Review**, or **Final**. A section an agent writes during a flow run moves to **Review**; gate approval promotes it to **Final**.
4. You edit directly; agents may only edit project documentation inside a [flow](/docs/ai/workstreams) run, so every agent change has a worklog behind it.
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

Define the recurring processes behind the project under [Flows](/docs/ai/workstreams), with an owner and check-up per stage. Everything planned for the project shows on the [Agenda](/docs/ai/agenda) when you pick the project there. Browse the same project docs under [Knowledge](/docs/ai/knowledge) by clicking that project name; organization-wide knowledge stays on the workspace chip.
