---
title: Action tags and tickets
intro: An action tag is a hashtag that starts a ticket flow. Filing it on a conversation turns that conversation into a ticket that moves through the flow's stages.
description: Make a tag an action tag, file a ticket with a project choice from the Tags picker, confirm what the AI proposed, move a ticket through its stages, and split a conversation when a second request shows up.
keywords: action tags, actietags, tickets, hashtags, stages, flow, project, intake, split conversation, categories
sort: 46
related: workstreams,communication,channels,projects,widget
---

# Action tags and tickets

An action tag is a tag with a flow. A conversation carries at most one action tag: filing it makes the conversation a ticket that moves through that flow's stages, on one of the flow's projects or on no project.

When a channel has an **AI agent** linked, that agent reads each inbound message (summary, priority, tags and tickets) in one run. Under **Manual** AI handling the agent still reads and may file tags or tickets, but it does not draft a customer reply. Without a channel agent there is no AI read. A certain read files the ticket, an unsure read becomes a confirm on the conversation, and a request that matches nothing is counted under **What we missed**. Free tags stay next to the action tag for grouping; see [Communication](/docs/inbox/communication).

## Make a tag an action tag

![Action tags settings with one action tag](/api/docs/assets/categories/catalog.png)
*One Tags list: every row looks the same; create or open the flow from the row.*

1. Open **Settings**, then **# Tags**. The page shows one **Tags** list (action tags first, with an accent `#`), then **What we missed** and who may confirm tickets.
2. Choose **New tag** to add a free tag, then **Create flow** on that row. That creates or links a flow titled `#name`. The tag becomes an action tag in the same list.
3. On an action tag, choose **Open flow** to configure stages, filing and projects on the flow page. A new flow starts with Open, Waiting and Done.
4. Use the pin on any tag for a row in the Communication sidebar. Use the AI switch to allow or block triage from auto-tagging with that tag.

## File a ticket on a conversation

![Ticket panel on a conversation](/api/docs/assets/categories/ticket-panel.png)
*The Ticket panel shows the flow, a stage bar, the project and the flow's custom fields.*

1. Open a conversation in **Communication**. Under **This conversation**, choose **Add tags**.
2. Type with a soft `#` and pick an action tag (marked **Action tag**), or a free tag. An unknown name asks whether to add it as a tag or **Make action tag**.
3. When the flow is on one or more projects, pick one of them or **No project**. Filing always asks this; agents choose too, or leave the ticket proposed.
4. The ticket starts in the first stage of the flow. The list row shows the action tag with the stage and a colored dot. Changing to another action tag asks to **Replace** (or split the conversation for a second request).
5. In the composer, `/ticket #name` files the same ticket. When the action tag has projects, Bokito sends you to the **Ticket** panel to choose one.

## Confirm what the AI proposed

1. An unsure read shows on the conversation as "Looks like #complaint" with **Confirm** and **Dismiss**. When the flow has projects, confirming opens the project choice.
2. Nothing routes and no flow starts before someone confirms. Members can always file a ticket themselves; **Who may confirm tickets** on **Settings** → **# Tags** decides who may confirm a proposal.
3. Proposals do not count as filed tickets on Overview until they are confirmed.
4. Set the **Tickets** posture on [Govern](/docs/govern/govern) if agents should stop filing tickets.

## Move a ticket through its stages

1. In the **Ticket** panel, click a segment of the stage bar to move the ticket to that stage; **Stage 2 of 3** shows where it is, followed by the next check-up when the stage has one. On a flow or project board, drag the card to another column instead; see [Projects](/docs/ai/projects).
2. If the target stage has required fields that are still empty, a dialog asks for them. The ticket stays on its current stage until those values are filled. The same dialog appears when you drag a card, or when you close the conversation and choose to move the ticket to its done stage.
3. Every move shows in the timeline, for example **Ticket moved to Waiting**. The ticket's status always follows the kind of its stage: open, waiting or done.
4. Under the project, every custom field of the flow has its own row. Click a value to edit it; it saves when you press Enter, leave the field, or pick an option. A `*` marks a required field and turns orange while it is empty.
5. Admins without fields see **Add custom fields to this flow**, which opens the flow in edit mode. Change the stages and fields there; see [Flows](/docs/ai/workstreams).

## Split off a new request

When a customer raises something new in an old thread, the new request gets its own conversation so each one keeps one action tag.

1. Hover the message where the new request starts and choose **Split from here**.
2. Pick the **Action tag for the new conversation**, or **Decide later**, then **Split**.
3. That message and everything after it move into a new conversation with the same contact and channel. Both timelines show the link, and later replies on the same email thread or chat land in the new conversation.
4. Agents follow the conversation's AI handling: on **Autonomous** they split on their own, on **Assisted** they propose the split as a decision, on **Manual** they leave it to you.

## Turn a missed pattern into an action tag

1. Open **Settings**, then **# Tags**, and read **What we missed**. It lists requests that kept arriving without a matching action tag, with how often each was seen.
2. Set **Offer a new action tag after** to how many sightings you want before a pattern shows as ready.
3. Choose **Make it an action tag** to create it with the suggested tag and description, or **Not an action tag** to drop it. Agents never create an action tag themselves.

## What to do next

Add the flow to a [project](/docs/ai/projects) with **Add flow** on the project page, so its tickets show as a board there. Give each stage an owner and a check-up rhythm on [Flows](/docs/ai/workstreams); due check-ups show on [Agenda](/docs/ai/agenda) and on the ticket panel.
