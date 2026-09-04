---
title: How Projects works
intro: A project holds a goal — its implementation queue, its documentation, who leads it, and how much it may spend.
description: Work the implementation queue, keep smart documentation with section statuses, link resources like a repo or drive, and let agents propose queue items from conversations.
keywords: projects, queue, documentation, sections, resources, repository, budget, orchestration
sort: 40
related: agenda,knowledge,communication,workstreams
---

# How Projects works

A project is work that spans days. Open **Projects** when a goal should have a home instead of living only in chat. A project detail has three tabs: **Queue** (what should happen), **Documentation** (what is true), and **Settings** (who runs it and what it works on).

## Create or open a project

![Projects list](/api/docs/assets/projects/project.png)
*Each card shows the project agent, open queue items, and budget.*

1. Open **Projects**. Choose **New project** (or search **New project** in the command palette) and name the goal, then press Enter. The URL slug is generated for you; open **Advanced: URL slug** only if you need to change it.
2. Read the card: project agent, open queue items, documentation health, repo status, remaining budget. Search by name or agent when the list grows. If nothing matches, **Clear search** shows every project again.
3. Open it. You land on the **Queue** tab. The **Settings** tab holds the **Who runs this** card; use **Change lead** to pick another agent or create one. Members can read a project; they cannot delete it or edit the name.

## Work the implementation queue

1. On the **Queue** tab, choose **Add to queue**. Give the request a title, pick a kind (**Feature**, **Bug**, **Task**, **Idea**, **Risk**) and a priority, then choose **Add**.
2. Items are grouped by status: **Proposed**, **Accepted**, **Analyzing**, **Planned**, **In progress**, **Verifying**, **Done**, **Rejected**. Open an item to read its context, impact analysis, and linked knowledge documents.
3. Choose **Accept** on a proposed item. The project agent routes it into the best-matching project [workstream](/docs/ai/workstreams) and a run starts with the item as input. Every project ships with a default **Review and execute** workstream, so there is always a runnable path. The item's status follows the run: a completed run completes the item, a failed or cancelled run puts it back to **Planned**. You can also **Link document** on an open item to attach a project or organization knowledge page.
4. When the work is done, choose **Ready to verify** and then **Verify**. The agent checks the documentation against reality before the item moves to **Done**.

Items born from a conversation show **Open source thread**, which takes you back to the exact conversation in [Communication](/docs/inbox/communication).

## Let conversations feed the queue

1. Link a thread to a project in the conversation's detail panel (**Project**).
2. When someone describes a bug or asks for something new, the agent proposes a queue item. A **Queue proposal** card appears in the thread.
3. Choose **Add to queue** to accept, or **Dismiss**. Choose **Always allow** if the agent may add items without asking.
4. Turn on **Autonomous mode** in the project's **Settings** tab to skip the accept step: conversation items are accepted automatically and analysis starts right away.

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

1. Open the project's **Settings** tab.
2. Set daily and hourly token budgets so one goal cannot consume the whole workspace cap.
3. When a project hits its cap, the card shows **Token budget reached**. Workspace caps still live on Cockpit **Usage**.

## What to do next

Define the recurring processes behind the queue under [Workstreams](/docs/ai/workstreams). Attach a schedule on the [Agenda](/docs/ai/agenda). Browse the same project docs under [Knowledge](/docs/ai/knowledge) by clicking that project name; organization-wide knowledge stays on the workspace chip.
