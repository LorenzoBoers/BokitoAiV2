---
title: Approve and decline decisions
intro: Agents ask inside the thread when a step needs your judgment.
description: Approve, edit or decline decision cards in the thread, from Cockpit, or from Slack when it is connected.
keywords: decisions, approvals, decision requests, slack, human in the loop
sort: 20
related: communication,agent-runs,autonomy,govern
---

# Approve and decline decisions

A decision request is a message in the thread, not a separate queue. Open Communication or Agent runs when something is waiting on you.

## Find a waiting decision

![A waiting decision in the thread](/api/docs/assets/decisions/approve.png)
*Open the thread from Communication, Agent runs or Cockpit.*

1. Open the thread from Communication, [Agent runs](/docs/inbox/agent-runs) **Decisions**, or Cockpit **Awaiting decision**.
2. Scroll to the decision card. It shows the proposed action and why the agent stopped.
3. The bell menu in the top bar points at the same card.

## Approve, edit or decline

1. Read the proposal in context of the conversation.
2. Cards use the action they need: **Approve**, **Reject**, **Edit**, **Escalate**, **Defer**, **Later**, **Close thread**, **Create task** or **Keep open**. Suggested-reply cards from [Inbox AI](/docs/inbox/inbox-ai) use **Send**, **Edit** or **Escalate**.
3. On agent messages you can mark **Looks right** or **Not helpful**, or choose **Correct this** to teach the agent. Escalate pauses AI on the thread and assigns you.

## Answer from Slack

1. Connect Slack under **Settings**, then **Email & messages**. See [Channels](/docs/inbox/channels). Decision cards can arrive there with **Approve** and **Deny**.
2. Use those buttons when you are not in Bokito. The thread in Communication updates the same way.
3. Inbox AI suggestions still need a human send unless autonomy allows more.

## When agents ask

Workspace [autonomy posture](/docs/govern/autonomy) sets the default. On [Govern](/docs/govern/govern) **Policy**, each tool category is **Deny**, **Ask first** or **Allow**. **Ask first** creates the card you see in the thread. Per-agent overrides on the agent page win over the category.

Start with **Assisted**. Move steps you always approve toward **Allow**. Keep **Ask first** for the risky ones.

## What to do next

Structural workspace edits wait on Govern **Pending reviews**, not in the thread. Audit later under Govern **Recent audit**.
