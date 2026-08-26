---
title: Approve and decline decisions
intro: Agents ask for approval inside the thread when a step needs your judgment.
description: How decision requests work in Bokito: where they appear, how to approve or decline, and how apply modes and autonomy posture decide when agents ask.
keywords: decisions, approvals, decision requests, apply modes, human in the loop
sort: 20
related: autonomy,govern,communication
---

# Approve and decline decisions

When an agent reaches a step it should not take alone - sending a sensitive reply, changing configuration, spending money - it posts a decision request. You approve or decline, and the agent continues.

## Where decisions appear

Decision requests are messages inside the thread they belong to, not a separate queue to police. You see the agent's reasoning, the proposed action and the surrounding conversation in one place. Pending decisions also surface on the Cockpit and in notifications so nothing waits unseen.

## Approving and declining

Open the request, read the proposal and choose approve or decline. Approving lets the agent execute immediately. Declining stops the action; add a short note so the agent (and your colleagues) know why. Declines feed back into how agents behave, so a reason is worth the ten seconds.

## When agents ask

Two settings control this:

- **Apply mode** per resource: `draft` (agent prepares, never applies), `decision` (agent asks first), or `yolo` (agent applies directly).
- **Autonomy posture** for the workspace: `manual`, `assisted` or `autonomous`. The posture sets the default; per-resource overrides in Govern win over the posture.

In practice: start with `assisted`, watch which requests you always approve, then move those to `yolo` and keep decisions for the genuinely risky steps.

## Reviewing afterwards

Every decision - who asked, who answered, what happened - is recorded in Govern under audit. Structural changes (an agent editing configuration) also appear as platform changes you can review and roll back.
