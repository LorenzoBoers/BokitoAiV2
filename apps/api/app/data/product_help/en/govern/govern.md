---
title: How Govern works
intro: Structural change and risk live here. Day-to-day replies stay in Communication.
description: Review pending platform changes, set policy sliders, undo applied edits, and read the audit log in Govern.
keywords: govern, pending reviews, policy, audit, undo, allowances
sort: 10
related: autonomy,agents,decisions
---

# How Govern works

Govern has two sections: **Ledger** records workspace changes and audit events, while **Autonomy** controls what agents may do. Open **Settings**, then **Govern**. Message-level choices stay in the thread.

## Review a platform change

![Govern draft queue](/api/docs/assets/govern/drafts.png)
*Structural drafts wait here. Message decisions stay in the thread.*

1. Under **Ledger**, open **Pending reviews**.
2. Read what the agent wants to change. Choose **View changes** for the diff.
3. **Accept** asks **Apply this change to your workspace?** **Reject** asks **Reject this change?** Customer decisions stay in [Communication](/docs/inbox/communication).

## Set posture and allowances

![Govern policy](/api/docs/assets/govern/posture.png)
*Pick Manual, Assisted or Autonomous, then fine-tune categories.*

1. Under **Autonomy**, open **Policy**. The card is **How much agents can do**.
2. Pick **Manual**, **Assisted** or **Autonomous**. See [Autonomy](/docs/govern/autonomy).
3. Under **Allowance sliders**, set each category to **Deny**, **Ask first** or **Allow**. Override one tool when the category is too broad.
4. Categories include Messaging, Workspace, Agents, Channels, Triggers, Integrations, Govern and Handoff. External visitor sessions never auto-mutate.
5. When learning sees many escalated tool gates or rejected tool decisions on a category that was **Allow**, Bokito can tighten that slider to **Ask first** automatically. A short note appears under the sliders. Loosening a slider stays a manual edit here.
6. Under **Type and playbook autonomy**, set each active Signal type and playbook to **Manual**, **Ask first**, or **Automatic**.

Per-agent overrides live on the agent page under Tools and permissions.

## Undo and audit

1. Under **Ledger**, **Version history** lists accepted changes. **Undo** is available for 30 days and applies a compensating change; the original ledger entry remains.
2. **Agent access** is a roster of what each agent may do. Choose **Open agent** to change it.
3. **Recent audit** is the event log. Rows offer **Open thread**, **Open run** or **Open agent**.

## What to do next

Read [Autonomy](/docs/govern/autonomy), then open [Agents](/docs/ai/agents) to see who inherits the rules.
