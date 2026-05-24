# integration_providers seed (apply in Xano after creating table)

Use fixed UUIDs so patches and frontend can reference slugs only.

| slug | id | auth_type | status |
|------|-----|-----------|--------|
| github | `a1000001-0000-4000-8000-000000000001` | oauth2 | available |
| outlook | `a1000001-0000-4000-8000-000000000002` | oauth2 | available |
| gmail | `a1000001-0000-4000-8000-000000000003` | oauth2 | available |
| bjorn_lunden_mcp | `a1000001-0000-4000-8000-000000000004` | api_key | available |
| custom_mcp | `a1000001-0000-4000-8000-000000000005` | api_key | available |

Set `host_id` per row after seeding `integration_hosts` (see `integration-hosts-seed.md`). `logo_meta` remains a legacy fallback when host images are not uploaded yet.

Example row (github):

- name: GitHub
- description: Connect repositories for code indexing and agent context.
- category: Ontwikkeling
- capabilities: `{"repo_index":true}`
- oauth_config_key: `GITHUB_OAUTH`
- logo_meta: `{"initials":"GH","color":"#24292f"}`

outlook / gmail: capabilities `{"inbox_sync":true}`

bjorn_lunden_mcp: capabilities `{"mcp_tools":true}`

custom_mcp:

- name: Custom MCP
- description: Connect any external MCP server by URL and API key or bearer token.
- category: Productiviteit
- capabilities: `{"mcp_tools":true,"custom":true}`
- logo_meta: `{"initials":"MC","color":"#475569"}`
- host_id: `b2000001-0000-4000-8000-000000000005`

Provider `host_id` reference:

| provider slug | host_id |
|---------------|---------|
| github | `b2000001-0000-4000-8000-000000000001` |
| outlook | `b2000001-0000-4000-8000-000000000002` |
| gmail | `b2000001-0000-4000-8000-000000000003` |
| bjorn_lunden_mcp | `b2000001-0000-4000-8000-000000000004` |
| custom_mcp | `b2000001-0000-4000-8000-000000000005` |
