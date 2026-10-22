---
title: How Flows work
intro: A flow belongs to exactly one label. The list and page show a title with that label (`#klacht`) beside it, and a live board of its tickets with a lane per folder. The label is colored only while the flow exists.
description: Create a flow for a label, follow its tickets per stage and folder lane, edit or add stages on the board, and delete it.
keywords: flows, workstreams, autonomy, department, recurring ticket, client approval, delivers to, destination, stages, owner, check-up, pipeline, tickets, hashtags, labels, folders, board, lanes
sort: 45
related: categories,folders,agenda,agents,knowledge
---

# How Flows work

A flow is the pipeline for work that comes back under one label: a complaint, a repair, a filing. Each flow has exactly one label. The Flows list and the flow page show an operator title with the workflow mark on the left and the label (`#klacht`) on the right; the board shows tickets per stage, and folders show the same stages as a board.

## Create a flow

1. Open **Flows** (Work group) and choose **New flow**. The dialog lists existing flow labels first; those pills are disabled. Type in the search field to narrow to tags that are still free, or type a new hashtag.
2. Choose a free tag, or **Create tag** when nothing matches. A label setup appears at the bottom: pick a color and an icon. The icon list is long and scrollable (popular marks first, then the full Lucide set); type to filter by name or Dutch/English keywords. A new label starts blue with the flow mark. **Create** attaches that hashtag to the flow; an existing free hashtag is reused. A hashtag that already belongs to another flow stays disabled and cannot start a second one.
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

1. Open the flow. Next to **Autonomy**, **Stage moves by agents** shows the setting. Owners and admins pick one of four options.
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

## Set where a flow delivers

A flow can name the folder, and optionally the place in its [Works in](/docs/ai/folders), where finished tickets land, for example **Delivers to Administration › Exact**.

1. Open the flow and choose the gear at the top right. **Delivers to** shows the destination; owners and admins choose **Set destination** or **Change**.
2. Pick a folder, then **The folder itself** or one of its Works in places, and choose **Save**.
3. When a ticket of this flow reaches a done stage, its conversation shows **Delivered in** that place, unless the work was already delivered into a folder.
4. **Remove** clears the destination; tickets then deliver only where their agents wrote.

## Describe how the flow handles its work

A flow is also the approach for one kind of work: the label says what it is, the flow says how the agent works and what done produces.

1. Open the flow and choose the gear at the top right. In **Done means**, write what done produces in one sentence, for example **The posts of the month are scheduled**.
2. In **Working method**, write in a few sentences how the agent handles this work. It saves when you leave the field. Agents on this flow's conversations get the working method, the tools and connections it uses (**Uses**), and what done means.
3. Turn on **Handled directly** for short work such as a question: the flow has no waiting stage and no board in folders, and the ticket closes when the work is done.
4. An agent can propose the same changes in a conversation with `update_flow`; the proposal follows [Govern](/docs/govern/govern).

## Set the autonomy and department of a flow

Each flow has its own dial under the workspace ceiling, and belongs to the department that runs it.

1. Open the flow and choose the gear at the top right. **Autonomy** shows **Workspace default**, **Manual**, **Assisted** or **Autonomous**. Owners and admins pick one.
2. Stricter than the workspace applies at once. Looser waits for approval in [Govern](/docs/govern/autonomy); the window says **Looser than now goes through Govern**. On **Assisted**, every reply on a ticket of this flow becomes a draft a person sends, even when the conversation is on Autonomous. Hover the mode in the conversation header to see that the flow set it.
3. Under **Department**, pick the department that runs this flow. Its lead agent includes the flow's tickets in the morning briefing, and the [department page](/docs/getting-started/team) shows the flow with its scorecard.
4. When a flow's scorecard shows enough clean outcomes, the department lead proposes a looser dial in the department conversation (see the next section).

## Let the department lead improve a flow

Once a day the lead agent of a department reads the scorecards of its flows and proposes improvements in the department conversation.

1. Open the department in the left menu. Under **Improvement proposals**, each open proposal shows what it changes: **Autonomy**, **Instructions**, **Capabilities** or **New flow**. Choose **Open** to go to the department conversation.
2. **Autonomy:** after enough tickets without a correction or a rejected decision the lead proposes **Autonomous**; when many tickets need a correction it proposes a step back to **Assisted**. The number of clean tickets is a workspace setting (20 by default).
3. **Instructions:** when the team corrects three or more drafts on the flow's label, the lead proposes to add how the team wrote those replies to the **Working method**.
4. **Capabilities:** when the team rejects the same tool three or more times on the flow's tickets, the lead proposes to take it out of **Uses**, or to add a line that the agent asks first.
5. **New flow:** when the same kind of work keeps arriving without a label that fits, the lead of the department that saw it proposes a flow with a new label for that department.
6. Approve or reject the card in the conversation. Nothing changes before someone approves. The same proposal does not come back for 30 days, and how often a lead's proposals are approved counts on that agent's scorecard.

## Open a ticket every period

Work that comes back, such as monthly content or a weekly report, opens itself as a ticket on the flow.

1. Ask an agent in a conversation, for example: **Open a #maandcontent ticket in folder Klanten/Studio Veluwe on the first of every month.**
2. The agent sets a rule with the flow label, the folder, the title (for example **Maandcontent {maand}**) and the schedule. One rule per flow and folder: asking again updates it.
3. On that date, Bokito opens one conversation, files it on the flow in that folder, and gives it to the agent. When the rule has instructions, the agent starts right away.
4. The rule shows on [Agenda](/docs/ai/agenda) under routines. Pause or delete it there.

## Get the client's approval in a stage

A stage that waits on the customer moves on the client's answer.

1. Give the approval stage **Waiting on customer** (see the checklist section above).
2. The agent sends the work to the client as a draft. When the client answers, the agent reads the reply.
3. **Approved** moves the ticket to the next stage. **Changes requested** moves it back one stage and adds the feedback to the folder doc **Afspraken**, so the next round follows it.
4. The verdict shows in the conversation timeline and counts as a correction on the flow's scorecard.

## Delete a flow

1. Open the ··· menu at the top right and choose **Delete**. Delete moves the flow to the trash.

## What to do next

File a label with a flow from **Add hashtags** on a conversation in [Communication](/docs/inbox/communication); see [Labels and tickets](/docs/ai/categories).
