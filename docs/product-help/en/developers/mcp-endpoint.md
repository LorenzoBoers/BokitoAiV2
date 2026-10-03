---
title: MCP endpoint
intro: Call workspace tools from Cursor, Claude, Codex, VS Code, Windsurf, ChatGPT or any MCP client.
description: Use the Bokito MCP endpoint to call governed workspace tools from external AI tools. Covers the Connect AI tools page, OAuth and app-token setup per tool, the JSON-RPC transport, token scopes, and the planned Workbench for handing work to coding tools.
keywords: mcp, json-rpc, cursor, claude code, claude desktop, codex, vs code, copilot, windsurf, chatgpt, tools, model context protocol, oauth, workbench
sort: 50
related: api-overview,authentication,mcp
---

# MCP endpoint

Bokito exposes its tool registry as an MCP server at `https://your-bokito-host/api/mcp`. External AI tools call exactly the same governed tools that internal agents use: one implementation, two consumers.

## Connect an AI tool

**Settings → Developers** opens on **Connect AI tools**: one row per tool, with its logo and status.

![Connect AI tools on the Developers page](/api/docs/assets/mcp-endpoint/connect-ai-tools.png)
*Each row opens the steps and the config for that tool.*

1. Open **Settings**, then **Developers**.
2. Open the row for your tool. The status reads **Connected** once that tool authorized with OAuth, **OAuth available** when it can sign in through the browser, or **App token** when it needs a token.
3. Pick **OAuth (recommended)** or **App token** at the top of the row. OAuth needs no token: the tool opens the browser, you sign in to Bokito and pick a workspace.
4. Follow the steps and copy or download the config. When you create an app token on the same page, the token snippets fill it in.

## Connect from Cursor

1. Open Cursor Settings, then MCP, and add a server.
2. Paste the URL-only config and save. Cursor opens the browser to sign in.

```json
{
  "mcpServers": {
    "bokito": { "url": "https://your-bokito-host/api/mcp" }
  }
}
```

For a token, add `"headers": { "Authorization": "Bearer bok_..." }` to the `bokito` entry.

## Connect from Claude Code

1. Run the command below, then start Claude Code and type `/mcp`.
2. Choose **bokito**, then **Authenticate**, and sign in to Bokito.

```bash
claude mcp add --transport http --scope user bokito https://your-bokito-host/api/mcp
```

For a token, add `--header "Authorization: Bearer bok_..."` to the command and skip the sign-in.

## Connect from Claude Desktop

1. In Claude, open **Settings**, then **Connectors**, and choose **Add custom connector**.
2. Enter `https://your-bokito-host/api/mcp` and choose **Connect**. Sign in to Bokito and pick a workspace.

Claude connects from Anthropic's servers, so your Bokito host must be reachable from the internet. For a token instead, the row offers a `claude_desktop_config.json` that runs the `mcp-remote` bridge (needs Node.js).

## Connect from Codex CLI

1. Add the server to `~/.codex/config.toml`.
2. Run `codex mcp login bokito` and sign in to Bokito.

```toml
[mcp_servers.bokito]
url = "https://your-bokito-host/api/mcp"
```

For a token, add `bearer_token_env_var = "BOKITO_MCP_TOKEN"` and set that variable where Codex runs. The token stays out of the file.

## Connect from VS Code

1. Create `.vscode/mcp.json`, or run **MCP: Open User Configuration**.
2. Paste the config and choose **Start** above the server. VS Code opens the browser to sign in, and Copilot can use the tools in agent mode.

```json
{
  "servers": {
    "bokito": { "type": "http", "url": "https://your-bokito-host/api/mcp" }
  }
}
```

The token variant adds an `inputs` prompt, so VS Code asks for the token once and keeps it in its secret storage.

## Connect from Windsurf

1. Open the MCP settings in Windsurf and edit `mcp_config.json`.
2. Paste the config and refresh the servers. Windsurf opens the browser to sign in.

```json
{
  "mcpServers": {
    "bokito": { "serverUrl": "https://your-bokito-host/api/mcp" }
  }
}
```

For a token, add `"headers": { "Authorization": "Bearer ${env:BOKITO_MCP_TOKEN}" }` and set the variable.

## Connect from ChatGPT

1. In ChatGPT, open **Settings**, then **Apps**, then **Advanced settings**, and turn on **Developer mode**.
2. Choose **Create app**, enter `https://your-bokito-host/api/mcp`, and pick OAuth.
3. Sign in to Bokito and pick a workspace.

ChatGPT supports OAuth only and connects from OpenAI's servers, so your Bokito host must be reachable from the internet.

## Connected clients

After you authorize, the session appears under **Settings → Developers → Connected MCP clients**, and the tool's row reads **Connected**. Choose **Revoke** to cut access immediately; the tool must authorize again. Refresh-token reuse also revokes the whole session family.

## Transport

MCP Streamable HTTP: JSON-RPC 2.0 over POST, plus GET with `Accept: text/event-stream` for the idle SSE probe. Clients authenticate with an OAuth access token (after the browser flow) or with an app token. Responses may include `Mcp-Session-Id`.

```
POST https://your-bokito-host/api/mcp
Authorization: Bearer …
Content-Type: application/json
```

Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`, plus `resources/list`, `resources/read`, `prompts/list` and `prompts/get` for IDE discovery. Tools advertise MCP annotations (`readOnlyHint`, `destructiveHint`). Resources serve product-help markdown.

## App token fallback

For CI or scripts that cannot open a browser, create a token under **Settings → Developers → App tokens** and send it as `Authorization: Bearer bok_…`. The **Any MCP client** row shows a ready `curl` call.

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

OAuth consent and app token scopes name tool categories: a scoped credential only sees and calls tools in those categories (empty scopes = all tools). Independent of scopes, every call runs through the workspace policy engine with API-level trust - a tool that requires approval raises a decision request instead of executing. External access never bypasses governance.

## Hand work to a coding tool (planned)

The **Hand work to a coding tool** section on the same page lists the coding tools Bokito will hand work to: Cursor Cloud Agents, Claude Managed Agents, Devin, GitHub Copilot cloud agent, and Claude Code in your own GitHub Actions. Each row reads **Not available yet**.

When this ships, an agent proposes the job as a decision in the conversation. After you approve, the tool works on your repository, its progress and questions appear in the same thread, and the pull request lands on the project. You connect your own account for each tool.
