---
title: API overview
intro: The developer surfaces Bokito exposes and which one to use for what.
description: Overview of the Bokito developer platform: the public REST API, webhooks, the MCP endpoint and the embeddable chat widget, with links to each guide.
keywords: api, rest, developers, overview, integration
sort: 10
related: authentication,api-signals,webhooks,mcp-endpoint
---

# API overview

Bokito exposes four developer surfaces. All of them are governed by the same tenant isolation and token model.

| Surface | Use it to | Guide |
| --- | --- | --- |
| REST API v1 | Read signals and push external events into the inbox | [Signals API](/docs/developers/api-signals) |
| Webhooks | Get notified when signals or decisions change | [Webhooks](/docs/developers/webhooks) |
| MCP endpoint | Call workspace tools from MCP clients like Cursor | [MCP endpoint](/docs/developers/mcp-endpoint) |
| Chat widget | Embed Bokito chat on your own site | [Widget embed](/docs/developers/widget-embed) |

## Base URL

All HTTP APIs live under your Bokito origin with the `/api` prefix:

```
https://your-bokito-host/api
```

The REST API is versioned under `/api/public/v1`. The interactive reference for every public endpoint is at [/docs/api](/docs/api), generated from the live OpenAPI schema at `/api/docs/openapi.json`.

## Authentication in one line

Create an API token (prefix `bok_`) under **Settings, then Developers**, and send it as a bearer token:

```bash
curl -H "Authorization: Bearer bok_..." https://your-bokito-host/api/public/v1/signals
```

Scopes restrict what a token may do. Details in [Authentication](/docs/developers/authentication).

## Design notes

- The REST surface is intentionally small: signals in, signals out. Most richer behavior (running tools, querying knowledge) goes through the MCP endpoint, which exposes the same governed tools internal agents use.
- Everything is tenant-scoped by the token. There is no cross-tenant access.
- Rate limits apply per client IP; see [Rate limits](/docs/developers/rate-limits).
