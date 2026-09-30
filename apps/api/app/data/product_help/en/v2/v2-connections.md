---
title: Connections and modules in V2
intro: Channels, models, tools and modules the workspace is connected to, each with its own disclosure switch.
description: Connect email, WhatsApp and website chat in V2, bring your own model key, add an MCP server, a coding workbench or a business integration, and install the accounting module with Moneybird.
keywords: v2, connections, channels, email, whatsapp, widget, model provider, byok, mcp server, workbench, cursor, integration, moneybird, modules
sort: 60
related: v2-communication,v2-govern,v2-developers
---

# Connections and modules in V2

**Connections** lists where customers write to you, which models answer, and which tools and systems agents may call. **Modules** on the same page add Signal types, playbooks and tools for one line of work; they never add a screen.

## Connect a channel

Each channel carries its own AI disclosure switch and the agent that owns its threads.

1. Open **Connections**. Under **Channels** press **Add Email**, **Add WhatsApp** or **Add Website chat**.
2. Give it a **Name**, choose a **Provider** and fill in the **Address** and credentials the provider asks for.
3. Pick the **Agent** that owns new threads on this channel.
4. Keep **AI disclosure on outbound** on unless a lawyer told you otherwise. AI-written replies get the disclosure line from **Govern**.
5. Press **Verify**. Email and WhatsApp show the **Webhook URL** to register at the provider; website chat shows the **Embed** snippet for your site.

## Bring your own model key

Without a key the EU managed model is used and metered per call.

1. Under **Models** press **Add Model provider**.
2. Pick the **Provider**, paste the key and set the **Region**.
3. Press **Verify**. Agents with an empty **Model** switch to the workspace default; pick this provider per agent under **Work**, **Agents** when needed.
4. Check the **EU share** under **Govern**, **Usage** after a day.

## Add a tool source

Under **Tools and integrations** three kinds exist.

- **MCP server**: an external MCP server whose tools agents may call under your policy.
- **Workbench**: a coding agent service. With a Cursor API key, an agent hands a repository task to Cursor cloud agents; progress and the pull request come back into the originating thread.
- **Integration**: a business system, for example Moneybird. Used by modules.

1. Press **Add Workbench**, name it, choose provider **cursor** and paste the API key.
2. Press **Verify**. The **Webhook URL** shown is registered automatically with each job.
3. In any thread, **Ask agent** to hand work to the workbench, for example: *Fix the typo on the pricing page in repo acme/site and open a PR.*
4. Follow the job under **Work**, **Runs**; the finished run links the pull request.

## Install the accounting module

The first module connects Moneybird and adds the Signal types **Invoice question** and **Payment reminder**, two playbooks and three tools.

1. Under **Tools and integrations** press **Add Integration**, provider **moneybird**, and paste the API token and administration id. Press **Verify**.
2. Under **Modules** the card **Accounting (Moneybird)** shows **Available**. Press **Install**.
3. Pick the **Connection** and set **reminder_days**.
4. Confirm. The summary reads *Accounting (Moneybird) installed: 2 signal types, 2 playbooks.*
5. The tools `moneybird_find_contact` and `moneybird_list_invoices` now work for agents; `moneybird_send_invoice` is on **Always ask** and raises a decision in the thread. Press **Uninstall** to disable the types and playbooks again; history stays.

## What to do next

- Set what agents may do with the new tools: [/docs/v2/v2-govern](/docs/v2/v2-govern)
- Call the same tools from Cursor or a script: [/docs/v2/v2-developers](/docs/v2/v2-developers)
