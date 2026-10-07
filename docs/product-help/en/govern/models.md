---
title: Models
intro: Set the workspace Bokito AI default (or Automatic), then pick a mode per agent. Add your own models when your plan includes them.
description: Use Bokito AI models as the workspace default, choose Automatic so Bokito picks a tier, or connect your own provider keys when entitled.
keywords: models, llm, providers, byok, api keys, Bokito, maki, kong, automatic, workspace default, usage
sort: 30
related: govern,agents,integrations
---

# Models

Models live under **Settings**, then **Models**. The page shows **Bokito AI models** (Automatic plus Maki, Bokito and Kong) and, when entitled, models you add with your own keys. Spend shows on Cockpit **Usage**.

## Set the workspace Bokito AI default

![Models settings](/api/docs/assets/models/catalog.png)
*Bokito AI models — click a card to set the workspace default.*

1. Open **Settings**, then **Models**. The **Bokito AI models** block shows **Active** when the platform is live.
2. Click one card to set the **Workspace default**:
   - **Automatic** — Bokito picks Maki, Bokito or Kong per action from the task.
   - **Maki** — lighter, good for everyday tasks. Uses fewer tokens, so it costs less. Larger context window for long threads.
   - **Bokito** — standard and balanced for most agent work.
   - **Kong** — heavier, for long or complex work. Uses more tokens.
3. Each model card shows context window (and tools / vision when supported) and the list price per 1 million tokens (input and output). Below the cards: **EU-hosted**, **Always current**, **Never trains on your data**, and **Keeps pace with leading models**.
4. New workspaces start on **Automatic**. Agents set to **Workspace default** fall back to this choice. Agents with their own mode (Automatic or a pinned tier) ignore it.

## Choose a mode on an agent

1. Open an [agent](/docs/ai/agents). Under **Model and runtime**, pick:
   - **Workspace default** — follows **Settings → Models**.
   - **Automatic** — Bokito picks the tier for each action.
   - **Maki**, **Bokito** or **Kong** — always that tier for this agent.
2. Later, a flow stage or Agenda task can force a model for that item; that override beats the agent mode and the workspace default.

## Add a model (when entitled)

1. Custom models appear only when both the platform feature and your workspace entitlement are on. Otherwise you see a short **Own keys on request** note.
2. Turn on **Use my own models**, then choose **Add model**. Pick a provider (or **Custom (OpenAI-compatible)** with a base URL), paste an **API key**, and **Save and test**.
3. Choose a preset model or enter a custom model id, then save. Your models appear in the list and in agent pickers. They are billed by the provider. Managed models stay as fallback when you turn custom models off or remove them.

## When AI runs without a live key

1. Open **Settings**, then **Models**. If a managed model shows **Not configured**, calls for that tier may run in mock mode.
2. A workspace banner explains that replies are placeholders and are not sent to customers. Timeline labels those bubbles as placeholders, never **Sent to the customer**.
3. Contact Bokito support (or enable custom models with your own key when entitled) before choosing **Autonomous** on [Govern](/docs/govern/autonomy).

## Spend does not bypass approval

Token budgets sit on Cockpit **Usage** (daily token cap and monthly spend cap) and on projects. When the workspace budget is exhausted, platform-key calls pause; your own keys keep working. [Govern](/docs/govern/govern) still decides whether an agent may act.

## When the provider refuses

When a model provider rejects calls for the whole workspace (out of credits, invalid key, rate limit), Bokito stops hammering it instead of failing every mail and wake one by one.

1. The first refused run is recorded as **Failed** with the provider's reason in its result, and an alert lands in Communication.
2. The workspace pauses AI calls for one hour. New mail in that hour is marked **deferred** on the thread and queued; scheduled wakes report **blocked** and move to their next time.
3. Fix the cause: top up credits or replace the key under **Models**. The next successful run clears the pause and processes the queued conversations in order.
4. Failed runs always show their reason under **Runs**, so an empty result is never silent.

## What to do next

Set the workspace default on **Bokito AI models**, choose a mode per [agent](/docs/ai/agents), then watch **Usage** on the [Cockpit](/docs/getting-started/cockpit).
