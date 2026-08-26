---
title: Connect MCP servers
intro: Give agents extra tools by connecting external MCP servers to the workspace.
description: Connect external MCP (Model Context Protocol) servers to Bokito so agents can use their tools, and learn how Bokito exposes its own MCP endpoint.
keywords: mcp, model context protocol, tools, external tools, integrations
sort: 20
related: integrations,agents,mcp-endpoint
---

# Connect MCP servers

MCP (Model Context Protocol) is an open standard for giving AI agents tools. Bokito speaks it in both directions: you can plug external MCP servers into your workspace, and Bokito exposes its own tools as an MCP server for outside clients.

## Add an external server

Open **Settings, then Integrations** and add an MCP server with its URL and credentials. After connecting, the server's tools become available to your agents alongside the built-in ones. A database MCP server, for example, lets an agent look up order status while answering a customer.

## Governance applies

External tools go through the same policy engine as built-in tools. Apply modes and autonomy posture decide whether an agent may call a tool directly or must raise a decision request first. You can keep a risky external tool on `decision` while the rest runs free.

## Test before you rely on it

After connecting, run the tool once from an agent thread and check the result. A misconfigured server fails at call time, not at connect time, so a quick test saves confusion later.

## Bokito as an MCP server

The reverse direction - using Bokito's tools from Cursor or another MCP client - is a developer feature. See [MCP endpoint](/docs/developers/mcp-endpoint).
