---
title: Connect integrations
intro: Give agents tools outside Bokito — marketplace apps and connected accounts.
description: Use Connected, Marketplace and Connected tools to install apps, finish OAuth, and govern what agents may call.
keywords: integrations, marketplace, connected, github, slack, mcp, modules, accounting, moneybird
sort: 10
related: mcp,models,channels,govern
---

# Connect integrations

Integrations are the tools agents may call. Open **Modules** in the left sidebar (marked **New**) to turn a business capability on, or open **Settings**, then **Integrations** for packages. Integrations has three tabs: **Connected**, **Marketplace** and **Connected tools**.

## See what is connected

1. Open **Connected**. This is the live list for this workspace.
2. Filter with **All integrations**, **Communication**, **Repository** or **Tools for agents**. The last kind is remembered. Use the search box to filter connections.
3. Choose **Disconnect** when a tool should stop (confirm **Remove this connection?**). Inbox-kind apps also appear as [channels](/docs/inbox/channels). Empty lists offer **Go to Marketplace**.

## Install from the marketplace

![Integrations marketplace](/api/docs/assets/integrations/marketplace.png)
*Marketplace is where you install a new app.*

1. Open **Marketplace**. It opens on **Available** (ready to connect), so coming-soon cards stay out of the way. Filter by kind, **All statuses** / **Connected** / **Available**, or search. Those filters stay in the URL so you can share them.
2. Pick an app and finish OAuth or the provider setup. You return here after the account prompt.
3. Communication apps add queues (email, Slack, WhatsApp). Repository apps attach to a [project](/docs/ai/projects). Tool apps land on **Connected tools**. See [MCP](/docs/integrations/mcp).

WhatsApp itself is configured on **Email & messages**, not only here. The marketplace card points you there.

## Connect an accounting package

1. Open **Marketplace** and find the **Accounting** section at the top. It groups KING Accountancy, Bjorn Lunden and Moneybird. **Exact Online** and **SnelStart** are listed as planned connectors under that section.
2. Pick a package and finish the setup (OAuth for Moneybird, an API key for KING and Bjorn Lunden). You can connect more than one package in the same workspace.
3. Agents then use one shared set of accounting actions — companies, contacts, invoices, ledger, outstanding balances — no matter which package is behind it. Changes agents want to make always arrive as a [decision](/docs/ai/decisions) you approve first.
4. On **Connected**, the **Tools for agents** list shows an **Accounting** group with your administrations. With a single administration agents pick it automatically; with more you see them listed.

The **Banking**, **Investing** and **Documents** sections in the marketplace are modules that are prepared but not yet connectable; their cards list the planned connectors.

## Turn a module on

A module is a workspace switch. Agents only see that capability after you turn it on. Packages stay listed so you can see which connectors belong to the module.

1. Open **Modules** in the left sidebar (or **Settings**, then **Modules**).
2. Find **Accounting** (or another live module) and turn the switch **On**. The badge changes from **Off** to **On**.
3. Agents can now use the module. Connecting a package later also turns the module on. Turning it **Off** hides it from agents; connected packages stay in place.
4. Or approve **Turn on** on a decision card from the company assistant. That lands on the same Modules page.

## Walk through a module setup

A module is the business capability (accounting, later banking). A package is the connector underneath (KING, Moneybird). You or the assistant can start the same setup.

1. Open **Modules** in the left sidebar (or **Settings**, then **Modules**). After you turn **Accounting** on, choose **Connect a package** or a package chip such as Moneybird.
2. The next-step banner tells you to connect. Packages sit first when the module is already on. Writes always become a [decision](/docs/ai/decisions) you approve.
3. Finish OAuth or the API key in the same hub used on Marketplace. Connecting a package also turns the module on.
4. Or ask the company assistant to set the workspace up. After Communication, if the work touches invoices or VAT, it can recommend the module and put **Turn on** or **Connect a package** on a decision card that opens this same page.

## Set what agents may call

1. After a tool is connected, open [Govern](/docs/govern/govern) **Policy**.
2. Set Integrations (and Messaging, if it can send) so agents cannot surprise you.
3. Test once from an agent thread.

## What to do next

Connect one tool you already use. Add an [MCP server](/docs/integrations/mcp) on **Connected tools** when the marketplace app is not enough.
