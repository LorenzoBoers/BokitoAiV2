# Multi-Tenant Livechat Backend Contract

This file defines the backend contract expected by the Bokito chat widget (`apps/chat-widget/src/widget-main.ts`, built to `dist/bokito-chat.js`) for tenant-aware auth and user-scoped chat data.

## Session start

`POST /api/livechat/session/start`

Request body (new fields are optional):

```json
{
  "agent_slug": "assistant",
  "customer_id": "optional-existing-customer-id",
  "identity_token": "optional-jwt",
  "tenant_subdomain": "explicit data-tenant or host-subdomain",
  "host_auth_token": "optional-host-cookie-token",
  "auth_mode": "anonymous|optional|required",
  "auth_cookie_name": "optional_cookie_name"
}
```

Response:

```json
{
  "session_token": "token",
  "identity_type": "anonymous|authenticated",
  "customer_id": "optional",
  "expires_in": 1800,
  "agent_config": {
    "auth_mode": "required",
    "auth_cookie_name": "host_session",
    "auth_token_validation_url": "https://...",
    "login_url": "https://host-platform/signin",
    "mcp_servers": []
  },
  "user": {
    "id": "usr_123",
    "email": "user@example.com",
    "name": "User Name"
  },
  "tenant": {
    "id": "org_uuid",
    "slug": "tenant-slug",
    "name": "Tenant Name"
  },
  "mcp_servers": [
    {
      "server_id": "crm",
      "name": "CRM MCP"
    }
  ],
  "preferences": {
    "theme": "system",
    "sound_effects": true,
    "sound_notifications": true,
    "hidden_conversations": []
  }
}
```

## Sign-in handling

The widget never collects credentials; the host platform owns authentication. When `auth_mode` is `required` and no valid token is available, the widget shows a "Sign in required" panel linking to `agent_config.login_url` (or `data-signin-url`). Tokens arrive via `host_auth_token` (cookie), `data-auth-token`, or `window.BokitoConfig.getAuthToken`.

## Conversations

All conversation endpoints require `Authorization: Bearer <session_token>`. Ownership is enforced server-side: logged-in users see their own assistant threads; anonymous visitors see threads linked to the `customer_id` embedded in their session token.

- `POST /api/livechat/conversation` — creates (or reuses) a widget thread. Returns a flat shape: `{ "conversation_id": "<id>", "id": "<id>", "session_token": "<token>" }`. The widget reads `conversation_id` (with `id` as fallback). For anonymous sessions the backend links the thread to the token's `customer_id` so history survives page reloads.
- `GET /api/livechat/conversation/{id}` — basic thread info: `{ id, conversation_id, title, updated_at }`. 404 when the caller does not own the thread.
- `GET /api/livechat/conversation/{id}/messages?per_page=100` — ordered messages: `{ items: [{ id, sender_type: "customer"|"ai", message_content, created_at, attachments }] }`.

Timestamps are naive ISO strings in UTC (no `Z` suffix); the widget normalizes them before parsing.

## User scoped chat data

- `GET /api/livechat/user/conversations?per_page=10` (logged-in users)
- `GET /api/livechat/customer/conversations?per_page=10` (anonymous visitors, keyed by `customer_id`)
- `GET /api/livechat/user/preferences`
- `PATCH /api/livechat/user/preferences`
  - Input: `{ "preferences": { ...partial_patch } }`

## Attachments

- `POST /api/livechat/attachment` — multipart `file` (images only, max 10MB), `Authorization: Bearer <session_token>`; returns `{ id, url, name, mime, size }`. Attachment refs (`{ id, url }`) are passed in the `attachments` array of `stream-chat`.

## Stream context contract

The widget includes the following additional fields in stream requests:

- `user_context`
- `tenant_context`
- `mcp_server_ids`

Server must enforce tenant isolation and ignore unknown server IDs.
