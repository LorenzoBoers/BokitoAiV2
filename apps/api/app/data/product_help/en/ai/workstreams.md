---
title: How Flows work
intro: A flow is the stage pipeline of exactly one action tag. The page is titled with that hashtag (`#klacht`) and shows a live board of its tickets, with a lane per project.
description: Create a flow for an action tag, follow its tickets per stage and project, edit the stages in edit mode, and deactivate or delete it.
keywords: flows, workstreams, playbooks, stages, owner, check-up, pipeline, tickets, hashtags, action tags, projects, board, lanes, edit mode
sort: 45
related: categories,projects,agenda,agents,knowledge
---

# How Flows work

A flow is the pipeline for work that comes back under one action tag: a complaint, a repair, a filing. Each flow has exactly one action tag and is titled with its hashtag (`#klacht`); the flow page shows its tickets per stage, and projects show the same stages as a board.

## Create a flow

1. Open **Flows** (Work group) and choose **New flow**. In the dialog, pick a free tag from the pills, or type in the search field to narrow them.
2. When no tag matches what you typed, choose **Create tag** with that hashtag. It becomes the flow's action tag; an existing free hashtag is reused. A hashtag that already belongs to another flow does not appear and cannot start a second one.
3. The **Flows** list shows each flow with its stages, the number of open tickets per stage, the projects it is used in, and the last activity.

## Follow tickets on the flow board

![Flow board with stages as columns and a lane per project](/api/docs/assets/workstreams/board.png)
*Stages are the columns; each project that uses the flow is a lane.*

1. Open a flow. Under the title you see its **Action tag**, the projects it is **Used in**, and counts such as **Open tickets** and **Longest idle**.
2. The board has a column per stage and a lane per project, plus **No project** for tickets filed without one. Collapse a lane with its header, or choose **Open project** to go to that project.
3. A card shows the conversation title, contact, up to two intake fields, the channel, the time of the last message, the assignee and the next check-up. Click a card to open the conversation.
4. Drag a card to another stage in the same lane. The move shows in the conversation's timeline; the project only changes from the conversation. If the target stage has required fields that are still empty, a dialog asks for them first and the card stays put until they are filled.

## Edit the stages in edit mode

1. Admins choose **Edit** at the top right. The board hides and the **Edit mode** bar appears; title, description and stages become editable. Changing the title renames the action tag on every conversation; the bar shows the old and new hashtag before you save.
2. In **Ticket stages**, choose **Add new stage** for each step (for example New, Waiting for parts, Fixed). Set each **Stage kind** to open, waiting, done or closed, and keep at least one done stage. Drag stages to reorder. Every flow starts with Open, Waiting and Done; **Save** is disabled while the pipeline is empty or has no done stage, so a board can never end up without columns.
3. On a done stage, turn on **Auto-close conversation** when entering it should close the thread.
4. Open **Intake fields** on a stage to add text, long text, number or choice-list fields. Fields on the first stage are asked when someone files the action tag. Required fields on a later stage must be filled before a ticket can enter that stage.
5. Pick an **Owner** per stage (a person, agent or team, or **Keep current owner**) and a **Check-up** rhythm. Tickets in that stage get a check-up on [Agenda](/docs/ai/agenda) for their owner; done stages never check up.
6. Nothing saves until you choose **Save**; the bar shows **Unsaved changes** meanwhile. **Cancel** asks to **Discard** your changes and returns to the board unchanged. A hashtag that another tag already uses cannot be saved.

## Show the flow on a project

1. Projects pick their flows; the flow page only shows where it is used. Open the [project](/docs/ai/projects) and choose **Add flow**.
2. **Unlink** on a project board removes the flow from that project. Its tickets keep their project but leave that board.
3. Filing a ticket asks which of the flow's projects it belongs to, or **No project**.

## Deactivate or delete a flow

1. Choose **Deactivate** at the top right to stop new work on the flow. Its status shows **Deactivated**.
2. A deactivated flow shows **Activate** and **Delete**. Delete moves it to the trash; it is not available while the flow is active.

## What to do next

File an action tag from **Add hashtags** on a conversation in [Communication](/docs/inbox/communication); see [Action tags and tickets](/docs/ai/categories).
