# Multi-Tenant Livechat Backend Contract

This file defines the backend contract expected by the Bokito chat widget (`apps/chat-widget/src/widget-main.ts`, built to `dist/bokito-chat.js`) for tenant-aware auth and user-scoped chat data.

## Session start

`POST /api/livechat/session/start`

Request body (new fields are optional):

```json
{
  "agent_slug": "demo",
  "customer_id": "optional-existing-customer-id",
  "identity_token": "optional-jwt",
  "tenant_subdomain": "optional-host-subdomain",
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
    "allow_registration": true,
    "forgot_password_url": "https://...",
    "registration_url": "https://...",
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

## Widget login fallback

- `POST /api/livechat/auth/login`
  - Input: `{ email, password, agent_slug, session_token? }`
  - Output: same shape as `session/start` (including `session_token`, `user`, `tenant`, `preferences`)
- `POST /api/livechat/auth/logout`
- `POST /api/livechat/auth/forgot-password`
- `POST /api/livechat/auth/register`

## User scoped chat data

- `GET /api/livechat/user/conversations?per_page=10`
- `GET /api/livechat/user/preferences`
- `PATCH /api/livechat/user/preferences`
  - Input: `{ "preferences": { ...partial_patch } }`

If `user/*` endpoints are unavailable, the widget falls back to `customer/*` endpoints.

## Stream context contract

The widget includes the following additional fields in stream requests:

- `user_context`
- `tenant_context`
- `mcp_server_ids`

Server must enforce tenant isolation and ignore unknown server IDs.
