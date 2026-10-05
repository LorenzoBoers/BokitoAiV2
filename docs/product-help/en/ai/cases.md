---
title: Categories and tickets
intro: Every conversation has one category that says what it is about. A category served by a playbook turns the conversation into a ticket with stages.
description: Set up categories under Signal types, bind them to a playbook to get tickets with stages, confirm what the AI read, and split a conversation when a second request shows up.
keywords: categories, tickets, stages, signals, signal types, intake, playbook, split conversation, cases
sort: 46
related: workstreams,communication,widget,projects,integrations
---

# Categories and tickets

A category says what a conversation is about, and each conversation has exactly one. Manage the list under **Settings** → **Signal types**; every inbound message is read against it before any reply is drafted, so recognition also runs when AI replies are paused.

Each category has an outcome. **Label only** stamps the conversation for filtering and reporting. **Ticket** binds the category to a playbook: the conversation becomes a ticket that moves through that playbook's stages, and each stage counts as open, waiting or done. A certain read sets the category straight away, an unsure read becomes a confirm chip on the conversation, and a message that matches nothing is counted under **What we missed**.

## Add a category

1. Open **Settings**, then **Signal types**.
2. Choose **New type**. Under **What it is**, enter a **Name** (for example Refund request) and describe when it applies, and when it does not. Agents read that text to classify.
3. Under **What we do**, pick **Label only** or **Ticket**. For a ticket, pick the **Playbook** and an optional **Project**. Turn on **Start the playbook right away** when every new ticket should start a run.
4. Under **How it gets filed**, set **When the AI recognizes it** to **Ask customer**, **Ask operator**, **Auto** or **Manual only**, and set **Audience**.
5. Choose **Add type**. Deleting a category that conversations already use archives it instead, so history stays intact.

## Set the stages of a ticket

1. Open the playbook a ticket category is bound to.
2. In the **Ticket stages** card, add a stage per step (for example New, Waiting for parts, Fixed) and set its **Stage kind** to open, waiting or done. Keep at least one done stage.
3. On a playbook step, pick a **Stage** so the ticket moves there when that step starts, or keep **Keep stage**.
4. The ticket's status always follows the kind of its stage, so the queue and project boards stay correct without extra bookkeeping. See [Playbooks](/docs/ai/workstreams).

## Confirm or change the category on a conversation

1. Open a conversation in **Communication**. The side panel shows the category under **This conversation**; the list row shows it as a small chip, with the stage and a colored dot for tickets.
2. An unsure read shows "Looks like Billing question — confirm?". Choose **Confirm** to accept it or **Dismiss** when it is wrong. Nothing routes and no playbook starts before you confirm.
3. Choose **Change category** to pick another one. For a ticket, open the stage menu to move it to another stage. Every change shows in the timeline, for example **Ticket moved to Waiting for parts**.
4. The category also sits first, with a lock, in the **Tags** row. Tags are free labels on top of the category; see [Communication](/docs/inbox/communication).

## Split off a new request

When a customer raises something new in an old thread, the new request gets its own conversation so each one keeps one category.

1. Hover the message where the new request starts and choose **Split from here**.
2. Pick the **Category for the new conversation**, or **Decide later**, then **Split**.
3. That message and everything after it move into a new conversation with the same contact and channel. Both timelines show the link, and later replies on the same email thread or chat land in the new conversation.
4. Agents follow the conversation's AI handling: on **Autonomous** they split on their own, on **Assisted** they propose the split as a decision, on **Manual** they leave it to you.

## Open a ticket from website chat

1. A visitor describes something broken in the [website widget](/docs/inbox/widget). The agent recognizes **Storing** (Bug report) with a certainty score.
2. If the category asks the visitor, the agent confirms first. If it asks the team, you get a confirm chip in Communication.
3. Once accepted, the ticket starts in the first stage of its playbook and shows on the project board when the category has a project.

## Turn a missed pattern into a category

1. Open **Settings**, then **Signal types**, and read **What we missed**. It lists requests that kept arriving without a matching category, with how often each was seen.
2. Set **Offer a new type after** to how many sightings you want before a pattern shows as ready.
3. Choose **Make it a type** to create it with the suggested name and description, or **Not a type** to drop it. Agents never create a category themselves.
4. Under **Who may accept signals**, choose **Owners and admins only** or **Anyone in the workspace**.

## What to do next

Save a filter on category and stage as a folder in [Communication](/docs/inbox/communication). Set the **Signals** posture on [Govern](/docs/govern/govern) if agents should stop filing categories.
