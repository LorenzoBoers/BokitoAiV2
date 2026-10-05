---
title: Models
intro: Bokito AI is the default for your workspace. Add your own models when your plan includes them.
description: Use managed Bokito AI as the fixed default, or connect your own provider keys when your workspace is entitled.
keywords: models, llm, providers, byok, api keys, bokito ai, usage
sort: 30
related: govern,agents,integrations
---

# Models

Models live under **Settings**, then **Models**. The page shows a **Bokito AI** banner and a list of models you can add or remove. Spend shows on Cockpit **Usage**.

## Use Bokito AI

![Models settings](/api/docs/assets/models/catalog.png)
*Bokito AI is the default for the workspace.*

1. Open **Settings**, then **Models**. The **Bokito AI** banner shows **Active** when the platform is live.
2. Leave agents on Bokito AI unless you need your own keys. Bokito AI is the default whenever you have not set another model.
3. Open an [agent](/docs/ai/agents) to confirm the model. The picker shows Bokito AI only until custom models are allowed and turned on.

## Add a model (when entitled)

1. Custom models appear only when both the platform feature and your workspace entitlement are on. Otherwise you see a short **Own keys on request** note.
2. Turn on **Use my own models**, then choose **Add model**. Pick a provider (or **Custom (OpenAI-compatible)** with a base URL), paste an **API key**, and **Save and test**.
3. Choose a preset model or enter a custom model id, then save. Your models appear in the list and in agent pickers. They are billed by the provider. Bokito AI stays as fallback when you turn custom models off or remove them.

## When AI runs without a live key

1. Open **Settings**, then **Models**. If Bokito AI shows **Not configured**, calls run in mock mode.
2. A workspace banner explains that replies are placeholders and are not sent to customers. Timeline labels those bubbles as placeholders, never **Sent to the customer**.
3. Contact Bokito support (or enable custom models with your own key when entitled) before choosing **Autonomous** on [Govern](/docs/govern/autonomy).

## Spend does not bypass approval

Token budgets sit on Cockpit **Usage** (daily token cap and monthly spend cap) and on projects. When the workspace budget is exhausted, platform-key calls pause; your own keys keep working. [Govern](/docs/govern/govern) still decides whether an agent may act.

## What to do next

Confirm Bokito AI is Active, then watch **Usage** on the [Cockpit](/docs/getting-started/cockpit).
