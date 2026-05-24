# integration_hosts seed (apply in Xano after creating table)

Use fixed UUIDs. **Upload an official logo** into each row’s `logo` image field in Xano (and optional `logo_dark`) before production.

| slug | id | initials | brand_color |
|------|-----|----------|-------------|
| github | `b2000001-0000-4000-8000-000000000001` | GH | `#24292f` |
| microsoft | `b2000001-0000-4000-8000-000000000002` | MS | `#0078d4` |
| google | `b2000001-0000-4000-8000-000000000003` | GO | `#4285f4` |
| bjorn_lunden | `b2000001-0000-4000-8000-000000000004` | BL | `#0f766e` |
| custom | `b2000001-0000-4000-8000-000000000005` | MC | `#475569` |
| smtp | `b2000001-0000-4000-8000-000000000006` | SM | `#64748b` |

Example row (github):

- name: GitHub
- website_url: `https://github.com`
- sort_order: 10

## Link providers to hosts

After seeding hosts, set `integration_providers.host_id`:

| provider slug | host_id |
|---------------|---------|
| github | `b2000001-0000-4000-8000-000000000001` |
| outlook | `b2000001-0000-4000-8000-000000000002` |
| gmail | `b2000001-0000-4000-8000-000000000003` |
| bjorn_lunden_mcp | `b2000001-0000-4000-8000-000000000004` |
| custom_mcp | `b2000001-0000-4000-8000-000000000005` |
