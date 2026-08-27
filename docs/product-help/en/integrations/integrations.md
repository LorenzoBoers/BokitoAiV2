---
title: Connect integrations
intro: Give agents tools outside Bokito — marketplace apps and connected accounts.
description: Use Connected, Marketplace and Connected tools to install apps, finish OAuth, and govern what agents may call.
keywords: integrations, marketplace, connected, github, slack, mcp, modules, accounting, moneybird
sort: 10
related: mcp,models,channels,govern
---

# Connect integrations

Integrations are the tools agents may call. Open **Settings**, then **Integrations**. The page has three tabs: **Connected**, **Marketplace** and **Connected tools**.

## See what is connected

1. Open **Connected**. This is the live list for this workspace.
2. Filter with **All integrations**, **Communication**, **Repository** or **Tools for agents**. The last kind is remembered. Use the search box to filter connections.
3. Choose **Disconnect** when a tool should stop (confirm **Remove this connection?**). Inbox-kind apps also appear as [channels](/docs/inbox/channels). Empty lists offer **Go to Marketplace**.

## Install from the marketplace

![Integrations marketplace](/api/docs/assets/integrations/marketplace.png)
*Marketplace is where you install a new app.*

1. Open **Marketplace**. Filter by kind, **All statuses** / **Connected** / **Available**, or search. Those filters stay in the URL so you can share them.
2. Pick an app and finish OAuth or the provider setup. You return here after the account prompt.
3. Communication apps add queues (email, Slack, WhatsApp). Repository apps attach to a [project](/docs/ai/projects). Tool apps land on **Connected tools**. See [MCP](/docs/integrations/mcp).

WhatsApp itself is configured on **Email & messages**, not only here. The marketplace card points you there.

## Connect an accounting package

1. Open **Marketplace** and find the **Accounting** section at the top. It groups KING Accountancy, Bjorn Lunden and Moneybird; **Exact Online** and **SnelStart** show as **Coming soon**.
2. Pick a package and finish the setup (OAuth for Moneybird, an API key for KING and Bjorn Lunden). You can connect more than one package in the same workspace.
3. Agents then use one shared set of accounting actions — companies, contacts, invoices, ledger, outstanding balances — no matter which package is behind it. Changes agents want to make always arrive as a [decision](/docs/ai/decisions) you approve first.
4. On **Connected**, the **Tools for agents** list shows an **Accounting** group with your administrations. With a single administration agents pick it automatically; with more you see them listed.

The **Banking**, **Investing** and **Documents** sections in the marketplace are modules that are prepared but not yet connectable; their cards list the planned connectors.

## Walk through a module setup

A module is the business capability (accounting, later banking). A package is the connector underneath (KING, Moneybird). You or the assistant can start the same setup.

1. Open **Marketplace** and choose a module title or **Set up Accounting**. That opens the module page at **Settings > Integrations > Module setup**.
2. Read what agents can do after connect. Writes always become a [decision](/docs/ai/decisions) you approve.
3. Choose a package and finish OAuth or the API key in the same hub used on Marketplace. `?connect=` still opens that package.
4. Or ask the company assistant to set the workspace up. After Communication, if the work touches invoices or VAT, it can recommend the module and put **Connect now** on a decision card that opens this same page.

## Set what agents may call

1. After a tool is connected, open [Govern](/docs/govern/govern) **Policy**.
2. Set Integrations (and Messaging, if it can send) so agents cannot surprise you.
3. Test once from an agent thread.

## What to do next

Connect one tool you already use. Add an [MCP server](/docs/integrations/mcp) on **Connected tools** when the marketplace app is not enough.
