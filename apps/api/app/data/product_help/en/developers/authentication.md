---
title: Authentication
intro: API tokens, scopes and how to send credentials.
description: Create Bokito API tokens in Settings, Developers, choose Workspace API and agent scopes, and rotate or revoke them.
keywords: authentication, api token, bearer, scopes, developers, security
sort: 20
related: api-overview,api-signals,mcp-endpoint
---

# Authentication

Every developer surface authenticates with workspace API tokens. Owners and admins create and revoke them under **Settings**, then **Developers**.

## Create a token

1. Open **Settings**, then **Developers**.
2. Under **App tokens**, choose **New token**. Enter a **Token name** (for example `staging-crm`).
3. Under **Access (empty = everything)** pick scopes. Leave them all off only when the integration truly needs **Full access**.
4. Choose **Create token**. The plaintext value starts with `bok_` and is shown once. Copy it, or use **Copy curl example** for `GET /api/public/v1/signals`. Choose **I have copied it** when you are done. Bokito keeps only a hash; the list later shows a prefix such as `bok_ab12…` plus **last used** or **never used**. Hide revoked tokens unless you need the history.

## Send it

All APIs take the token as a bearer credential:

```
Authorization: Bearer bok_your_token_here
```

Requests without a valid token get `401 Unauthorized`.

## Scopes

The create form groups scopes:

- **Workspace API:** `signals:read` reads conversations and messages. `signals:write` creates conversations.
- **What agents and apps may do:** `messaging`, `workspace`, `projects`, `agents`, `delegation`, `channels`, `triggers`, `integrations`, `govern`. The token can only list and call tools in the groups you tick. `agents` is for configuring the workforce, `delegation` for handing work to it.

An empty scope list is full access. Prefer one token per integration with only the scopes it needs. A request outside those scopes gets `403 Forbidden`.

## Revoke and rotate

1. Find the token in the Developers list.
2. To rotate, create the new token first, switch the integration, then revoke the old one.
3. Revoke stops the token immediately. Last-used time makes stale tokens easy to spot.

## Rules of thumb

- Never put a `bok_` token in frontend code or a public repository. The [chat widget](/docs/developers/widget-embed) is the only thing designed to run in a browser, and it does not use API tokens.
- Use separate tokens per environment (staging, production) so a leak has a small blast radius.
