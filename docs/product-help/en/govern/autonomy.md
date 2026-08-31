---
title: Set autonomy posture
intro: Dial how much agents may do on their own, from full oversight to exception-only review.
description: Dial how independently agents work with the autonomy posture: manual, assisted or autonomous.
keywords: autonomy, posture, manual, assisted, autonomous, apply modes
sort: 20
related: govern,agents,inbox-ai
---

# Set autonomy posture

Autonomy posture is the workspace trust dial. It lives on [Govern](/docs/govern/govern). Pick a preset, then override individual tools when needed.

## Pick a preset

![Autonomy posture presets](/api/docs/assets/autonomy/presets.png)
*The preset lives on Govern.*

1. Open **Settings**, then **Govern**, then **Policy**. The card is **How much agents can do**.
2. Choose **Manual** (agents draft, you apply), **Assisted** (low-risk actions go through, the rest asks), or **Autonomous** (agents act within allowances).
3. The setting saves as you pick it. Per-resource overrides on the same page still win.

## Tune the sliders after the preset

1. Stay on Govern, then **Policy**.
2. Under **Allowance sliders**, set each category to **Deny**, **Ask first** or **Allow**. Messaging, Integrations and Handoff are the ones operators change first.
3. Override one tool when the category is too broad. Per-agent overrides on the agent page still win.
4. **Ask first** is what creates a [decision](/docs/ai/decisions) card in the thread.

## Start conservative

1. Use **Manual** or **Assisted** while you learn how the workspace behaves.
2. Watch which decisions you always approve.
3. Widen one tool category instead of jumping to **Autonomous**.

## External sessions stay safe

Website visitors never auto-mutate the workspace, regardless of posture. [Inbox AI](/docs/inbox/inbox-ai) still decides when a customer draft appears.

## One dial also bounds channel AI

The per-channel AI mode (suggest, auto, off) is a view over the Messaging allowance, so channels can never do more than Govern allows.

1. When Messaging is on **Ask first**, channels set to **Auto** behave as **Suggest**: replies wait for approval.
2. When Messaging is on **Deny**, AI is off on every channel.
3. When Messaging is on **Allow**, each channel's own mode applies.

## What to do next

Lock tools on [Govern](/docs/govern/govern). Confirm each [agent](/docs/ai/agents) inherited the posture.
