---
title: Authentication
intro: API tokens, scopes and how to send credentials.
description: How to create and use Bokito API tokens (bok_ prefix), what scopes do on the REST API and MCP endpoint, and how revocation works.
keywords: authentication, api token, bearer, scopes, security
sort: 20
related: api-overview,api-signals,mcp-endpoint
---

# Authentication

Every developer surface authenticates with workspace API tokens. Tokens are created and revoked by workspace owners and admins.

## Create a token

Go to **Settings, then Developers** and create a token. The plaintext value - it starts with `bok_` - is shown once at creation. Store it in a secret manager; Bokito only keeps a hash.

## Send it

All APIs take the token as a bearer credential:

```
Authorization: Bearer bok_your_token_here
```

Requests without a valid token get `401 Unauthorized`.

## Scopes

Scopes restrict what a token may do:

- **REST API:** `signals:read` allows reading signals and messages, `signals:write` allows creating signals.
- **MCP endpoint:** scopes name tool categories; the token can only list and call tools in those categories.

A token with an empty scope list has full access. Prefer scoped tokens: one token per integration, with only the scopes it needs. A request outside the token's scopes gets `403 Forbidden`.

## Revocation and rotation

Revoke a token under **Settings, then Developers**; it stops working immediately. To rotate, create the new token first, switch your integration over, then revoke the old one. Each token shows when it was last used, which makes stale tokens easy to spot.

## Rules of thumb

- Never put a `bok_` token in frontend code or a public repository. The [chat widget](/docs/developers/widget-embed) is the only thing designed to run in a browser, and it does not use API tokens.
- Use separate tokens per environment (staging, production) so a leak has a small blast radius.
