# Integrations platform — Xano deploy checklist

Apply tables from `xano-patches/v1-platform-tables.md` (integration_* tables, `projects.repo_binding_id`, `index_chunks.connection_id`).

1. Create `integration_hosts` and add `host_id` on `integration_providers`.
2. Seed hosts per `integration-hosts-seed.md`.
3. **Upload brand logos** in Xano for each host row (`logo`, optional `logo_dark`).
4. Set each provider `host_id` per `integration-providers-seed.md`.
5. Seed `integration_providers` per `integration-providers-seed.md`.

Deploy API patches (integrations API group):

| File | Endpoint |
|------|----------|
| integrations-providers-list.xs | GET integrations/providers |
| integrations-connections-list.xs | GET integrations/connections |
| integrations-connections-create.xs | POST integrations/connections |
| integrations-connections-delete.xs | DELETE integrations/connections/{connection_id} |
| integrations-oauth-start.xs | GET integrations/oauth/start |
| integrations-oauth-callback.xs | GET integrations/oauth/callback |
| integrations-connections-resources.xs | GET integrations/connections/{id}/resources |
| integrations-worker-credentials.xs | POST integrations/worker/credentials |
| integrations-mcp-bindings.xs | GET integrations/mcp/bindings |
| integrations-mcp-install.xs | POST integrations/mcp/install |
| integrations-github-connections-list.xs | GET github/connections |
| integrations-github-*.xs (updated) | GitHub OAuth + repos + worker |
| workforce-projects-repo-patch.xs | PATCH projects/{id}/repo |
| workforce-index-chunks.xs | optional connection_id |
| workforce-index-search.xs | optional source_types filter |

Set `GITHUB_OAUTH_CALLBACK_URL` to the generic callback URL if using `integrations/oauth/callback`, or keep existing GitHub callback URL (both flows dual-write state).
