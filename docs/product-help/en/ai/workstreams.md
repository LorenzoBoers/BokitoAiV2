---
title: How Flows work
intro: A flow belongs to exactly one label. The list and page show a title with that label (`#klacht`) beside it, and a live board of its tickets with a lane per project. The label is colored only while the flow exists.
description: Create a flow for a label, follow its tickets per stage and folder lane, edit or add stages on the board, and delete it.
keywords: flows, workstreams, playbooks, stages, owner, check-up, pipeline, tickets, hashtags, labels, projects, board, lanes
sort: 45
related: categories,folders,agenda,agents,knowledge
---

# How Flows work

A flow is the pipeline for work that comes back under one label: a complaint, a repair, a filing. Each flow has exactly one label. The Flows list and the flow page show an operator title with the workflow mark on the left and the label (`#klacht`) on the right; the board shows tickets per stage, and projects show the same stages as a board.

## Create a flow

1. Open **Flows** (Work group) and choose **New flow**. The dialog lists existing flow labels first; those pills are disabled. Type in the search field to narrow to tags that are still free, or type a new hashtag.
2. Choose a free tag, or **Create tag** when nothing matches. A label setup appears at the bottom: pick a color and an icon. A new label starts blue with the flow mark. **Create** attaches that hashtag to the flow; an existing free hashtag is reused. A hashtag that already belongs to another flow stays disabled and cannot start a second one.
3. The **Flows** list shows each flow with the route icon, the title, and its label beside it, plus stages, open tickets per stage, projects it is used in, and last activity.

## Follow tickets on the flow board

![Flow board with stages as columns and a lane per project](/api/docs/assets/workstreams/board.png)
*Stages are the columns; each project that uses the flow is a lane.*

1. Open a flow. The label sits beside the title. Admins click that pill to pick a color and an icon; it stays a pill, with a colored icon tile to the left of the name. Under that you see counts such as **Open tickets** and **Longest idle**, and the projects the flow is **Used in**.
2. The board has a column per stage and a lane per project, plus **No project** for tickets filed without one. Collapse a lane with its header, or choose **Open project** to go to that project.
3. A card shows the conversation title, contact, up to two intake fields, the channel, the time of the last message, the assignee and the next check-up. Click a card to open the conversation.
4. When stages define intake fields, a **Filter** row above the board lets you narrow tickets by those values (choice lists pick an option; text and number match what is on the ticket). **Clear filters** restores the full board; column counts follow the filter.
5. Drag a card to another stage in the same lane. The move shows in the conversation's timeline; the project only changes from the conversation. If the target stage has required fields that are still empty, a dialog asks for them first and the card stays put until they are filled.

## Edit stages on the board

1. Admins change the flow name by hovering the title: it becomes a pill with a pencil, and Enter saves the name. The description sits under it and saves when you leave the field. The title is the flow name only; rename the label under **Labels** when the hashtag itself should change.
2. Each column header shows the stage name with the ticket count beside it. Hover the header and the gear appears next to the name. It opens a dialog to change the name, the kind (not started, active, done, closed) and the intake fields, or to remove the stage. Keep at least one done stage. **Move left** and **Move right** only stay available when the stage stays in its group. **Save** writes that stage immediately.
3. Hover the headers and a plus appears in each gap. One click inserts a stage of the same kind as the column on the left, named after that kind until you rename it. **Add stage** on the right adds another stage of the last column's kind. Not started never sits after Active, and Done never sits before Active. Every flow starts with Not started, Active and Done.
4. In **Intake fields** you add text, long text, number or choice-list fields, and pick an **Owner** and a **Check-up**. On a done stage, turn on **Auto-close conversation** when entering it should close the thread. Fields on the first stage are asked when someone files the label. Required fields on a later stage must be filled before a ticket can enter that stage. **Save** in that dialog writes the stage immediately. Done stages never check up; a check-up shows on [Agenda](/docs/ai/agenda) for the owner.

## Folders and lanes on the flow board

1. A folder becomes a lane on the flow when that folder's labels include the flow's action tag. On **Flows**, each row shows those shared folders as chips; a chip opens that folder, the rest of the row opens the flow.
2. Empty lanes (folders with no tickets yet) stay hidden. Turn on **Show empty folders** on the flow page to see them.
3. On a [folder](/docs/ai/folders), a flow appears under **Flows** once a conversation in that folder (or a nested folder) has the flow's label filed as a ticket.

## Delete a flow

1. Open the ··· menu at the top right and choose **Delete**. Delete moves the flow to the trash.

## What to do next

File a label with a flow from **Add hashtags** on a conversation in [Communication](/docs/inbox/communication); see [Labels and tickets](/docs/ai/categories).
