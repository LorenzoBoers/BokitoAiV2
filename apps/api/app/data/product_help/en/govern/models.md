---
title: Choose models
intro: Pick which language and embedding models this workspace may use.
description: Choose which AI models power your workspace and connect your own provider keys.
keywords: models, llm, providers, byok, api keys, usage
sort: 30
related: govern,agents,integrations
---

# Choose models

Providers and models live under **Settings**, then **Providers & models**. Spend still shows on Cockpit **Usage**.

## Enable a workspace model

![Models settings](/api/docs/assets/models/catalog.png)
*Enable the chat and embedding models this workspace needs.*

1. Open **Settings**, then **Providers & models**. The **Bokito AI** card is **Active** by default: Bokito picks chat and embedding models. Usage counts toward the workspace budget.
2. Enable extra chat and embedding models this workspace needs. On a provider you added, use **Enable presets** (confirm first) or add a custom model. Filter the list, copy a model id, and read **Low cost** / **Medium cost** / **High cost** (hover for per-million prices).
3. Open an [agent](/docs/ai/agents) and confirm or override the model. The agent page links **Open Providers & models**.

## Add your own key

1. Stay on Providers & models. Under **Your own providers**, choose **Add provider**.
2. Pick a **Provider type**, paste an **API key** (show or hide it), and optional **Label** or **Base URL** (for OpenAI-compatible endpoints). Press Enter or **Save provider**, then **Test**. A working key shows **Connection OK** in green and **Key set ····** plus the last four characters. **Remove** asks for confirmation.
3. Models on your keys take precedence over Bokito AI; the Bokito AI card then shows **Standby**. The provider bills those calls. Remove the keys and Bokito AI becomes the fallback again.

## Spend does not bypass approval

Token budgets sit on Cockpit **Usage** (daily token cap and monthly spend cap) and on projects. When the workspace budget is exhausted, platform-key calls pause; your own keys keep working. [Govern](/docs/govern/govern) still decides whether an agent may act.

## What to do next

Confirm a chat model is enabled, then watch **Usage** on the [Cockpit](/docs/getting-started/cockpit).
