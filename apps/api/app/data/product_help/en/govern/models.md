---
title: Models
intro: Choose Maki, Bokito AI or Kong for agents. Add your own models when your plan includes them.
description: Use managed Bokito models as the workspace default, or connect your own provider keys when your workspace is entitled.
keywords: models, llm, providers, byok, api keys, bokito ai, maki, kong, usage
sort: 30
related: govern,agents,integrations
---

# Models

Models live under **Settings**, then **Models**. The page shows three managed models and, when entitled, a list of models you can add with your own keys. Spend shows on Cockpit **Usage**.

## Use managed models

![Models settings](/api/docs/assets/models/catalog.png)
*Managed models are the default for the workspace.*

1. Open **Settings**, then **Models**. The managed models block shows **Active** when the platform is live.
2. Three models are always available. Each card shows the list price per 1 million tokens (input and output):
   - **Maki** — lighter, good for everyday tasks. Uses fewer tokens, so it costs less.
   - **Bokito AI** — standard and balanced. Default for new agents.
   - **Kong** — heavier, for long or complex work. Uses more tokens.
3. Open an [agent](/docs/ai/agents) and pick the model. The picker lists these three until custom models are allowed and turned on.

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

Confirm managed models are Active, pick a tier per agent, then watch **Usage** on the [Cockpit](/docs/getting-started/cockpit).
