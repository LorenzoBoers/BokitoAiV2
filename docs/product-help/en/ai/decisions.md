---
title: Approve and decline decisions
intro: Agents ask inside the thread when a step needs your judgment. Every open approval stays on the conversation that raised it.
description: Approve, edit or decline decision cards in the thread, from the Needs decision filter, Cockpit, or a notification.
keywords: decisions, approvals, decision requests, notifications, human in the loop
sort: 20
related: communication,agent-runs,autonomy,govern
---

# Approve and decline decisions

A decision request is a message in the thread, and that is the only place you answer it. There is no separate Decisions inbox: to see every conversation with an open card — customer and internal together — open **Filters** on the Communication list and choose **Needs decision**.

Automated mail (receipts, newsletters, no-reply senders) does not raise decisions. The agent notes those quietly on the thread. If tip cards piled up from earlier mail, open [Agents](/docs/ai/agents) and use **Clear tip cards**.

## Find a waiting decision

![A waiting decision in the thread](/api/docs/assets/decisions/approve.png)
*Open the thread from the Needs decision filter, Cockpit, or a notification.*

1. Open **Communication**, then **Filters** → **Needs decision**, or open Cockpit **Awaiting decision** / **Needs attention**. Both land on the same list. A **Needs decision** badge marks the rows.
2. Select a thread and scroll to the decision card. It shows the proposed action and why the agent stopped.
3. The bell menu in the top bar points at the same card.

## Approve, edit or decline

1. Read the proposal in context of the conversation.
2. Cards use the action they need: **Approve**, **Reject**, **Edit**, **Escalate**, **Defer**, **Later**, **Close thread**, **Create task** or **Keep open**. Suggested-reply cards from [Inbox AI](/docs/inbox/inbox-ai) use **Send**, **Edit** or **Escalate**.
3. Under agent messages, small icons mark **Looks right** or **Not helpful**, and the speech-bubble icon (**Correct this**) teaches the agent — hover an icon to see its label. Escalate pauses AI on the thread and assigns you.

## Answer from a notification

1. Choose the decision in the bell menu, or open the push notification on your phone. Both open the thread and jump straight to the waiting card.
2. Read the card's source line: it names where the request came from — a project queue item, an agent run, or a proposed workspace change — and links to it.
3. Answer in the thread. Inbox AI suggestions still need a human send unless autonomy allows more.
4. Turn notifications per event on or off under **Settings**, then **Notifications**.

## When agents ask

Workspace [autonomy posture](/docs/govern/autonomy) sets the default. On [Govern](/docs/govern/govern) **Policy**, each tool category is **Deny**, **Ask first** or **Allow**. **Ask first** creates the card you see in the thread. Per-agent overrides on the agent page win over the category.

Start with **Assisted**. Move steps you always approve toward **Allow**. Keep **Ask first** for the risky ones.

## What to do next

Structural workspace edits wait on Govern **Pending reviews**, not in the thread. Audit later under Govern **Recent audit**.
