---
title: Set Autonomy
intro: One dial for the whole workspace decides how far agents may go on their own. Channels, agents and flows stay at or below it.
description: Set the one Autonomy dial on Govern (Manual, Assisted, Autonomous), see what may sit below it, and set tool permissions separately.
keywords: autonomy, dial, ceiling, posture, manual, assisted, autonomous, always review, tool permissions, apply modes, auto-review, prompt injection, hidden instructions
sort: 20
related: govern,agents,inbox-ai,flows
---

# Set Autonomy

Autonomy is one dial on [Govern](/docs/govern/govern): **Manual**, **Assisted** or **Autonomous**. Every channel, conversation, agent and flow stays at or below it, so the dial is the most any part of the workspace may do on its own.

## Turn the dial

![The Autonomy dial on Govern](/api/docs/assets/autonomy/dial.png)
*Three positions. The current one carries a badge.*

1. Open **Settings**, then **Govern**, then **Policy**. The first card is **Autonomy**.
2. Pick **Manual** (agents read and prepare, a person does the rest), **Assisted** (agents draft replies and propose actions, a person sends) or **Autonomous** (agents answer and act on their own within tool permissions).
3. Choosing **Autonomous** first asks **Turn on Autonomous?** Only an owner or admin can change the dial; others see **Only an owner or admin can change the dial.**
4. The dial saves as you pick it.

## What may sit below the dial

1. A channel or a single open conversation can be set lower. These show under **Per channel** on the same page; choose **Follow the default again** to remove one. See [Autonomy](/docs/inbox/inbox-ai).
2. Each agent has its own level (see [Agents](/docs/ai/agents)). A conversation that agent handles never goes higher.
3. A flow with **Always review** keeps every reply on its tickets at Assisted. See [Flows](/docs/ai/flows).
4. **Privacy** that keeps AI away from message bodies sets everything to Manual, and a tripped circuit breaker keeps a channel at Assisted until someone resumes it.

Hover the mode in a conversation header to see which of these decided.

## Set tool permissions

Tool permissions are separate from the dial: they say what tools may change without waiting for you, not how far agents reply to customers.

1. On the same page, open **Default tool permissions**.
2. Pick a preset for workspace and structure tools, or set each category to **Deny**, **Ask first** or **Allow**.
3. **Ask first** creates a [decision](/docs/ai/decisions) card in the thread. Messaging on **Ask first** or **Deny** also stops customer replies from going out on their own; no preset lets a conversation go further than the dial.

## Let auto-review look first

Auto-review is a second AI check on an action that would otherwise wait for your approval.

1. On the same page, find the **Auto-review** card.
2. Pick **Off** (every gated action asks a person), **Shadow** (every gated action still asks; the card shows what auto-review would have done) or **Enforce**.
3. In **Enforce**, auto-review stops actions it judges wrong and runs routine ones when it is at least 80% sure. Consequential actions, such as sending to a customer, always still ask. So does any turn that read a message with possible hidden instructions.
4. Write what the reviewer should watch for under **Review instructions** and choose **Save instructions**.
5. The card shows how often people agreed with auto-review over the last 30 days. Start on **Shadow** and switch to **Enforce** once that number is high.

## Hidden instructions in messages

Customer messages, web pages and tool results can contain text written to steer the AI, such as "ignore your previous instructions".

1. Agents always treat that content as data, never as instructions.
2. A message that reads like an instruction to the AI shows a **Possible hidden instructions** badge in the conversation.
3. While an agent works on such content, every gated action asks a person first, whatever the dial and auto-review say.

## Start conservative

1. Start the dial on **Assisted** while you learn how the workspace behaves.
2. Watch which drafts go out unedited. Bokito suggests Autonomous once at least 80% of 50 or more drafts are sent unchanged.
3. Put flows that must always be checked on **Always review** before you raise the dial.

Website visitors never change the workspace on their own, whatever the dial says.

## What to do next

Set safeguards and handovers under [Autonomy](/docs/inbox/inbox-ai). Lock tools on [Govern](/docs/govern/govern).
