---
title: V2 for developers: API, MCP and OAuth
intro: One tool registry behind the REST API, the MCP endpoint and the command palette; the policy is applied once.
description: Integrate with Bokito V2. API tokens with read, write and tools scopes, the REST API and OpenAPI, the MCP endpoint with OAuth 2.1 discovery and consent, webhooks for triggers and the workbench, and the modules API.
keywords: v2, api, rest, openapi, token, scopes, mcp, oauth, pkce, dynamic client registration, consent, webhook, workbench, modules
sort: 70
related: v2-govern,v2-connections,v2-knowledge
---

# V2 for developers

Everything the V2 dashboard does goes through `https://v2.bokito.ai/api`. Agents, the command palette, the REST API and the MCP endpoint all call the same tool registry, so the workspace policy in Govern is applied once and the same way for every caller.

## API tokens

Tokens start with `bok2_` and are shown once.

1. In the dashboard open **Govern**, **API tokens**, **New token** (admin role required).
2. Pick scopes: `read` for GET requests, `write` for mutations, `tools` for `POST /api/tools/execute` and `/api/mcp`. No scopes means all three.
3. Send the token as `Authorization: Bearer bok2_...`. The token acts with the role of the operator who created it and under the workspace policy; consequential tools raise a Decision instead of executing.
4. A missing scope returns `403` with `WWW-Authenticate: Bearer error="insufficient_scope"`.

## REST API

The interactive reference lives at `https://v2.bokito.ai/api/docs`; the schema at `/api/openapi.json`.

```
GET  /api/conversations?queue=attention
GET  /api/conversations/{id}/messages
POST /api/conversations/{id}/reply        {"body": "..."}      -> ToolOutcome
POST /api/conversations/{id}/notes        {"body": "..."}
POST /api/conversations/{id}/status       {"status": "closed"}
GET  /api/decisions                        open decisions
POST /api/decisions/{id}/resolve           {"option": "approve", "note": "..."}
GET  /api/tools                            tools you may call
POST /api/tools/execute                    {"name": "...", "args": {...}}
GET  /api/usage?since=2026-09-01T00:00:00Z cost and EU share
GET  /api/outcomes                         resolved-by-agent summary
```

Mutations that map to a tool return a `ToolOutcome`: `status` is `done`, `decision` (with `decision_id`) or `denied` (with `reason`). Poll or subscribe to the decision instead of retrying.

## MCP endpoint

`https://v2.bokito.ai/api/mcp` is an MCP Streamable HTTP server (JSON-RPC 2.0, protocol `2025-06-18`).

- `tools/list` returns the tools of the workspace at trust level `api`, including installed module tools, with `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` annotations.
- `tools/call` returns `content`, `structuredContent` and `isError`. A tool that needs approval answers with `status: decision` and a hint; an operator approves in the thread.
- `resources/list` exposes Knowledge documents as `bokito://docs/{path}`.
- `prompts/list` offers `workspace_brief` and `draft_reply`.

Paste only the URL into your client:

```json
{ "mcpServers": { "bokito-v2": { "url": "https://v2.bokito.ai/api/mcp" } } }
```

## OAuth 2.1 for MCP clients

Clients that support OAuth discover the authorization server themselves.

1. An unauthenticated call to `/api/mcp` returns `401` with `WWW-Authenticate: Bearer resource_metadata="https://v2.bokito.ai/.well-known/oauth-protected-resource/api/mcp"`.
2. The client reads `/.well-known/oauth-authorization-server/api/oauth` and registers with `POST /api/oauth/register` (RFC 7591, client ids start with `mcp_`).
3. `GET /api/oauth/authorize` with PKCE S256 redirects the operator to `/oauth/consent`, where the requested access (**Read**, **Write**, **Run tools**) is shown and approved with **Allow**.
4. `POST /api/oauth/token` exchanges the code for a `bok2o_` access token (1 hour) and a `bok2r_` refresh token (30 days, rotated on every use). `POST /api/oauth/revoke` revokes.
5. Connected clients appear under **Settings**, **Developers**, **Connected MCP clients**. **Disconnect** revokes their tokens immediately.

## Webhooks

- **Trigger webhooks**: create a trigger of kind **Webhook** under **Work**, **Triggers**. Send `POST /api/hooks/{id}` with header `X-Bokito-Secret: <secret>` and a JSON body; the body is handed to the playbook or agent.
- **Workbench webhooks**: `POST /api/hooks/workbench/{public_key}` is registered by Bokito with each job. The body is verified with `X-Webhook-Signature: sha256=<hmac>` over the raw body; invalid signatures return `401 invalid_signature`.

## Modules API

```
GET    /api/modules                        catalog with install state
POST   /api/modules/{slug}/install         {"connection_id": "...", "settings": {...}}
PATCH  /api/modules/{slug}                 change settings or connection
DELETE /api/modules/{slug}                 uninstall (disable, keep history)
```

Module tools are hidden and denied (`403 module_not_installed`) on every surface until the module is installed.

## What to do next

- Decide what API clients may do without asking: [/docs/v2/v2-govern](/docs/v2/v2-govern)
- Connect the systems the tools talk to: [/docs/v2/v2-connections](/docs/v2/v2-connections)
