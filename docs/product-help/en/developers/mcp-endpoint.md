---
title: MCP endpoint
intro: Call workspace tools from Cursor or any MCP client over JSON-RPC.
description: Use the Bokito MCP endpoint to call governed workspace tools from external MCP clients. Covers the JSON-RPC transport, token scopes and a Cursor setup example.
keywords: mcp, json-rpc, cursor, tools, model context protocol
sort: 50
related: api-overview,authentication,mcp
---

# MCP endpoint

Bokito exposes its tool registry as an MCP server. External clients - Cursor, IDEs, other agent frameworks - call exactly the same governed tools that internal agents use: one implementation, two consumers.

## Transport

MCP Streamable HTTP: JSON-RPC 2.0 over POST to a single endpoint, authenticated with an API token.

```
POST https://your-bokito-host/api/mcp
Authorization: Bearer bok_...
Content-Type: application/json
```

Supported methods: `initialize`, `ping`, `tools/list` and `tools/call`.

## Example: list tools

```bash
curl -X POST -H "Authorization: Bearer bok_..." -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' \
  "https://your-bokito-host/api/mcp"
```

Each tool comes back with a name, a description prefixed with its category, and a JSON input schema.

## Example: call a tool

```bash
curl -X POST -H "Authorization: Bearer bok_..." -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {"name": "search_knowledge", "arguments": {"query": "refund policy"}}
  }' \
  "https://your-bokito-host/api/mcp"
```

## Scopes and governance

Token scopes name tool categories: a scoped token only sees and calls tools in those categories (empty scopes = all tools). Independent of scopes, every call runs through the workspace policy engine with API-level trust - a tool that requires approval raises a decision request instead of executing. External access never bypasses governance.

## Use from Cursor

Add the endpoint to your MCP configuration:

```json
{
  "mcpServers": {
    "bokito": {
      "url": "https://your-bokito-host/api/mcp",
      "headers": { "Authorization": "Bearer bok_..." }
    }
  }
}
```

Your editor's agent can then search workspace knowledge, read threads and use other workspace tools, subject to the token's scopes.
