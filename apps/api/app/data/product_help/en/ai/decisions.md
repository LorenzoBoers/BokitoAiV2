---
title: Approve and decline decisions
intro: Agents ask inside the thread when a step needs your judgment. Every open approval lives in Communication under Decisions.
description: Approve, edit or decline decision cards in the thread, from the Decisions folder, Cockpit, or a notification.
keywords: decisions, approvals, decision requests, notifications, human in the loop
sort: 20
related: communication,agent-runs,autonomy,govern
---

# Approve and decline decisions

A decision request is a message in the thread, and that is the only place you answer it. To see every conversation with an open card — customer and internal together — open **Decisions** in the Communication sidebar.

Automated mail (receipts, newsletters, no-reply senders) does not raise decisions. The agent notes those quietly on the thread. If tip cards piled up from earlier mail, open [Agents](/docs/ai/agents) and use **Clear tip cards**.

## Find a waiting decision

![A waiting decision in the thread](/api/docs/assets/decisions/approve.png)
*Open the thread from Decisions, Cockpit, or a notification.*

1. Open **Communication**, then **Decisions**. Cockpit **Awaiting decision** / **Needs attention** and the bell menu land on the same list. A **Needs decision** badge marks the rows.
2. Select a thread (the first match opens automatically) and scroll to the decision card. It shows the proposed action and why the agent stopped.
3. When nothing waits on you, Decisions shows an empty state with links back to the inbox and Agents.

## Approve, edit or decline

1. Read the proposal in context of the conversation.
2. Cards use the action they need: **Approve**, **Reject**, **Edit**, **Escalate**, **Defer**, **Later**, **Close thread**, **Create task** or **Keep open**. Suggested-reply cards from [AI handling](/docs/inbox/inbox-ai) use **Send**, **Edit** or **Escalate**.
3. Hover an agent message: icons next to the bubble mark **Looks right** or **Not helpful**, and the speech-bubble icon (**Correct this**) teaches the agent. Hover an icon to see its label. Escalate sets the conversation to Manual and assigns you.

## Teach the agent for next time

1. On a card that asks before an action, the row **Next time:** offers three buttons.
2. **You may do this yourself from now on** proposes a rule that lets the agent do this on its own. **Always ask** proposes a rule that keeps asking. Both arrive as a card in the same conversation; confirm it there. Only an owner or admin can confirm a rule that lets an agent act on its own.
3. **Not sure yet** keeps the case as an example. After a few examples the agent proposes a rule from them.
4. Rules show on the agent under **Rules** (see [Agents](/docs/ai/agents)).

## Who gets the question

Each question goes to one addressee: the person or team named in the agent's **Ask questions to**, else the conversation owner, else whoever handed over the work, else the owner team. Someone who is away is skipped. When one person keeps answering questions on the same topic, Govern proposes a routing rule such as *Questions about invoices go to Lisa*; once accepted, those questions go to that person first.

## Answer from a notification

1. Choose the decision in the bell menu, or open the push notification on your phone. Both open Decisions on that thread and jump straight to the waiting card.
2. Read the card's source line: it names where the request came from — a project queue, an agent run, or a proposed workspace change — and links to it.
3. Answer in the thread. Assisted drafts still need a human send; only Autonomous conversations send on their own.
4. Under **Settings**, then **Notifications**, open **Notify me about**. Turn **In-app**, **Email**, **Push** or **Slack** on per row — for example **When an agent needs your decision on an assigned conversation**, **When a customer asks for a human**, **When an agent run or trigger fails**, or budget alerts at 80% / 100%. Use **Pause in-app alerts**, **Restore recommended**, or **Preview a notification** when you are tuning the set. Push applies to this browser only; connect Slack under **Channels** before Slack toggles work.

## When agents ask

Workspace [autonomy posture](/docs/govern/autonomy) sets the default. On [Govern](/docs/govern/govern) **Policy**, each tool category is **Deny**, **Ask first** or **Allow**. **Ask first** creates the card you see in the thread. Per-agent overrides on the agent page win over the category.

Start with **Assisted**. Move steps you always approve toward **Allow**. Keep **Ask first** for the risky ones.

## What to do next

Structural workspace edits wait on Govern **Pending reviews**, not in the thread. Audit later under Govern **Recent audit**.
