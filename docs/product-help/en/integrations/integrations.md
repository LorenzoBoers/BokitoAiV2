---
title: Connect integrations
intro: Give agents tools outside Bokito — marketplace apps and connected accounts.
description: Use Connections and Marketplace to install modules, attach partner logins, and govern what agents may call.
keywords: integrations, marketplace, connected, github, mcp, modules, accounting, moneybird, connections
sort: 10
related: mcp,models,channels,govern,categories
---

# Connect integrations

Integrations are partner logins. A **module** is one package of hashtags, playbooks, and an optional Project, plus the tools allowed for its listed partners. The **Connections** hub in the rail at `/connections` is the installed inventory: modules already on, partner logins, and custom MCP servers. **Marketplace** is the full catalog — every module and integration, with no connected/available status filter. Installing a module never adds a rail item; open it from Connections. Connecting a partner does not give agents tools; install the module and assign an agent first.

## See what is connected

1. Open **Connections**. The **AI (coding) tools** banner sits above the **Connections** / **Marketplace** tabs: logos for Cursor, Claude, OpenAI, VS Code, Windsurf and Copilot, and **Set up** opens Developers. **Installed modules** uses the same cards as Marketplace: status (including **Installation incomplete** when no package is attached), partner logos, **Manage**, and **Uninstall**. Missing first steps may appear next (**Connect email or chat**, **Connect Agenda**, **Install a module**). Below that, **Connections** shows each connected integration as the same card as Marketplace — one card per product (Microsoft 365, Outlook Calendar, and Microsoft Graph are separate). Kind chips and search still apply. Mailboxes open **Channels** from the card dialog; Agenda apps open [Agenda](/docs/ai/agenda). **Custom MCP servers** stays a separate list for logins that are not in the catalog.
2. Choose a card to see every registration to that provider in one list (see **Manage connections to one provider** below). Choose **New connection** on a card for a second login. Attach a partner to Accounting from the module page (**Use this connection**), not from a grouped program row. GitHub stays a **Code** card.
3. Choose **Disconnect** on a custom MCP row when that login should stop (confirm **Remove this connection?**). Mailboxes and calendars are managed on Channels and Agenda.

## Install from the marketplace

![Integrations marketplace](/api/docs/assets/integrations/marketplace.png)
*Marketplace: modules on top, then every integration as a flat list.*

1. Open **Marketplace**. You land on **Connections** for what is already installed; Marketplace lists **everything**. With **All integrations**, **Modules** sits on top and **Integrations** below as one flat list — never nested inside a module, and never grouped under a vendor. Microsoft 365, Outlook Calendar, and Microsoft Graph each have their own card. Filter by kind: **Modules** shows only modules; **Communication**, **Agenda**, **Apps**, **Tools**, or **Code** show only those integrations (no modules row). Search still applies; there is no connected/available status filter. **Connect** is the first login; if one exists, **New connection** plus the count. A module that is not installed shows only **Install**. An installed module shows **Manage** (grey) and **Uninstall** (red). **Investing**, **Documents**, and other coming-soon modules are faded. Their planned programs (Tink, Yapily, Knab, Twelve Data, Bitvavo, TradingView, Google Drive, OneDrive / SharePoint, Dropbox) appear as faded integration cards until they ship.
2. Pick a card to open that product’s setup. **Works with modules** names the presets that can use this login, so you know what agents will do with it. Finish OAuth or the provider setup and you return on Connections. A login stays there until you attach it to a module.
3. Communication apps add queues (email, WhatsApp). Code apps attach to a [project](/docs/ai/projects). Agenda apps sync into [Agenda](/docs/ai/agenda). Tool apps land under **Custom MCP servers** or **Tools**. See [MCP](/docs/integrations/mcp).

WhatsApp itself is configured under **Channels**, not only here. The marketplace card points you there.

## Install a business module

![Modules hub](/api/docs/assets/integrations/modules-hub.png)
*Connections hub — installed modules as cards, then partner logins.*

1. Open **Connections** in the rail under **Organization**. Installed module cards sit at the top with **Manage** and **Uninstall**. Use **Marketplace** (filter **Modules**, or **All integrations**) to install a new preset.
2. Open **Accounting** (or another live module), then choose **Install**. Status becomes **Needs setup**.
3. Assign **at least one AI agent**. Mark one as **Default** for setup chat. Only assigned agents get this module’s tools.
4. Review **What agents can do**: each module action shows a short description, the universal path (`accounting_list_companies`, …), and whether it is **Read** or **Needs approval**. When partners are attached, **Tools from connected MCP servers** lists the exact MCP tool names discovered from those servers.
5. At the top of the module page, under **Connections**, choose **New registration** to connect and attach in one step, or **Use an existing connection** for a login that already lives on Connections. Planned packages (Exact Online, SnelStart) stay greyed out. The remaining tabs are **Overview**, **Sources**, and **Setup**.
6. Choose **Continue with assigned agent** to chat through defaults and sources, then **Finish setup**. Status becomes **Installation incomplete** until a partner login is attached, then **Connected**. Its hashtags and playbooks remain available through their existing product surfaces; the module stays in Connections and adds no rail item.

## Connect an optional accounting integration

![Module home](/api/docs/assets/integrations/module-home.png)
*Module page lists registrations at the top, then Overview, Sources and Setup.*

1. Open **Accounting** from its card on **Connections**. Registrations sit at the top of the module page (not on a separate tab). The list shows only attached registrations, not every Moneybird login in the workspace.
2. Choose **New registration** to connect from the module (that login attaches automatically), or **Use this connection** for a login that already exists on Connections.
3. Finish setup with real credentials (OAuth for Moneybird, partner key plus administraties for KING, client id/secret for Bjorn Lunden, Trading API key plus secret for Alpaca). Empty or random labels alone do not create a working link.
4. Each row shows status (**Verified**, **Needs credentials**, **Unverified**, or **Error**), optional provider identity, its projects (or **All projects**), and actions: **Verify**, **Set default** (only when verified), **Rename**, **Remove from module** (keeps the login on Connections), **Disconnect**, and **Manage** for projects and access.
5. Each administration connects once. Connecting the same Moneybird administration or KING omgeving again updates the existing registration and shows **This administration was already connected**, instead of adding a second row.
6. Only agents assigned to the module can use the shared accounting toolset. Propose tools land as a [decision](/docs/ai/decisions) you approve first.

## Manage connections to one provider

Open a provider card to manage every registration to it in one place.

![Provider connections](/api/docs/assets/integrations/provider-connections.png)
*The provider dialog lists each registration with status, projects and actions.*

1. Open **Connections** and choose the provider card, for example **Moneybird**.
2. The dialog lists every registration with its status, identity, administration number, projects, and the modules that use it. A **Restricted** badge means only some people or agents may use it.
3. Use **Verify**, **Rename** or **Disconnect** on a row. Disconnecting clears it as a module default and drops its project links.
4. Choose **Add another registration** to connect a second account. The same administration twice updates the existing row.

## Use a connection for one client or department only

Link a registration to projects when it belongs to one client or department.

1. Open the provider card on **Connections** (or the module page) and choose **Manage** on the registration.
2. Under **Projects**, select one or more projects and choose **Save projects**.
3. A linked registration is exclusive: agents use it only for work in those projects (a conversation filed on the project, or a run with that project). Outside them it is not available.
4. With no project selected the registration shows **All projects** and works everywhere. Inside a project, agents pick that project's registration before the module default.

You can also link from the project page; see [Projects](/docs/ai/projects).

## Choose who may use a connection

Set which people, agents and teams may use or manage a registration.

1. Choose **Manage** on the registration, then the button under **Access** (by default **All people and agents**).
2. Per team, person or agent pick **Use** (run its tools) or **Manage** (verify, rename, link projects, change access). **No access** hides it from them.
3. Choose **Save**. **Back to default** gives all people and agents **Use** again. Owners and admins always manage every connection.
4. An agent without access cannot reach the registration; the attempt appears in the audit log. Agents can propose a change with `set_connection_scope`, which always asks for approval.

**Banking** is installable with a read-only GoCardless Bank Account Data connection (balances and transactions; payments only ship as proposals). **Investing** and **Documents** are prepared but not yet installable; they and their planned packages (Twelve Data, Bitvavo, TradingView, Google Drive, OneDrive / SharePoint, Dropbox) appear faded on Marketplace.

## Control accounting writes and agent access

1. Open Accounting from **Connections**. The write banner shows **Writes disabled — retrieval only** or **Writes enabled — approved decisions execute**.
2. As owner or admin, use **Allow writes in this workspace** to let approved decisions write to the package. Writes stay off until the platform switch is also on, so approvals always resolve safely.
3. On the module **Setup** tab, open the access panel behind the settings icon on an assigned agent. Turn on **Write access** so that agent may propose accounting writes; agents without it get read tools only.
4. Under **Administration scope**, pick the administrations the agent may address. No selection means access to all administrations.
5. Every proposed write lands as a decision card showing the administration and the payload. Approving applies it to the package only when both write switches are on.

## Install a workstream template

Modules ship one catalog package containing hashtags, pre-built playbooks, and optionally a Project. Examples include **VAT filing preparation** and **Monthly close review** on Accounting, and **Bank reconciliation** on Banking.

1. Open the module page from **Connections**. When the module is on, the **Workstream templates** panel lists what it ships, with the step count per template.
2. A template that cannot run yet shows why (module connection missing, required agent role not assigned). Fix the requirement first.
3. Choose **Install**. The workstream is copied to your workspace — you own and can edit the copy. **Open workstream** takes you to it under [Workstreams](/docs/ai/workstreams).
4. Before every run of an installed template, Bokito re-checks the requirements; a broken requirement pauses the run with a decision instead of failing silently.

## Index module sources

1. Open the module home **Sources** tab. Platform packs appear when the module is in setup or installed (Accounting: Belastingdienst, NBA HRA, RJNet, KvK annual accounts, BW2 Title 9). Indexing starts on its own.
2. Each pack fetches curated start pages, then a limited set of same-origin links (`robots.txt` respected, no login walls). Status moves **Pending** → **Indexing** → **Ready** (or **Error** if the site has no readable public text, such as a paywall). You can **Reindex** or **Disable** a platform pack; you cannot delete it.
3. Choose **Add URL** for office pages. Those follow the same shallow crawl with a lower page cap. Agents search ready sources through module source tools.

## Finish setup with the assigned agent

1. Open the module home **Setup** tab.
2. Assign at least one agent if you have not yet, then review the checklist and choose **Continue with assigned agent**.
3. The default assigned agent walks you through optional integrations, defaults and sources, and can put decisions on the thread when something needs approval.
4. Return to the module page and choose **Finish setup** when the checklist is done.

## Turn on customer chat tools and module hashtags

1. Open an installed module such as **Accounting**.
2. Under **Customer chat tools**, turn a verb on only when the website widget may look up that visitor's own records after they confirm a short email link.
3. Under **Hashtags**, choose **Install** on a template (for example billing inquiry). Attach a playbook to the hashtag so chat can file a ticket on it; see [Categories and tickets](/docs/ai/categories).

## Set what agents may call

1. After a tool is connected, open [Govern](/docs/govern/govern) **Policy**.
2. Set Integrations (and Messaging, if it can send) so agents cannot surprise you.
3. Test once from an agent thread.

## What to do next

Connect one tool you already use. Add an [MCP server](/docs/integrations/mcp) from **Marketplace** when the listed apps are not enough. The server then appears under **Custom MCP servers** on Connections.
