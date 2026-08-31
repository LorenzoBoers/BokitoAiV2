---
title: Connect integrations
intro: Give agents tools outside Bokito — marketplace apps and connected accounts.
description: Use Modules, Connected, Marketplace and Connected tools to install apps, finish OAuth, and govern what agents may call.
keywords: integrations, marketplace, connected, github, slack, mcp, modules, accounting, moneybird
sort: 10
related: mcp,models,channels,govern
---

# Connect integrations

Integrations are the tools agents may call. Everything connects in one place: the **Modules** hub in the rail at `/modules`, with four tabs — **Modules** (business capabilities), **Connected** (what is live), **Marketplace** (what you can add) and **Connected tools** (MCP tool servers). Installed modules appear in the rail under **AI** (for example Accounting).

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
*Modules catalog — install, then finish setup.*

1. Open **Modules** in the rail.
2. Choose **Install** on **Accounting** (or another live module). Status becomes **Setup**.
3. Open the module page (`/modules/accounting`). Assign **at least one AI agent** (avatar and colour show in the picker). Mark one as **Default** for setup chat. Only assigned agents get this module’s tools.
4. Review **What agents can do**: each tool shows a short description, the path (`accounting_list_companies`, …), and whether it is **Read** or **Needs approval**.
5. Under **Connections**, choose **Add registration**, pick a live package (KING, Bjorn Lunden, Moneybird), and enter the required credentials. The registration is saved only after the provider accepts them. Planned packages (Exact Online, SnelStart) stay greyed out and cannot be connected yet.
6. Choose **Continue with assigned agent** to chat through defaults and sources, then **Finish setup**. Status becomes **Installed** and the module appears under **AI → Modules** (same page URL).

## Connect an optional accounting integration

![Module home](/api/docs/assets/integrations/module-home.png)
*Module page lists registrations, sources and AI setup on one surface.*

1. Open **Modules**, then **Accounting** (or open it from **AI → Modules** — same page).
2. On **Connections** (also on Overview), choose **Add registration** and pick a live package.
3. Finish setup with real credentials (OAuth for Moneybird, partner key plus administraties for KING, client id/secret for Bjorn Lunden). Empty or random labels alone do not create a working link.
4. Each row shows status (**Verified**, **Needs credentials**, **Unverified**, or **Error**), optional provider identity, and actions: **Verify**, **Disconnect**, **Rename** (display label only), and **Set default** (only when verified).
5. Only agents assigned to the module can use the shared accounting toolset. Propose tools land as a [decision](/docs/ai/decisions) you approve first.

**Banking** is installable with a read-only GoCardless Bank Account Data connection (balances and transactions; payments only ship as proposals). **Investing** and **Documents** are prepared but not yet installable; their planned packages appear as disabled rows in the Add registration picker.

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
