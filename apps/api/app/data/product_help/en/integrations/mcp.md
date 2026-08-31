---
title: Connect MCP servers
intro: Give agents extra tools by connecting external MCP servers.
description: Connect MCP servers under Integrations, Connected tools, then keep risky tools on Ask first in Govern.
keywords: mcp, model context protocol, connected tools, integrations
sort: 20
related: integrations,agents,mcp-endpoint
---

# Connect MCP servers

MCP is how agents call external tools over a standard protocol. In the product this page is **Connected tools**.

## Add a server

![MCP servers](/api/docs/assets/mcp/servers.png)
*Add the server URL and credentials.*

1. Open **Modules** in the rail, then the **Connected tools** tab (the same page as `/modules/tools`).
2. Choose **Connect a tool**. The dialog is **Add tool server**. Enter a **Display name**, **Server URL**, and **Authentication** (**API key** or **Bearer token**) plus **Secret / token**.
3. **Save connection**. The row appears under **Configured connections**. Filter the list, copy the endpoint, then **Test connection** — success reads **Connected — N tools found**. Disconnect asks for confirmation.

Marketplace apps such as Notion or Linear also land here after browser sign-in. A misconfigured server often fails at call time, not at connect time.

## Test it once

1. Start a chat with an [agent](/docs/ai/agents).
2. Ask it to use the new tool.
3. If the call raises a decision, approve it in the thread.

## Keep governance on

External tools use the same policy as built-in tools. Keep a risky tool on **Ask first** in [Govern](/docs/govern/govern) **Policy**. Using Bokito from Cursor is the [MCP endpoint](/docs/developers/mcp-endpoint).

## What to do next

Install a marketplace app first if you only need a common connector. See [Integrations](/docs/integrations/integrations).
