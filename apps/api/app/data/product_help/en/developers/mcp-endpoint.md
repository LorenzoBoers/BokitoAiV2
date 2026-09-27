---
title: MCP endpoint
intro: Call workspace tools from Cursor or any MCP client over JSON-RPC.
description: Use the Bokito MCP endpoint to call governed workspace tools from external MCP clients. Covers OAuth URL-only connect, the JSON-RPC transport, token scopes and a Cursor setup example.
keywords: mcp, json-rpc, cursor, tools, model context protocol, oauth
sort: 50
related: api-overview,authentication,mcp
---

# MCP endpoint

Bokito exposes its tool registry as an MCP server. External clients - Cursor, IDEs, other agent frameworks - call exactly the same governed tools that internal agents use: one implementation, two consumers.

## Connect with OAuth (recommended)

Paste only the MCP URL into Cursor Settings → MCP. On first use Cursor opens the browser: sign in to Bokito and pick a workspace under your account.

```json
{
  "mcpServers": {
    "bokito": {
      "url": "https://your-bokito-host/api/mcp"
    }
  }
}
```

Under **Settings → Developers** use **Copy Cursor MCP URL config** for the same snippet. No API token is required for this path.

## Connected clients

After you authorize, the session appears under **Settings → Developers → Connected MCP clients**. Choose **Revoke** to cut access immediately; Cursor must authorize again. Refresh-token reuse also revokes the whole session family.

## Transport

MCP Streamable HTTP: JSON-RPC 2.0 over POST, plus GET with `Accept: text/event-stream` for the idle SSE probe. Clients authenticate with an OAuth access token (after the browser flow) or with an API token. Responses may include `Mcp-Session-Id`.

```
POST https://your-bokito-host/api/mcp
Authorization: Bearer …
Content-Type: application/json
```

Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`, plus `resources/list`, `resources/read`, `prompts/list` and `prompts/get` for IDE discovery. Tools advertise MCP annotations (`readOnlyHint`, `destructiveHint`). Resources serve product-help markdown.

## API token fallback

For CI or scripts that cannot open a browser, create a token under **Settings → Developers** and paste a bearer config (`Authorization: Bearer bok_…`). That path does not use OAuth.

## Example: list tools

```bash
curl -X POST -H "Authorization: Bearer bok_..." -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' \
  "https://your-bokito-host/api/mcp"
```

Each tool comes back with a name, a description prefixed with its category, and a JSON input schema.

## What you can call

`tools/list` is the source of truth, but these families are always there:

- `messaging` - read and summarize threads (`list_threads`), reply or close them, and work the CRM with `list_contacts`, `get_contact` and `upsert_contact`
- `agents` - inspect the workforce with `list_agents`, `get_agent`, `list_playbooks` and `get_playbook`; create or update agents and playbooks
- `triggers` - `list_triggers` for the Agenda, plus scheduling new wakes
- `cases` - typed intake: `list_case_types`, `list_cases`, `create_case`
- `govern` - `get_tenant_overview`, `get_usage_summary` and `resolve_decision` to answer a pending decision card
- `workspace` - knowledge: `search_index`, `list_docs`, `read_doc`, `write_doc`

## Example: call a tool

```bash
curl -X POST -H "Authorization: Bearer bok_..." -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {"name": "search_index", "arguments": {"query": "refund policy"}}
  }' \
  "https://your-bokito-host/api/mcp"
```

## Scopes and governance

OAuth consent and API token scopes name tool categories: a scoped credential only sees and calls tools in those categories (empty scopes = all tools). Independent of scopes, every call runs through the workspace policy engine with API-level trust - a tool that requires approval raises a decision request instead of executing. External access never bypasses governance.

## Use from Cursor

1. Under **Settings → Developers**, use **Copy Cursor MCP URL config**, **Download bokito-mcp.json**, or **Copy Cursor MCP config** (bearer). **Copy Claude Desktop config** and **Copy MCP curl** are on the same page for other clients.
2. Paste or import the JSON under Cursor Settings → MCP (Cursor has no stable public deeplink for remote HTTP MCP yet).
3. When Cursor prompts, authorize in the browser and select the workspace.
4. Tools from that workspace appear for the agent, subject to scopes and Govern.
5. To disconnect later, open **Connected MCP clients** and choose **Revoke**.
