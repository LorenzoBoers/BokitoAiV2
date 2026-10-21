---
title: How Flows work
intro: A flow belongs to exactly one label. The list and page show a title with that label (`#klacht`) beside it, and a live board of its tickets with a lane per folder. The label is colored only while the flow exists.
description: Create a flow for a label, follow its tickets per stage and folder lane, edit or add stages on the board, and delete it.
keywords: flows, workstreams, always review, delivers to, destination, stages, owner, check-up, pipeline, tickets, hashtags, labels, folders, board, lanes
sort: 45
related: categories,folders,agenda,agents,knowledge
---

# How Flows work

A flow is the pipeline for work that comes back under one label: a complaint, a repair, a filing. Each flow has exactly one label. The Flows list and the flow page show an operator title with the workflow mark on the left and the label (`#klacht`) on the right; the board shows tickets per stage, and folders show the same stages as a board.

## Create a flow

1. Open **Flows** (Work group) and choose **New flow**. The dialog lists existing flow labels first; those pills are disabled. Type in the search field to narrow to tags that are still free, or type a new hashtag.
2. Choose a free tag, or **Create tag** when nothing matches. A label setup appears at the bottom: pick a color and an icon. A new label starts blue with the flow mark. **Create** attaches that hashtag to the flow; an existing free hashtag is reused. A hashtag that already belongs to another flow stays disabled and cannot start a second one.
3. The **Flows** list shows each flow with the route icon, the title, and its label beside it, plus stages, open tickets per stage, folders it is used in, and last activity.

## Follow tickets on the flow board

![Flow board with stages as columns and a lane per folder](/api/docs/assets/flows/board.png)
*Stages are the columns; each folder that uses the flow is a lane.*

1. Open a flow. The label sits beside the title. Admins click that pill to pick a color and an icon; it stays a pill, with a colored icon tile to the left of the name. Under that you see counts such as **Open tickets** and **Longest idle**, and the folders the flow is **Used in**.
2. The board has a column per stage and a lane per folder, plus **No folder** for tickets filed without one. Collapse a lane with its header, or choose **Open folder** to go to that folder.
3. A card shows the conversation title, contact, up to two intake fields, the next step (for example **Waiting on customer · 1 item missing**), the channel, the time of the last message, the deadline (**Due in 3 days**, **2 days overdue**), the assignee and the next check-up. Click a card to open the conversation.
4. When stages define intake fields, a **Filter** row above the board lets you narrow tickets by those values (choice lists pick an option; text and number match what is on the ticket). **Clear filters** restores the full board; column counts follow the filter.
5. Drag a card to another stage in the same lane. The move shows in the conversation's timeline; the folder only changes from the conversation. If the target stage has required fields that are still empty, a dialog asks for them first and the card stays put until they are filled.

## Edit stages on the board

1. Admins change the flow name by hovering the title: it becomes a pill with a pencil, and Enter saves the name. The description sits under it and saves when you leave the field. The title is the flow name only; rename the label under **Labels** when the hashtag itself should change.
2. Each column header shows the stage name with the ticket count beside it. Hover the header and the gear appears next to the name. It opens a dialog to change the name, the kind (not started, waiting, done, closed) and the intake fields, or to remove the stage. Keep at least one done stage. **Move left** and **Move right** only stay available when the stage stays in its group. **Save** writes that stage immediately.
3. Hover the headers and a plus appears in each gap. One click inserts a stage of the same kind as the column on the left, named after that kind until you rename it. **Add stage** on the right adds another stage of the last column's kind. Not started never sits after Waiting, and Done never sits before Waiting. Every flow starts with Not started, Waiting and Done, named in the workspace language.
4. In **Intake fields** you add text, long text, number or choice-list fields, and pick an **Owner** and a **Check-up**. On a done stage, turn on **Auto-close conversation** when entering it should close the thread. Fields on the first stage are asked when someone files the label. Required fields on a later stage must be filled before a ticket can enter that stage. **Save** in that dialog writes the stage immediately. Done stages never check up; a check-up shows on [Agenda](/docs/ai/agenda) for the owner.

## Decide who moves stages

An agent that reads a conversation can say which stage a ticket belongs in. The flow decides whether that move happens directly or waits for a person.

1. Open the flow. Next to **Always review**, **Stage moves by agents** shows the setting. Owners and admins pick one of four options.
2. **Workspace default** follows the setting under [Labels](/docs/ai/categories). **Propose, a person confirms** puts a decision card in the conversation; the ticket moves when someone chooses **Move to** that stage.
3. **Move when sure enough** moves directly when the agent's certainty is at least the number in **Certainty from**. Below that it proposes.
4. **People move stages** refuses every agent move; the agent says in the conversation which stage fits.
5. A person who drags the card or picks a stage answers the open proposal. Bokito records whether the agent was right, so its next proposals improve.

## Add a checklist to a stage

A stage can list what has to be there before the work moves on, and say who it waits on.

1. Open the stage with the gear on its column header. Under **Waiting on**, choose **Waiting on customer**, **Waiting on us** or **Waiting on third party**. **Follow turn** uses whoever wrote last.
2. Under **Checklist**, choose **Add item** and type the item, for example **ID received**. Pick the evidence (**Tick by hand**, **Needs an attachment**, **Needs an answer**) and turn on **Required** where it must be done.
3. Turn on **Required items before moving on** when a ticket may only move to a later stage once every required item is confirmed. Moving back stays possible.
4. On the ticket in the conversation, people tick items directly. An agent's tick shows half-filled with **Confirm**; it only counts once a person confirms it.

## Folders and lanes on the flow board

1. A folder becomes a lane on the flow when that folder's labels include the flow's label. On **Flows**, each row shows those shared folders as chips; a chip opens that folder, the rest of the row opens the flow.
2. Empty lanes (folders with no tickets yet) stay hidden. Turn on **Show empty folders** on the flow page to see them.
3. On a [folder](/docs/ai/folders), a flow appears under **Flows** once a conversation in that folder (or a nested folder) has the flow's label filed as a ticket.

## Always review a flow's replies

A flow can make a person confirm every reply on its tickets.

![Always review on a flow](/api/docs/assets/flows/always-review.png)
*The switch sits under the flow title.*

1. Open the flow. Under the title, turn on **Always review**. Only an owner or admin can change it.
2. Every reply on a ticket of this flow becomes a draft a person sends, even when the conversation and the [Autonomy](/docs/govern/autonomy) dial are on Autonomous.
3. Hover the mode in the conversation header: it says **This flow is set to Always review, so a person sends.**
4. Turn it off when autonomous replies are fine for these tickets.

## Set where a flow delivers

A flow can name the folder, and optionally the place in its [Works in](/docs/ai/folders), where finished tickets land, for example **Delivers to Administration › Exact**.

1. Open the flow. Under the title, **Delivers to** shows the destination; owners and admins choose **Set destination** or **Change**.
2. Pick a folder, then **The folder itself** or one of its Works in places, and choose **Save**.
3. When a ticket of this flow reaches a done stage, its conversation shows **Delivered in** that place, unless the work was already delivered into a folder.
4. **Remove** clears the destination; tickets then deliver only where their agents wrote.

## Delete a flow

1. Open the ··· menu at the top right and choose **Delete**. Delete moves the flow to the trash.

## What to do next

File a label with a flow from **Add hashtags** on a conversation in [Communication](/docs/inbox/communication); see [Labels and tickets](/docs/ai/categories).
