# integration_hosts seed (apply in Xano after creating table)

Use fixed UUIDs. **Upload an official logo** into each row's `logo` image field in Xano (and optional `logo_dark`) before production if required by brand guidelines.

**Portal fallbacks:** `apps/dashboard/public/brands/` (wired via `brand-assets.ts`) supplies SVG logos for every host slug below when Xano images are empty.

| slug | id | initials | brand_color |
|------|-----|----------|-------------|
| github | `b2000001-0000-4000-8000-000000000001` | GH | `#24292f` |
| microsoft | `b2000001-0000-4000-8000-000000000002` | MS | `#0078d4` |
| google | `b2000001-0000-4000-8000-000000000003` | GO | `#4285f4` |
| bjorn_lunden | `b2000001-0000-4000-8000-000000000004` | BL | `#0f766e` |
| custom | `b2000001-0000-4000-8000-000000000005` | MC | `#475569` |
| smtp | `b2000001-0000-4000-8000-000000000006` | SM | `#64748b` |
| notion | `b2000001-0000-4000-8000-000000000007` | NO | `#000000` |
| linear | `b2000001-0000-4000-8000-000000000008` | LN | `#5e6ad2` |
| atlassian | `b2000001-0000-4000-8000-000000000009` | AT | `#0052cc` |
| slack | `b2000001-0000-4000-8000-00000000000a` | SL | `#4a154b` |
| asana | `b2000001-0000-4000-8000-00000000000b` | AS | `#f06a6a` |
| clickup | `b2000001-0000-4000-8000-00000000000c` | CU | `#7b68ee` |
| sentry | `b2000001-0000-4000-8000-00000000000d` | SE | `#362d59` |
| stripe | `b2000001-0000-4000-8000-00000000000e` | ST | `#635bff` |
| shopify | `b2000001-0000-4000-8000-00000000000f` | SH | `#96bf48` |

Example row (github):

- name: GitHub
- website_url: `https://github.com`
- sort_order: 10

Remote MCP hosts use sort_order 100+.

## Link providers to hosts

After seeding hosts, set `integration_providers.host_id`:

| provider slug | host_id |
|---------------|---------|
| github | `b2000001-0000-4000-8000-000000000001` |
| outlook | `b2000001-0000-4000-8000-000000000002` |
| gmail | `b2000001-0000-4000-8000-000000000003` |
| bjorn_lunden_mcp | `b2000001-0000-4000-8000-000000000004` |
| custom_mcp | `b2000001-0000-4000-8000-000000000005` |
| notion_mcp | `b2000001-0000-4000-8000-000000000007` |
| linear_mcp | `b2000001-0000-4000-8000-000000000008` |
| atlassian_mcp | `b2000001-0000-4000-8000-000000000009` |
| slack_mcp | `b2000001-0000-4000-8000-00000000000a` |
| asana_mcp | `b2000001-0000-4000-8000-00000000000b` |
| clickup_mcp | `b2000001-0000-4000-8000-00000000000c` |
| sentry_mcp | `b2000001-0000-4000-8000-00000000000d` |
| stripe_mcp | `b2000001-0000-4000-8000-00000000000e` |
| github_mcp | `b2000001-0000-4000-8000-000000000001` |
| microsoft_graph_mcp | `b2000001-0000-4000-8000-000000000002` |
| shopify_mcp | `b2000001-0000-4000-8000-00000000000f` |
