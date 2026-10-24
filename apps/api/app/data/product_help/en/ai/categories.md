---
title: Labels and tickets
intro: A label has color and an icon only while a flow is attached. Filing that label turns the conversation into a ticket that moves through the flow's stages.
description: Attach a flow to a label, file a ticket from the Labels picker, confirm what the AI proposed, move a ticket through its stages, and move a second request to its own conversation.
keywords: labels, flows, tickets, stages, folder, intake, move conversation, merge conversations
sort: 46
related: flows,communication,channels,folders,widget
---

# Labels and tickets

A label with a flow is still just a label. A conversation carries at most one: filing it makes the conversation a ticket that moves through that flow's stages. The folder comes from the conversation's labels, including labels on the contact. The same label can also be a folder via **Save as map**. Color and icon exist only while the flow is attached, and are set on the flow. Take the flow off and the label is plain at once.

When a channel has an **AI agent** linked, that agent reads each inbound message (summary, priority, labels and tickets) in one run. Under **Manual** Autonomy the agent still reads and may file labels or tickets, but it does not draft a customer reply. Without a channel agent there is no AI read. A certain read files the ticket when that label allows auto-labeling. A certain read on a label that does not auto-label becomes a card **File as name** with **File** and **Not now**. An unsure read becomes a confirm on the conversation, and a request that matches nothing is counted under **What we missed**. Free labels stay next to the label for grouping; see [Communication](/docs/inbox/communication).

## Attach a flow to a label

![Labels settings with one label](/api/docs/assets/categories/catalog.png)
*One Labels list: colored flow labels, plain free labels, and a count. Open the flow from the row.*

1. Open **Settings**, then **Labels**. The page shows one flat **Labels** list (flow labels first), then **What we missed** and who may confirm tickets.
2. Choose **New label** and enter a name and description. There is no color, icon or group on this page. Free labels stay plain.
3. On a free label, choose **Create flow**. That creates or links a flow titled with the label name. The label becomes a colored flow label in the same list. Choose **Open flow** to set the color, icon, stages and filing on the flow page. A new flow starts with Open, Waiting and Done, and a sky label with the route icon.
4. Choose **Save as map** to give the label a place in the folder tree. The conversation count on a row opens those conversations in Communication. Flow labels appear under **Flows**.

## File a ticket on a conversation

![Ticket panel on a conversation](/api/docs/assets/categories/ticket-panel.png)
*The Ticket panel shows the flow, a stage bar, the folder and the flow's custom fields.*

1. Open a conversation in **Communication**. Under **This conversation**, choose **Add labels**.
2. Type the name and pick a label with a flow (marked **Label**), or a free label. An unknown name asks whether to add it as a label or **Attach a flow**.
3. Filing does not ask for a folder. The conversation matches every saved map whose tags it fully covers; the header shows those maps. Canvas and docs live on the folder hub under **Folders**.
4. The ticket starts in the first stage of the flow. The list row shows the label with the stage and a colored dot. Changing to another label asks to **Replace** (or split the conversation for a second request). Under **Labels**, take the label off from its remove mark. A dialog shows the label and asks you to confirm; **Unlink** takes the ticket off the conversation.
5. In the composer, `/ticket name` files the same ticket.

## Confirm what the AI proposed

1. An unsure read shows on the conversation as "Looks like complaint" with **Confirm** and **Dismiss**.
2. Nothing routes and no flow starts before someone confirms. Members can always file a ticket themselves; **Who may confirm tickets** on **Settings** → **Labels** decides who may confirm a proposal. On the same card, **Stage moves by agents** sets the default for flows without their own setting, and **Deadline is near** sets how many days before a deadline a ticket counts as near.
3. Proposals do not count as filed tickets on Today until they are confirmed.
4. Set the **Tickets** posture on [Govern](/docs/govern/govern) if agents should stop filing tickets.

## Move a ticket through its stages

1. In the **Ticket** panel, click a segment of the stage bar to move the ticket to that stage; **Stage 2 of 3** shows where it is, followed by the next check-up when the stage has one. On a flow board, or on the department's folder tab, drag the card to another column instead; see [Workforce](/docs/getting-started/team). On a board card, the contact name is a link to that contact when the conversation is linked to one.
2. If the target stage has required fields that are still empty, a dialog asks for them. The ticket stays on its current stage until those values are filled. The same dialog appears when you drag a card. Closing the conversation moves its ticket to the done stage in the same step. If that stage still needs required fields, a dialog asks for them, and neither the conversation nor the ticket closes until they are filled.
3. Every move shows in the timeline, for example **Ticket moved to Waiting**. The ticket's status always follows the kind of its stage: open, waiting or done.
4. Under the folder, every custom field of the flow has its own row. Click a value to edit it; it saves when you press Enter, leave the field, or pick an option. A `*` marks a required field and turns orange while it is empty.
5. Admins without fields see **Add custom fields to this flow**, which opens the flow in edit mode. Change the stages and fields there; see [Flows](/docs/ai/flows).
6. When an agent moves the ticket, the flow's **Stage moves by agents** setting applies. Under **Propose, a person confirms**, the ticket panel shows **1 proposal waits for a decision in the conversation** until someone answers the card.

## Set a deadline and follow the next step

A ticket can carry a deadline with where it comes from. The panel and the board card say what the ticket waits on and how much time is left.

1. In the **Ticket** panel, pick a date under **Deadline**. Choose the source: **Statutory**, **Requested**, **Agreed** or **Manual**, and type the **Basis**, for example the article or the customer's request.
2. A deadline an agent finds is always a proposal: a decision card in the conversation with **Set deadline** and **No deadline**. Setting a date yourself answers that card.
3. The line above the deadline shows the next step, for example **Waiting on customer · 1 item missing · 1 to confirm**. Hover it to see which items are missing.
4. Within the near window the card shows **Due in 3 days**; after the date it shows **2 days overdue** and the folder counts it as overdue. The stage check-up comes earlier near the deadline and daily once it has passed. Deadlines also show on [Agenda](/docs/ai/agenda).
5. **Clear deadline** removes the date.

## Move a new request to its own conversation

When a customer raises something new in an old thread, the new request gets its own conversation so each one keeps one label.

1. Hover the message where the new request starts and choose **Move to**.
2. Keep **New conversation**, pick the **Label for the new conversation** or **Decide later**, then **Move**. **Existing conversation** moves the messages to a conversation you search for instead.
3. That message and everything after it move into a new conversation with the same contact and channel. Both timelines show the link, and later replies on the same email thread or chat land in the new conversation.
4. Agents follow the conversation's Autonomy: on **Autonomous** they move it on their own, on **Assisted** they propose the move as a decision, on **Manual** they leave it to you.
5. Two conversations about the same request: choose **Merge into...** in the header menu. Every message moves; this conversation closes and points to the other one.

## Let an agent propose labels

Agents propose labels as one plan you approve once; each line says where the label goes.

1. Ask an agent to propose labels, or choose **Suggest labels** on a Grid node in [Workforce](/docs/getting-started/team).
2. The card lists each label with **new** or **existing**, how many conversations it covers, and where it lands: on the conversations, **on company** (every conversation from that company shows it), or **rule on** a sender or domain (the next mail is labelled on its own).
3. Tick the lines you want and choose **Approve selected**, or **Approve all**. Nothing changes before that.
4. Agents reuse existing labels first and keep one idea per label: a supplier goes on the company, the kind of work (for example `facturen`) is the label. They do not invent a label per invoice or per document type, and the platform refuses names that join a company and a topic.
5. On their own, agents only attach labels that already exist. A request that fits none of them shows up under **What we missed**.

## Merge two labels

Two labels that mean the same thing become one. Everything that carried the spare label moves.

1. Open **Settings**, then **Labels**.
2. On the spare label, choose **Merge**. Flow labels have no merge: that name is the flow's title.
3. Choose the label to keep and confirm. Conversations, contacts, companies, folders and inbox rules that used the spare label now use the one you kept. The spare name is removed.
4. Ask an agent the same thing. It proposes **Merge labels** and waits for approval. Deleting a label does not do this: delete takes the label off everything instead of moving the items. An agent can also rename a label: the new name replaces the old one everywhere, and that too waits for approval. Renaming a flow label renames its flow.

## Turn a missed pattern into a label with a flow

1. Open **Settings**, then **Labels**, and read **What we missed**. It lists requests that kept arriving without a matching label, with how often each was seen.
2. Set **Offer a new label with a flow after** to how many sightings you want before a pattern shows as ready.
3. Choose **Attach a flow** to create it with the suggested tag and description, or **Not a flow** to drop it. Agents never create a label with a flow themselves.

## What to do next

Put the flow's label on a [folder](/docs/ai/folders) filterset so that folder becomes a lane on the flow board; tickets filed in the folder also show under **Flows** on the folder page. Give each stage an owner and a check-up rhythm on [Flows](/docs/ai/flows); due check-ups show on [Agenda](/docs/ai/agenda) and on the ticket panel.
