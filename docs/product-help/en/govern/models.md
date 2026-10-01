---
title: Models
intro: Bokito AI runs your workspace by default on an EU-hosted model. Custom models are an optional escape hatch.
description: Use managed Bokito AI (EU by default), decide whether US-hosted platform models may run, or connect your own provider keys when your workspace is entitled.
keywords: models, llm, providers, byok, api keys, bokito ai, usage, data region, eu, mistral, gdpr
sort: 30
related: govern,agents,integrations
---

# Models

Models live under **Settings**, then **Models**. Bokito AI processes conversations on an EU-hosted model unless you decide otherwise; spend and the EU share show on Cockpit **Usage**.

## Use Bokito AI

![Models settings](/api/docs/assets/models/catalog.png)
*Bokito AI is the default managed intelligence for the workspace.*

1. Open **Settings**, then **Models**. The **Bokito AI** card shows **Active** when the platform key is live.
2. Read the **Chat model** and **Embedding model** lines: each shows the backing model, its provider, and a region badge (**EU** or **US**).
3. Leave agents on Bokito AI unless you need your own keys. Usage is metered for this workspace and counts toward the budget.
4. Open an [agent](/docs/ai/agents) to confirm the model. The picker shows Bokito AI only until custom models are allowed and turned on, and each option carries its region.

## Check where data is processed

![Data region](/api/docs/assets/models/data-region.png)
*The Data region card shows the EU share of the last 30 days and whether US-hosted platform models may run.*

1. Open **Settings**, then **Models**, and scroll to **Data region**.
2. The percentage shows how many live tokens of the last 30 days ran on EU-hosted models. Knowledge embeddings still run on a US-hosted model; an EU alternative follows with a re-indexing step.
3. If the Bokito AI card shows an amber notice, the EU-hosted model is temporarily unavailable and Bokito AI runs on a fallback in the US. Bokito switches back automatically; nothing is hidden.
4. For the per-region token split, open the [Cockpit](/docs/getting-started/cockpit) **Usage** page and read **By data region**.

## Allow US-hosted platform models

1. Open **Settings**, then **Models**, then **Data region**. The switch **Allow US-hosted platform models** is off by default.
2. While it is off, an agent that points at a US-hosted platform model (Anthropic, OpenAI) runs on Bokito AI instead. The card lists those models under **US-hosted models selected by active agents**.
3. Turn the switch on only when your data processing agreement covers US transfers. Owners and admins can change it; the change is recorded.
4. Your own provider keys are never redirected: a BYOK model runs where its provider runs and shows that region.

## Add a custom model (when entitled)

1. Custom models appear only when both the platform feature and your workspace entitlement are on. Otherwise you see a short **Own keys on request** note.
2. Turn on **Use my own models**, then choose **Add model**. Pick a provider (**Mistral (EU)**, **Anthropic (US)**, **OpenAI (US)**, or **OpenAI-compatible**), paste an **API key**, and **Save and test**.
3. Choose a preset model or enter a custom model id, then save. Your models appear in agent pickers with their region badge and are billed by the provider. Bokito AI stays as fallback when you turn custom models off or remove them.

## When AI runs without a live key

1. Open **Settings**, then **Models**. If Bokito AI shows **Not configured**, calls run in mock mode.
2. A workspace banner explains that replies are placeholders and are not sent to customers. Timeline labels those bubbles as placeholders, never **Sent to the customer**.
3. Contact Bokito support (or enable custom models with your own key when entitled) before choosing **Autonomous** on [Govern](/docs/govern/autonomy).

## Spend does not bypass approval

Token budgets sit on Cockpit **Usage** (daily token cap and monthly spend cap) and on projects. When the workspace budget is exhausted, platform-key calls pause; your own keys keep working. [Govern](/docs/govern/govern) still decides whether an agent may act.

## What to do next

Confirm Bokito AI is Active and EU, then watch **Usage** on the [Cockpit](/docs/getting-started/cockpit).
