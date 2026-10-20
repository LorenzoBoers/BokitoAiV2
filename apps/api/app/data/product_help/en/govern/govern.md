---
title: How Govern works
intro: Structural change and risk live here. Day-to-day replies stay in Communication.
description: Review pending platform changes, set policy sliders, undo applied edits, and read the audit log in Govern.
keywords: govern, pending reviews, policy, audit, undo, allowances, rules, routing rules
sort: 10
related: autonomy,agents,decisions
---

# How Govern works

Govern has two sections: **Log** records workspace changes and audit events, while **Autonomy** controls what agents may do. Open **Settings**, then **Govern**. Message-level choices stay in the thread.

## Review a platform change

![Govern draft queue](/api/docs/assets/govern/drafts.png)
*Structural drafts wait here. Message decisions stay in the thread.*

1. Under **Log**, open **Pending reviews**.
2. Read what the agent wants to change. Choose **View changes** for the diff.
3. **Accept** asks **Apply this change to your workspace?** **Reject** asks **Reject this change?** Customer decisions stay in [Communication](/docs/inbox/communication).

## Set posture and allowances

![Govern policy](/api/docs/assets/govern/posture.png)
*The Autonomy dial first, tool permissions below it.*

1. Under **Autonomy**, open **Policy**. The first card is the **Autonomy** dial: **Manual**, **Assisted** or **Autonomous**. See [Autonomy](/docs/govern/autonomy). Safeguards, handovers and language sit right below it; see [Autonomy](/docs/inbox/inbox-ai).
2. Open **Default tool permissions** for what tools may change without waiting for you.
3. Under **Allowance sliders**, set each category to **Deny**, **Ask first** or **Allow**. Override one tool when the category is too broad.
4. Categories include Messaging, Workspace, Agents, Channels, Triggers, Connections, Govern and Handoff. External visitor sessions never auto-mutate. Messaging on **Ask first** or **Deny** also stops customer replies from going out on their own; no slider lets a conversation go further than the dial.
5. When learning sees many escalated tool gates or rejected tool decisions on a category that was **Allow**, Bokito can tighten that slider to **Ask first** automatically. A short note appears under the sliders. Loosening a slider stays a manual edit here.
6. A flow that must always be checked gets **Always review** on its own page; see [Flows](/docs/ai/flows).

Per-agent overrides live on the agent page under Tools and permissions.

## Set rules for all agents

1. Under **Autonomy**, find **Rules for all agents**. Every agent follows these next to its own rules.
2. Add a rule the same way as on an agent: the situation, **What the agent does** and the **Kind of rule**. Choose **Add rule**.
3. Use **Try out** to check an action before you rely on it.
4. Proposed rules (from an agent or from the **Next time:** buttons on a card) and proposed routing rules (*Questions about invoices go to Lisa*) arrive as cards to confirm and are recorded under **Log**.
5. **Per agent: always, ask, never** lists the verdicts given on action cards in conversations, one agent and one action per rule (**Always**, **Ask** or **Never**). An owner or admin's verdict is applied right away and appears here at once; a member's verdict arrives as a draft first. Choose the bin icon to remove a rule so the agent asks again. Anyone can remove an **Always** rule; removing **Ask** or **Never** loosens the agent and needs an owner or admin.

Sending to customers always asks. See [Agents](/docs/ai/agents) for rules on one agent.


## Undo and audit

1. Under **Log**, **Version history** lists accepted changes. **Undo** is available for 30 days and applies a compensating change; the original log entry remains.
2. **Agent access** is a roster of what each agent may do. Choose **Open agent** to change it.
3. **Recent audit** is the event log. Rows offer **Open thread**, **Open run** or **Open agent**.

## What to do next

Read [Autonomy](/docs/govern/autonomy), then open [Agents](/docs/ai/agents) to see who inherits the rules.
