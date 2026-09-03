---
title: Connect MCP servers
intro: Give agents extra tools by connecting external MCP servers.
description: Connect MCP servers from Marketplace; they appear under Custom MCP servers on Connections. Keep risky tools on Ask first in Govern.
keywords: mcp, model context protocol, connected tools, integrations
sort: 20
related: integrations,agents,mcp-endpoint
---

# Connect MCP servers

MCP is how agents call external tools over a standard protocol. Those logins live under **Custom MCP servers** on **Connections**.

## Add a server

![MCP servers](/api/docs/assets/mcp/servers.png)
*Add the server URL and credentials.*

1. Open **Connections** in the rail, then **Marketplace**, and filter **Tools**. Choose **Custom tool** (or Notion, Linear, and other marketplace apps).
2. Finish setup: for a custom server enter a **Display name**, **Server URL**, and **Authentication** (**API key** or **Bearer token**) plus **Secret / token**.
3. **Save connection**. The row appears under **Custom MCP servers** on **Connections**. Choose **Disconnect** to remove it.

Marketplace apps such as Notion, Linear, or KING Accountancy also land here after setup. Open an app card to see the **Tool endpoint** and, once connected, the exact **Tools** discovered from the MCP server (refresh to re-run discovery). A misconfigured server often fails at call time, not at connect time.

## Test it once

1. Start a chat with an [agent](/docs/ai/agents).
2. Ask it to use the new tool.
3. If the call raises a decision, approve it in the thread.

## Keep governance on

External tools use the same policy as built-in tools. Keep a risky tool on **Ask first** in [Govern](/docs/govern/govern) **Policy**. Using Bokito from Cursor is the [MCP endpoint](/docs/developers/mcp-endpoint).

## What to do next

Install a marketplace app first if you only need a common connector. See [Integrations](/docs/integrations/integrations).
