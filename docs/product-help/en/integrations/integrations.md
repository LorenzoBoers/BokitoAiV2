---
title: Connect integrations
intro: Give agents tools outside Bokito — marketplace apps and connected accounts.
description: Use Modules, Connected, Marketplace and Connected tools to install apps, finish OAuth, and govern what agents may call.
keywords: integrations, marketplace, connected, github, slack, mcp, modules, accounting, moneybird
sort: 10
related: mcp,models,channels,govern
---

# Connect integrations

Integrations are the tools agents may call. Open **Modules** under Settings at `/modules` to install a business capability, finish setup, and manage optional integrations. Installed modules appear under **AI → Modules** (for example Accounting). Open **Settings → Integrations** for Connected, Marketplace and Connected tools.

## See what is connected

1. Open **Connected**. This is the live list for this workspace.
2. Filter with **All integrations**, **Communication**, **Repository**, **Calendar** or **Tools for agents**. The last kind is remembered. Use the search box to filter connections.
3. Choose **Disconnect** when a tool should stop (confirm **Remove this connection?**). Inbox-kind apps also appear as [channels](/docs/inbox/channels). Calendar apps open on [Agenda](/docs/ai/agenda). Empty lists offer **Go to Marketplace**.

## Install from the marketplace

![Integrations marketplace](/api/docs/assets/integrations/marketplace.png)
*Marketplace is where you install a new app.*

1. Open **Marketplace**. It opens on **Available** (ready to connect), so coming-soon cards stay out of the way. Filter by kind (including **Calendar**), **All statuses** / **Connected** / **Available**, or search. Those filters stay in the URL so you can share them.
2. Pick an app and finish OAuth or the provider setup. You return here after the account prompt.
3. Communication apps add queues (email, Slack, WhatsApp). Repository apps attach to a [project](/docs/ai/projects). Calendar apps sync into [Agenda](/docs/ai/agenda). Tool apps land on **Connected tools**. See [MCP](/docs/integrations/mcp).

WhatsApp itself is configured on **Email & messages**, not only here. The marketplace card points you there.

## Install a business module

![Modules hub](/api/docs/assets/integrations/modules-hub.png)
*Modules catalog under Settings — install, then finish setup.*

1. Open **Modules** under Settings.
2. Choose **Install** on **Accounting** (or another live module). Status becomes **Setup**.
3. On **Setup** (or Overview), assign **at least one AI agent**. Mark one as **Default** for setup chat. Only assigned agents get this module’s tools.
4. Optionally link a platform integration under **Uses integrations** (KING, Bjorn Lunden, Moneybird). Connecting one moves the module into setup if it was not installed yet; it does not skip agent assignment.
5. Choose **Continue with assigned agent** to chat through packages, defaults and sources, then **Finish setup**. Status becomes **Installed** and the module appears under **AI → Modules**.
6. Open the module workspace from the AI menu, or **Manage** for Connections, Sources and Setup.

## Connect an optional accounting integration

![Module home](/api/docs/assets/integrations/module-home.png)
*Module home lists integrations the module can use, registrations, sources and AI setup.*

1. Open **Modules**, then **Accounting**, then **Overview** (or **Connections**).
2. Pick an integration and finish setup on the platform. You can add more than one registration of the same provider.
3. On **Connections**, rename registrations, set the **Default** agents should use, and pick a default administration when needed.
4. Only agents assigned to the module can use the shared accounting toolset. Writes always arrive as a [decision](/docs/ai/decisions) you approve first.

The **Banking**, **Investing** and **Documents** modules are prepared but not yet installable.

## Control accounting writes and agent access

1. Open the Accounting workspace under **AI → Modules**. The write banner shows **Writes disabled — retrieval only** or **Writes enabled — approved decisions execute**.
2. As owner or admin, use **Allow writes in this workspace** to let approved decisions write to the package. Writes stay off until the platform switch is also on, so approvals always resolve safely.
3. On the module **Setup** tab, open the access panel behind the settings icon on an assigned agent. Turn on **Write access** so that agent may propose accounting writes; agents without it get read tools only.
4. Under **Administration scope**, pick the administrations the agent may address. No selection means access to all administrations.
5. Every proposed write lands as a decision card showing the administration and the payload. Approving applies it to the package only when both write switches are on.

## Index module sources

1. Open the module home **Sources** tab.
2. Platform seeds (for Accounting: RJNet, NBA HRA, Belastingdienst) appear when the module is in setup or installed. Reindex or disable them; you cannot delete platform seeds.
3. Choose **Add URL** for your own regs or office pages. Agents search these through module source tools.

## Finish setup with the assigned agent

1. Open the module home **Setup** tab.
2. Assign at least one agent if you have not yet, then review the checklist and choose **Continue with assigned agent**.
3. The default assigned agent walks you through optional integrations, defaults and sources, and can put decisions on the thread when something needs approval.
4. Return to the module page and choose **Finish setup** when the checklist is done.

## Set what agents may call

1. After a tool is connected, open [Govern](/docs/govern/govern) **Policy**.
2. Set Integrations (and Messaging, if it can send) so agents cannot surprise you.
3. Test once from an agent thread.

## What to do next

Connect one tool you already use. Add an [MCP server](/docs/integrations/mcp) on **Connected tools** when the marketplace app is not enough.
