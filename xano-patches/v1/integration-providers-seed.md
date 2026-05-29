# integration_providers seed (apply in Xano after creating table)

Use fixed UUIDs so patches and frontend can reference slugs only.

Apply new columns on `integration_providers` first: `mcp_remote_url`, `mcp_transport`, `oauth_profile`. Extend `auth_type` with `mcp_remote_oauth`.

Extend `integration_oauth_states` with `code_verifier`, `oauth_client_id`, `mcp_remote_url`, `oauth_profile`.

## Core providers

| slug | id | auth_type | status |
|------|-----|-----------|--------|
| github | `a1000001-0000-4000-8000-000000000001` | oauth2 | available |
| outlook | `a1000001-0000-4000-8000-000000000002` | oauth2 | available |
| gmail | `a1000001-0000-4000-8000-000000000003` | oauth2 | available |
| bjorn_lunden_mcp | `a1000001-0000-4000-8000-000000000004` | api_key | available |
| custom_mcp | `a1000001-0000-4000-8000-000000000005` | api_key | available |

## Remote MCP OAuth providers (marketplace)

| slug | id | auth_type | status | mcp_remote_url |
|------|-----|-----------|--------|----------------|
| notion_mcp | `a1000001-0000-4000-8000-000000000010` | mcp_remote_oauth | coming_soon | `https://mcp.notion.com/mcp` |
| linear_mcp | `a1000001-0000-4000-8000-000000000011` | mcp_remote_oauth | coming_soon | `https://mcp.linear.app/mcp` |
| atlassian_mcp | `a1000001-0000-4000-8000-000000000012` | mcp_remote_oauth | coming_soon | `https://mcp.atlassian.com/v1/mcp/authv2` |
| slack_mcp | `a1000001-0000-4000-8000-000000000013` | mcp_remote_oauth | coming_soon | `https://mcp.slack.com/mcp` |
| asana_mcp | `a1000001-0000-4000-8000-000000000014` | mcp_remote_oauth | coming_soon | `https://mcp.asana.com/v2/mcp` |
| clickup_mcp | `a1000001-0000-4000-8000-000000000015` | mcp_remote_oauth | coming_soon | `https://mcp.clickup.com/mcp` |
| sentry_mcp | `a1000001-0000-4000-8000-000000000016` | mcp_remote_oauth | coming_soon | `https://mcp.sentry.dev/mcp` |
| stripe_mcp | `a1000001-0000-4000-8000-000000000017` | mcp_remote_oauth | coming_soon | `https://mcp.stripe.com` |
| github_mcp | `a1000001-0000-4000-8000-000000000018` | mcp_remote_oauth | coming_soon | `https://api.githubcopilot.com/mcp/` |
| microsoft_graph_mcp | `a1000001-0000-4000-8000-000000000019` | mcp_remote_oauth | coming_soon | `https://mcp.svc.cloud.microsoft/enterprise` |
| shopify_mcp | `a1000001-0000-4000-8000-00000000001a` | oauth2 | coming_soon | (per-store: `{shop}.myshopify.com`; admin via Dev Dashboard client credentials) |

Set `host_id` per row after seeding `integration_hosts` (see `integration-hosts-seed.md`). Set `mcp_transport` = `streamable_http` for all remote MCP rows.

### oauth_config_key (Xano env prefix)

| slug | oauth_config_key | Required env vars |
|------|------------------|-------------------|
| notion_mcp | `NOTION_MCP` | `NOTION_MCP_CLIENT_ID`, `NOTION_MCP_CLIENT_SECRET`, `NOTION_MCP_REDIRECT_URI` (or DCR) |
| linear_mcp | `LINEAR_MCP` | DCR or static client vars |
| atlassian_mcp | `ATLASSIAN_MCP` | OAuth app + redirect |
| slack_mcp | `SLACK_MCP` | **Static app required** (no DCR): `SLACK_MCP_CLIENT_ID`, `SLACK_MCP_CLIENT_SECRET`, `SLACK_MCP_REDIRECT_URI` |
| asana_mcp | `ASANA_MCP` | **Pre-registered MCP app**: `ASANA_MCP_CLIENT_ID`, `ASANA_MCP_CLIENT_SECRET`, `ASANA_MCP_REDIRECT_URI` |
| clickup_mcp | `CLICKUP_MCP` | OAuth app + redirect |
| sentry_mcp | `SENTRY_MCP` | OAuth app + redirect |
| stripe_mcp | `STRIPE_MCP` | OAuth app + redirect |
| github_mcp | `GITHUB_MCP` | OAuth app + redirect (separate from `GITHUB_OAUTH_*` repo flow) |
| microsoft_graph_mcp | `MICROSOFT_GRAPH_MCP` | Entra app + `MICROSOFT_GRAPH_MCP_*` |
| shopify_mcp | `SHOPIFY_MCP` | Per-tenant: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, shop domain; storefront MCP at `https://{shop}.myshopify.com/api/mcp` (no global OAuth URL) |

Platform runtime also requires:

- `MCP_OAUTH_CALLBACK_URL` — must match Xano public callback `GET /integrations/mcp/oauth/callback`
- `RUNTIME_INTERNAL_URL` — base URL for runtime (Xano calls `/internal/mcp/oauth/*`)
- `WORKER_INBOUND_SECRET` — shared secret for runtime internal routes

### oauth_profile examples (JSON column)

**DCR-friendly (Notion, Linear, Atlassian, ClickUp, Sentry, Stripe):**

```json
{"supports_dcr":true,"client_registration_mode":"dcr"}
```

**Slack (static client, no DCR):**

```json
{
  "supports_dcr": false,
  "client_registration_mode": "static",
  "authorization_endpoint": "https://slack.com/oauth/v2_user/authorize",
  "token_endpoint": "https://slack.com/api/oauth.v2.user.access"
}
```

**Asana v2 (static + resource indicator):**

```json
{
  "supports_dcr": false,
  "client_registration_mode": "static",
  "resource_parameter": "https://mcp.asana.com/v2",
  "authorization_endpoint": "https://app.asana.com/-/oauth_authorize",
  "token_endpoint": "https://app.asana.com/-/oauth_token"
}
```

**Microsoft Graph MCP Enterprise (preview):**

```json
{
  "supports_dcr": false,
  "client_registration_mode": "static",
  "scopes": ["api://e8c77dc2-69b3-43f4-bc51-3213c9d915b4/.default"],
  "authorization_endpoint": "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
  "token_endpoint": "https://login.microsoftonline.com/organizations/oauth2/v2.0/token"
}
```

### capabilities

All remote MCP rows:

```json
{"mcp_tools":true,"remote_mcp":true}
```

### Example row (notion_mcp)

- name: Notion
- description: Connect Notion workspaces for docs and knowledge via MCP.
- category: Productiviteit
- sort_order: 110
- logo_meta: `{"initials":"NO","color":"#000000"}`

outlook / gmail: capabilities `{"inbox_sync":true}`

bjorn_lunden_mcp: capabilities `{"mcp_tools":true}`

custom_mcp:

- name: Custom MCP
- description: Connect any external MCP server by URL and API key or bearer token.
- category: Productiviteit
- capabilities: `{"mcp_tools":true,"custom":true}`

Set provider `status` to `available` only after OAuth env vars and runtime `MCP_OAUTH_CALLBACK_URL` are configured.
