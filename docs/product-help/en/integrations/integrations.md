---
title: Connect integrations
intro: Give agents tools outside Bokito — marketplace apps and connected accounts.
description: Use Connections and Marketplace to install modules, attach partner logins, and govern what agents may call.
keywords: integrations, marketplace, connected, github, mcp, modules, accounting, moneybird, connections
sort: 10
related: mcp,models,channels,govern
---

# Connect integrations

Integrations are partner logins. A **module** is a preset (Accounting) that may use only the partners listed on it. The **Connections** hub in the rail at `/connections` shows what is installed: module cards with the partner logos they run on, then your partner logins, then custom MCP servers. **Marketplace** is the discover tab, split into **Modules** and **Integrations**. Installed modules also appear as their own rail group (for example Accounting). Connecting a partner does not give agents tools; install the module and assign an agent first.

## See what is connected

1. Open **Connections**. At the top, **Installed modules** lists presets that are on, each card showing the logos of the programs it can use and how many connections are attached. Missing first steps may appear next (**Connect email or chat**, **Connect Agenda**, **Install a module**). Below that, **Connections** lists partner logins by type (**Communication**, **Agenda**, **Apps**, then **Code**) and by program. **Custom MCP servers** is a separate list.
2. Choose **New connection** on a program for a second login. Choose **Use in Accounting** when the partner is allowed on that module and is not attached yet. A program that Accounting does not allow never shows that action; GitHub, for example, stays under **Code**.
3. Choose **Disconnect** when a login should stop (confirm **Remove this connection?**). Mailboxes open **Channels**. Agenda apps open [Agenda](/docs/ai/agenda).

## Install from the marketplace

![Integrations marketplace](/api/docs/assets/integrations/marketplace.png)
*Marketplace: modules on top, then every integration as a flat list.*

1. Open **Marketplace**. **Modules** sits on top, **Integrations** below it as one flat list — never nested inside a module. Filter integrations by kind (**Communication**, **Agenda**, **Apps**, **Tools**, **Code**) or search. **Connect** is the first login; if one exists, **New connection** plus the count.
2. Pick an app to open its card. **Works with modules** names the presets that can use this login, so you know what agents will do with it. Finish OAuth or the provider setup and you return on Connections. A login stays there until you attach it to a module.
3. Communication apps add queues (email, WhatsApp). Code apps attach to a [project](/docs/ai/projects). Agenda apps sync into [Agenda](/docs/ai/agenda). Tool apps land under **Custom MCP servers** or **Tools**. See [MCP](/docs/integrations/mcp).

WhatsApp itself is configured on **Email & messages**, not only here. The marketplace card points you there.

## Install a business module

![Modules hub](/api/docs/assets/integrations/modules-hub.png)
*Connections hub — installed modules as cards, then partner logins.*

1. Open **Connections** in the rail (Organization group). Installed module cards sit at the top; open a card, or use **Marketplace** and its **Modules** row to install a new preset.
2. Open **Accounting** (or another live module), then choose **Install**. Status becomes **Setup**.
3. Assign **at least one AI agent**. Mark one as **Default** for setup chat. Only assigned agents get this module’s tools.
4. Review **What agents can do**: each module action shows a short description, the universal path (`accounting_list_companies`, …), and whether it is **Read** or **Needs approval**. When partners are attached, **Tools from connected MCP servers** lists the exact MCP tool names discovered from those servers.
5. Under **Connections**, choose **New registration** to connect and attach in one step, or **Use an existing connection** for a login that already lives on Connections. Planned packages (Exact Online, SnelStart) stay greyed out.
6. Choose **Continue with assigned agent** to chat through defaults and sources, then **Finish setup**. Status becomes **Installed** and the module appears in the rail **Modules** group (same page URL).

## Connect an optional accounting integration

![Module home](/api/docs/assets/integrations/module-home.png)
*Module page lists registrations, sources and AI setup on one surface.*

1. Open **Accounting** from the rail **Modules** group, or from the card on **Connections**. The list shows only attached registrations, not every Moneybird login in the workspace.
2. Choose **New registration** to connect from the module (that login attaches automatically), or **Use this connection** for a login that already exists on Connections.
3. Finish setup with real credentials (OAuth for Moneybird, partner key plus administraties for KING, client id/secret for Bjorn Lunden). Empty or random labels alone do not create a working link.
4. Each row shows status (**Verified**, **Needs credentials**, **Unverified**, or **Error**), optional provider identity, and actions: **Verify**, **Remove from module** (keeps the login on Connections), **Disconnect**, **Rename**, and **Set default** (only when verified).
5. Only agents assigned to the module can use the shared accounting toolset. Propose tools land as a [decision](/docs/ai/decisions) you approve first.

**Banking** is installable with a read-only GoCardless Bank Account Data connection (balances and transactions; payments only ship as proposals). **Investing** and **Documents** are prepared but not yet installable; their planned packages appear as disabled rows in the Add registration picker.

## Control accounting writes and agent access

1. Open the Accounting workspace from the rail **Modules** group. The write banner shows **Writes disabled — retrieval only** or **Writes enabled — approved decisions execute**.
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

Connect one tool you already use. Add an [MCP server](/docs/integrations/mcp) from **Marketplace** when the listed apps are not enough. The server then appears under **Custom MCP servers** on Connections.
