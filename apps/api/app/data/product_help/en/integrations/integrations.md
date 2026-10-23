---
title: Connections
intro: Give agents tools outside Bokito — modules, partner logins and AI tools on one page.
description: Use Connections to install modules, connect partner logins and AI tools, and govern what agents may call.
keywords: connections, connections, connected, github, slack, mcp, modules, accounting, moneybird, ai tools, cursor
sort: 10
related: mcp,models,channels,govern,categories
---

# Connections

Connections are partner logins. A **module** is one package of labels, flows and a department, plus the tools allowed for its listed partners. **Connections** in the rail at `/connections` is one page for all of it: what is connected on top, then one grid with every module, integration and AI tool. Installing a module never adds a rail item; open it from Connections. Connecting a partner does not give agents tools; install the module and assign an agent first.

## See what is connected

![Connections](/api/docs/assets/integrations/connections.png)
*Connections: the Connected strip on top, then one grid with category chips and search.*

1. Open **Connections**. The **Connected** strip at the top lists every installed module and every connected integration as a compact tile with its logo and the number of connections. The strip only appears when something is connected, and only on **All** without a search term.
2. Choose a module tile to open its module page; choose an integration tile to open its panel with every registration to that provider (see **Manage connections to one provider** below). Mailboxes open **Channels** from the panel; Agenda apps open [Agenda](/docs/ai/agenda).
3. **Custom MCP servers** stays a separate list under the grid for logins that are not in the catalog. Choose **Disconnect** on a row when that login should stop (confirm **Remove this connection?**). Calendar accounts live under the **Agenda** chip (see **Connect calendar accounts** below).

## Find and connect something new

![Connect panel](/api/docs/assets/integrations/connect-panel.png)
*Choosing a card opens a showcase modal: description, endpoint, capabilities and the connect button.*

1. Under **All**, use the category chips: **Communication**, **Agenda**, **Apps**, **Tools**, **Code**, **Modules** and **AI tools**. Each chip shows its count. Search covers names and descriptions across every category, and also matches a module when you type one of its partner names (for example **Moneybird** surfaces **Accounting**). The chip lives in the URL (`/connections?kind=mcp` for Tools, `?kind=modules`, `?kind=ai_tools`), so a link always opens the category it names.
2. Cards are one flat list — never nested inside a module, never grouped under a vendor. Module packages (Moneybird API, KING, Bjorn Lunden, and the same pattern for Banking / Documents when those ship) do **not** get their own catalog card; you connect them only from the module page. Hosted MCP cards (for example **Moneybird MCP**) stay in the grid next to the module. Microsoft 365, Outlook Calendar and Microsoft Graph each have their own card. A module card carries a **Module** label. The specialist sits on the right, only as wide as the name and role, with a glow in that color. The description, tool count and partner logos fill the rest. Coming-soon modules are faded until they ship.
3. Choose a **module** or **integration** card. A showcase modal opens: modules open with the expert (name, role, living avatar) and three benefits with a check, partners, Labels & flows (packaged labels), and the agent tool names (the full list via Show details, including which can run in website chat), with **Install** / **Open module**; connections show description, endpoint, capabilities and **Connect**. Finish OAuth or setup and you return here with the modal open. A login stays on Connections until you attach it to a module.
4. Agents link straight to this modal: a card in a conversation opens `/connections?connect=slack_mcp` with the Slack modal already open. A module-package mention such as Moneybird opens the **Accounting** module page instead.
5. Communication apps add queues (email, WhatsApp). Code apps attach to a [folder](/docs/ai/folders). Agenda apps sync into [Agenda](/docs/ai/agenda). Tool apps land under **Tools** or **Custom MCP servers**. See [MCP](/docs/integrations/mcp).

WhatsApp itself is configured under **Channels**, not only here. The card points you there.

## Connect the tools of a content agency

Notion, Canva, Google Drive and Sheets, Mailblue, Metricool and Zapier connect from the same grid.

1. Search for the tool on **Connections** and choose its card. **Notion** and **Canva** sign in with the provider. **Google Drive** covers Drive and Sheets: agents search and read files, and write rows to a sheet.
2. **Mailblue** asks for the **Account URL** and the **API key**. **Metricool** asks for the **API token**, the **User id** and, optionally, a **Default brand id**. **Zapier** asks for your **Personal MCP server URL**, with the actions you enabled in Zapier.
3. Choose **Connect**. Bokito checks the login right away and shows an error when a field is wrong.
4. Use the connection for one client or department only with the section below, and name it on a flow under **Uses** so its agents work with it.

## Reconnect a connection that stopped

Bokito tests every connection once a day.

1. When a connection stops answering or its login expires, a conversation **Connection {name} needs attention** appears for the department that owns it, or for the workspace.
2. Open **Connections** and choose the connection's tile. Choose **Connect** again and finish the sign-in or fill in the new key.
3. The department lead also names the connection in the morning briefing until it works again.

## Connect an AI or coding tool

1. Choose the **AI tools** chip. **AI tool** cards (Cursor, Claude Code, Claude Desktop, Codex CLI, VS Code, Windsurf, ChatGPT) use this workspace over MCP; **Coding tool** cards (Cursor Cloud Agents, Claude Managed Agents, Devin) take a bug or feature from a conversation and bring the pull request back.
2. Choose **Set up** on a card. It opens the matching section on **Settings → Developers**, where the OAuth or token snippets live. See [Connect AI tools](/docs/developers/mcp-endpoint).

## Install a business module

1. Open **Connections** in the rail under **Organization**. Installed modules sit in the **Connected** strip; use the **Modules** chip to find a preset that is not installed yet.
2. Open **Accounting** (or another live module), then choose **Add department**. A module is a department in a box: a specialist agent, labels and flows. Under **Department**, pick **New department** or an existing department that already does similar work; Bokito suggests the best match. Choose the **Accountable person**. When the department already has a lead, tick **Let the specialist lead instead** to make the specialist primary; otherwise it joins as a member. Bokito copies the packaged labels, flows, sources and skill. The catalog card shows **Installed** with a check and **Manage**. Later edits on that department stay yours.
3. The toast offers **Talk to specialist**. On the module page you can open their chat or assign another company agent. Mark one as **Default**. Only rostered agents get this module's tools. **Uninstall** archives the specialist. A department the module created is soft-deleted; a department it joined stays with its own work. Partner logins stay on Connections.
4. Review **What agents can do**: each action shows a short description, the path (`accounting_list_companies`, …), **Read** or **Needs approval**, and **Website chat** when the tool can run in the installable widget (enable under Today). When partners are attached, **Tools from connected MCP servers** lists discovered MCP names.
5. At the top of the module page, under **Connections**, choose **New registration** to connect the module package (Moneybird, KING, or Bjorn Lunden) and attach it in one step, or **Use an existing connection** when a login already exists. Planned packages (Exact Online, SnelStart) stay greyed out. The remaining tabs are **Today**, **Sources**, and **Setup**.
6. Attach a partner login when you want live data. Until then the module is installed but shows as incomplete for connections; after attach it is **Connected**. Labels and flows stay on their existing surfaces; the module adds no rail item.

## Connect an optional accounting integration

![Module home](/api/docs/assets/integrations/module-home.png)
*Module page lists registrations at the top, then Today, Sources and Setup.*

1. Open **Accounting** from its card on **Connections**. Registrations sit at the top of the module page (not on a separate tab). The list shows only attached registrations, not every Moneybird login in the workspace.
2. Choose **New registration** to connect from the module (that login attaches automatically), or **Use this connection** for a login that already exists on Connections.
3. Finish setup with real credentials (OAuth for Moneybird, partner key plus administraties for KING, client id/secret for Bjorn Lunden, Trading API key plus secret for Alpaca). Empty or random labels alone do not create a working link.
4. Each row shows status (**Verified**, **Needs credentials**, **Unverified**, or **Error**), optional provider identity, its folders (or **All folders**), and actions: **Verify**, **Set default** (only when verified), **Rename**, **Remove from module** (keeps the login on Connections), **Disconnect**, and **Manage** for folders and access.
5. Each administration connects once. Connecting the same Moneybird administration or KING omgeving again updates the existing registration and shows **This administration was already connected**, instead of adding a second row.
6. Only agents assigned to the module can use the shared accounting toolset. Propose tools land as a [decision](/docs/ai/decisions) you approve first.

## Manage connections to one provider

Standalone catalog logins (inbox, agenda, hosted MCP, custom tools) open a provider panel. Module packages such as Moneybird API are managed on the **Accounting** module page instead.

![Provider connections](/api/docs/assets/integrations/provider-connections.png)
*The provider panel lists each registration with status, folders and actions.*

1. Open **Connections** and choose a standalone provider card, for example **Moneybird MCP** or **Slack**.
2. The panel lists every registration with its status, identity, administration number, folders, and the modules that use it. A **Restricted** badge means only some people or agents may use it.
3. Use **Verify**, **Rename** or **Disconnect** on a row. Disconnecting clears it as a module default and drops its folder links.
4. Choose **Add another registration** to connect a second account. The same administration twice updates the existing row.
5. For Moneybird API, KING or Bjorn Lunden, open **Accounting** and manage registrations at the top of that page.

## Use a connection for one client or department only

Link a registration to folders when it belongs to one client or department.

1. Open the provider card on **Connections** (or the module page) and choose **Manage** on the registration.
2. Under **Folders**, select one or more folders and choose **Save folders**.
3. A linked registration is exclusive: agents use it only for work in those folders (a conversation filed on the folder, or a run with that folder). Outside them it is not available.
4. With no folder selected the registration shows **All folders** and works everywhere. Inside a folder, agents pick that folder's registration before the module default.

You can also link from the folder page; see [Folders](/docs/ai/folders). The connection panel still labels that list **Folders** and the button **Save folders**.

## Choose who may use a connection

Set which people, agents and teams may use or manage a registration.

1. Choose **Manage** on the registration, then the button under **Access** (by default **All people and agents**).
2. Per team, person or agent pick **Use** (run its tools) or **Manage** (verify, rename, link folders, change access). **No access** hides it from them.
3. Choose **Save**. **Back to default** gives all people and agents **Use** again. Owners and admins always manage every connection.
4. An agent without access cannot reach the registration; the attempt appears in the audit log. Agents can propose a change with `set_connection_scope`, which always asks for approval.

**Banking** is installable with a read-only GoCardless Bank Account Data connection (balances and transactions; payments only ship as proposals). **Investing** and **Documents** are prepared but not yet installable; they and their planned packages (Twelve Data, Bitvavo, TradingView, Google Drive, OneDrive / SharePoint, Dropbox) appear faded on Connections. **Accountant** is the same kind of idea: faded, not installable, and it reuses Accounting's packages (Moneybird, KING, Bjorn Lunden, and the planned Exact, SnelStart, Twinfield, and Yuki logins) instead of adding one.

## Connect calendar accounts

Each Google or Microsoft account is one connection; add as many as you need and choose per account which calendars show in [Agenda](/docs/ai/agenda).

![Calendar accounts](/api/docs/assets/integrations/calendar-accounts.png)
*The Agenda filter on Connections lists every calendar account with its status and calendars.*

1. Open **Connections** and choose the **Agenda** filter. Under **Calendar accounts**, choose **Connect Google Calendar** or **Connect Outlook Calendar** and finish sign-in. With an account already connected, the buttons read **Add Google account** and **Add Microsoft account**.
2. Each account row shows its address, the sync status, the number of events, and a colored dot per calendar that is on. **Shared with you** marks an account someone else connected.
3. Choose **Manage**. Under **Calendars**, switch on the calendars to sync (only the primary calendar is on at first) and pick the **Default calendar for new events**. Read-only calendars sync but never receive new events. Switched-on calendars update automatically in Agenda.
4. Under **Access**, choose who may see and use the account. A new account is yours to manage, and agents may read it. Give a colleague **Use** to show it in their Agenda, or **Manage** to let them change calendars and access. Owners and admins always manage.
5. When the row says **Sign in again to keep this calendar in sync**, choose **Reconnect**. **Disconnect** removes the account and its events from Agenda; nothing changes in Google or Outlook.

## Control accounting writes and agent access

1. Open Accounting from **Connections**. The write banner shows **Writes disabled — retrieval only** or **Writes enabled — approved decisions execute**.
2. As owner or admin, use **Allow writes in this workspace** to let approved decisions write to the package. Writes stay off until the platform switch is also on, so approvals always resolve safely.
3. On the module **Setup** tab, open the access panel behind the settings icon on an assigned agent. Turn on **Write access** so that agent may propose accounting writes; agents without it get read tools only.
4. Under **Administration scope**, pick the administrations the agent may address. No selection means access to all administrations.
5. Every proposed write lands as a decision card showing the administration and the payload. Approving applies it to the package only when both write switches are on.

## Install a flow template

Modules ship one catalog package containing labels and pre-built flows. Examples include **VAT filing preparation** and **Monthly close review** on Accounting, and **Bank reconciliation** on Banking.

1. Open the module page from **Connections**. When the module is on, the **Flow templates** panel lists what it ships, with the step count per template.
2. A template that cannot run yet shows why (module connection missing, required agent role not assigned). Fix the requirement first.
3. Choose **Install**. The flow is copied to your workspace — you own and can edit the copy. **Open flow** takes you to it under [Flows](/docs/ai/flows).
4. Before every run of an installed template, Bokito re-checks the requirements; a broken requirement pauses the run with a decision instead of failing silently.

## Index module sources

1. Open the module home **Sources** tab. Platform packs appear when the module is installed (Accounting: Belastingdienst, NBA HRA, RJNet, KvK annual accounts, BW2 Title 9). Indexing starts on its own.
2. Each pack fetches curated start pages, then a limited set of same-origin links (`robots.txt` respected, no login walls). Status moves **Pending** → **Indexing** → **Ready** (or **Error** if the site has no readable public text, such as a paywall). You can **Reindex** or **Disable** a platform pack; you cannot delete it.
3. Choose **Add URL** for office pages. Those follow the same shallow crawl with a lower page cap. Agents search ready sources through module source tools.

## Finish setup with the assigned agent

1. Open the module home **Setup** tab.
2. Assign at least one agent if you have not yet, then review the checklist and choose **Continue with assigned agent**.
3. The default assigned agent walks you through optional connections, defaults and sources, and can put decisions on the thread when something needs approval.
4. Return to the module page and choose **Finish setup** when the checklist is done.

## Turn on customer chat tools and module labels

1. Open an installed module such as **Accounting**.
2. Under **Customer chat tools**, turn a verb on only when the website widget may look up that visitor's own records after they confirm a short email link.
3. Under **Labels**, choose **Install** on a template (for example billing inquiry). Attach a flow to the label so chat can file a ticket on it; see [Categories and tickets](/docs/ai/categories).

## Set what agents may call

1. After a tool is connected, open [Govern](/docs/govern/govern) **Policy**.
2. Set Connections (and Messaging, if it can send) so agents cannot surprise you.
3. Test once from an agent thread.

## What to do next

Connect one tool you already use. Add an [MCP server](/docs/integrations/mcp) from the **Tools** chip when the listed apps are not enough. The server then appears under **Custom MCP servers** on Connections.
