# Integrations platform — Xano deploy checklist

Apply tables from `xano-patches/v1-platform-tables.md` (integration_* tables, `projects.repo_binding_id`, `index_chunks.connection_id`).

## Tables and seed

1. Create `integration_hosts` and add `host_id` on `integration_providers`.
2. Create `integration_connections`, `integration_oauth_states`, `integration_bindings` (see platform-tables).
3. Seed hosts per `integration-hosts-seed.md`.
4. **Upload brand logos** in Xano for each host row (`logo`, optional `logo_dark`).
5. Set each provider `host_id` per `integration-providers-seed.md`.
6. Seed `integration_providers` per `integration-providers-seed.md`.
7. GitHub OAuth state (if using dedicated GitHub flow): table `github_oauth_states` (see platform-tables).
8. Legacy GitHub connections (optional during migration): `github_connections`.

**Developer onboarding:** `apps/dashboard/docs/INTEGRATIONS.md` (per-provider checklists and verify steps).

## Deploy API patches (integrations API group)

Patches live under `xano-patches/v1/`. Push via Xano UI, VS Code extension, or:

```bash
node scripts/push-xano-api.mjs <api_id> xano-patches/v1/<file>.xs
```

Requires root `.env`: `XANO_METADATA_API_KEY`, optional `XANO_META_BASE_URL`.

### Platform (generic)

| File | Endpoint |
|------|----------|
| integrations-providers-list.xs | GET integrations/providers |
| integrations-connections-list.xs | GET integrations/connections |
| integrations-connections-create.xs | POST integrations/connections |
| integrations-connections-delete.xs | DELETE integrations/connections/{connection_id} |
| integrations-oauth-start.xs | GET integrations/oauth/start |
| integrations-oauth-callback.xs | GET integrations/oauth/callback |
| integrations-connections-resources.xs | GET integrations/connections/{connection_id}/resources |
| integrations-worker-credentials.xs | POST integrations/worker/credentials |
| integrations-mcp-tenant-bindings.xs | GET integrations/mcp/bindings |
| integrations-mcp-install.xs | POST integrations/mcp/install |

### Doc worker (block-based PKB)

| File | Endpoint |
|------|----------|
| integrations-doc-worker-blocks.xs | POST integrations/doc/worker/blocks |
| integrations-doc-worker-reindex-page.xs | POST integrations/doc/worker/reindex-page |
| integrations-doc-worker-tree.xs | POST integrations/doc/worker/tree |

### GitHub (repository OAuth + repos)

| File | Endpoint |
|------|----------|
| integrations-github-oauth-start.xs | GET github/oauth/start |
| integrations-github-oauth-callback.xs | GET github/oauth/callback |
| integrations-github-connections-list.xs | GET github/connections |
| integrations-github-connection-get.xs | GET github/connection |
| integrations-github-connection-delete.xs | DELETE github/connection |
| integrations-github-repos-list.xs | GET github/repos |
| integrations-github-branches.xs | GET github/repos/{owner}/{repo}/branches |
| integrations-github-worker-token.xs | POST github/worker/token |
| integrations-github-worker-index-status.xs | POST github/worker/index-status |

### Workforce (repo binding + index)

| File | Endpoint |
|------|----------|
| workforce-projects-repo-patch.xs | PATCH projects/{id}/repo |
| workforce-index-chunks.xs | optional connection_id |
| workforce-index-search.xs | optional source_types filter |

### Email (inbox OAuth — separate from unified connections table)

Deployed in the same integrations API group but not listed in platform CRUD above:

- `GET email/oauth/start`, `GET email/outlook/oauth/start`, `GET email/google/oauth/start`
- `GET oauth/microsoft/callback`, `GET oauth/google/callback`
- `GET email/connections`, etc.

See `BOKITO_KNOWLEDGE.md` inbox/email sections.

## OAuth callback URLs

- **GitHub dedicated:** `GET /github/oauth/callback` — set `GITHUB_OAUTH_CALLBACK_URL` to this exact URL in GitHub app and Xano env.
- **Generic platform:** `GET /integrations/oauth/callback` — alternative; GitHub branch in `integrations-oauth-callback.xs` dual-writes legacy tables when used.

Marketplace UI uses **`/github/oauth/start`** for GitHub (`oauthStrategy: github` in frontend registry). New repo OAuth providers can use **`/integrations/oauth/start`** after adding a provider branch in `integrations-oauth-start.xs` and `integrations-oauth-callback.xs`, then set `oauthStrategy: platform` in `apps/dashboard/src/lib/integrations/registry.ts`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `GITHUB_OAUTH_CLIENT_ID` | GitHub authorize + token |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub callback |
| `GITHUB_OAUTH_CALLBACK_URL` | Must match registered redirect URI |
| `MICROSOFT_CLIENT_ID` / `SECRET` / `REDIRECT_URI` | Outlook |
| `GOOGLE_CLIENT_ID` / `SECRET` / `REDIRECT_URI` | Gmail |
| `WORKER_INBOUND_SECRET` | Worker credential endpoints |

## Post-deploy verification

- [ ] `GET integrations/providers` (user auth) returns providers with host logos.
- [ ] `GET github/oauth/start?return_url=...` returns 401 without token, 200 + `authorize_url` with valid session (not 404).
- [ ] `db.add github_oauth_states` works (table exists; API must not use empty table name).
- [ ] GitHub OAuth round-trip creates rows in `integration_connections` (and `github_connections` if dual-write enabled).
- [ ] `POST integrations/mcp/install` creates connection + `mcp_server` binding.
- [ ] `PATCH projects/{id}/repo` with `connection_id` creates `project_repo` binding.
- [ ] `POST integrations/worker/credentials` returns token for active GitHub connection.
- [ ] Marketplace: five cards load; Koppelen / MCP install / inbox OAuth smoke-tested per `apps/dashboard/docs/INTEGRATIONS.md`.
