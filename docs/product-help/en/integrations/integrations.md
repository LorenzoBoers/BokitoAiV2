---
title: Connect integrations
intro: Give agents tools outside Bokito — marketplace apps and connected accounts.
description: Use Modules, Connected, Marketplace and Connected tools to install apps, finish OAuth, and govern what agents may call.
keywords: integrations, marketplace, connected, github, slack, mcp, modules, accounting, moneybird
sort: 10
related: mcp,models,channels,govern
---

# Connect integrations

Integrations are the tools agents may call. Open **Modules** in the left sidebar (marked **New**) at `/modules` to turn a business capability on and manage packages, sources and AI setup. Open **Settings**, then **Integrations** for Connected, Marketplace and Connected tools.

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

## Open the Modules hub

![Modules hub](/api/docs/assets/integrations/modules-hub.png)
*Modules is a first-class rail surface for business capabilities.*

1. Open **Modules** in the left sidebar.
2. Turn **Accounting** (or another live module) **On**. The badge moves from **Off** to **On**.
3. Choose **Manage Accounting** (or **Connect a package**) to open the module home.
4. On the module home use the tabs: **Overview**, **Connections**, **Sources** and **Setup**.

## Connect an accounting package

![Module home](/api/docs/assets/integrations/module-home.png)
*Module home holds packages, registrations, sources and AI setup.*

1. Open **Modules**, then **Accounting**, then **Overview** (or **Connections**).
2. Pick a package (KING Accountancy, Bjorn Lunden or Moneybird) and finish setup. You can add more than one registration of the same package.
3. On **Connections**, rename registrations, set the **Default** agents should use, and pick a default administration when needed.
4. Agents then use one shared set of accounting actions. Writes always arrive as a [decision](/docs/ai/decisions) you approve first.

The **Banking**, **Investing** and **Documents** modules are prepared but not yet connectable.

## Index module sources

1. Open the module home **Sources** tab.
2. Platform seeds (for Accounting: RJNet, NBA HRA, Belastingdienst) appear when the module is on. Reindex or disable them; you cannot delete platform seeds.
3. Choose **Add URL** for your own regs or office pages. Agents search these through module source tools.

## Finish setup with the company assistant

1. Open the module home **Setup** tab.
2. Review the checklist, then choose **Continue with company assistant**.
3. The company lead walks you through turn-on, packages, defaults and sources, and can put decisions on the thread when something needs approval.

## Set what agents may call

1. After a tool is connected, open [Govern](/docs/govern/govern) **Policy**.
2. Set Integrations (and Messaging, if it can send) so agents cannot surprise you.
3. Test once from an agent thread.

## What to do next

Connect one tool you already use. Add an [MCP server](/docs/integrations/mcp) on **Connected tools** when the marketplace app is not enough.
