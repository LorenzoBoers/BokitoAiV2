# Integrations

Last updated: May 2026

The integrations module connects external services: communication (email), source control (GitHub), and MCP servers. Deep developer guide: [`apps/dashboard/docs/INTEGRATIONS.md`](../../apps/dashboard/docs/INTEGRATIONS.md). Backend deploy notes: [`docs/archived/v1/INTEGRATIONS-PLATFORM.md`](../../docs/archived/v1/INTEGRATIONS-PLATFORM.md).

## Portal routes

| Route | Purpose |
|-------|---------|
| `/integrations/connected` | Default landing – active connections by type |
| `/integrations/marketplace` | Discover and connect new providers |
| `/integrations/mcp` | MCP server management |
| `/integrations/api` | Developer API keys (hidden until live) |

`/integrations` and legacy `/integrations/connections` redirect to `/integrations/connected`.

Type filters via `?kind=inbox|repository|mcp` on Connected and Marketplace (`IntegrationKindNav`).

## Provider catalog

Live providers (from `integration_providers` seed):

| Provider | Kind | Setup mode |
|----------|------|------------|
| GitHub | Repository | OAuth |
| Outlook | Communication | OAuth (Microsoft Graph) |
| Gmail | Communication | OAuth (Google) |
| KING Accountancy | MCP | Cloudswitch partnerkey (server env) + omgevingscode per administratie |
| Bjorn Lunden MCP | MCP | API key + platform MCP server (Swedish BLA) |
| Custom MCP | MCP | URL + auth metadata |
| Notion, Linear, Atlassian, Slack, Asana, ClickUp, Sentry, Stripe, GitHub MCP, Microsoft Graph MCP, Higgsfield | MCP | Remote MCP OAuth (`mcp_remote_oauth`) |

Catalog: `GET /integrations/providers`. Fallback metadata in `integrations-data.ts` when API unavailable.

## Connections model

- Table: `integration_connections` – **per tenant**, multiple rows per provider (e.g. several GitHub accounts)
- List: `GET /integrations/connections?provider=`
- OAuth start: `GET /integrations/oauth/start?provider=`
- OAuth callback: `GET /integrations/oauth/callback`
- API key create: `POST /integrations/connections`
- Revoke: `DELETE /integrations/connections/{id}`

Host logos: `integration_hosts` table with `logo_url` / `logo_dark_url`; UI uses `IntegrationHostLogo` with fallbacks in `public/brands/`.

## GitHub and projects

- List connections: `GET /github/connections`
- List repos: `GET /github/repos?connection_id=`
- Link to project: `PATCH /projects/{id}/repo` with `connection_id`
- Reindex: `POST /projects/{id}/repo/reindex`
- Worker credentials: `POST /integrations/worker/credentials`

Legacy `github_connections` may dual-write during migration.

## Email (Outlook / Gmail)

Email OAuth lives on Authentication / Integrations API groups:

- Start: `GET /email/oauth/start?provider=outlook|gmail` or provider-specific start endpoints
- Central callbacks: `GET /oauth/microsoft/callback`, `GET /oauth/google/callback`
- Connections: `GET /email/connections`, `DELETE /email/connections/{id}`
- Sync cron: `email/outlook_sync_inboxes` every 15 minutes (Graph delta)

Mailbox management UI: `/settings/inbox` (folders, signature). Marketplace starts OAuth with return URL to marketplace.

**Env (FastAPI):** `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`, `GOOGLE_*` equivalents, `dashboard_outlook_return_url`.

## WhatsApp (Business Cloud API)

WhatsApp is a native inbox channel via the Meta Cloud API. V1 is bring-your-own Meta app; the tenant pastes credentials, no Meta app review of Bokito is required.

- Adapter: `apps/api/app/channels/whatsapp.py` (normalize inbound, Graph send, HMAC verify)
- Webhook (one app-level URL for all tenants): `GET/POST /api/channels/whatsapp/webhook`
  - GET answers Meta's subscription handshake (`hub.verify_token` = `WHATSAPP_VERIFY_TOKEN`, echoes `hub.challenge`)
  - POST verifies `X-Hub-Signature-256` with `META_APP_SECRET` and routes to the `ChannelAccount` whose `address` equals the payload `metadata.phone_number_id`
- Account: `POST /api/channels/accounts` with `channel="whatsapp"`, `provider="whatsapp_cloud"`, `address=phone_number_id`, `credentials={access_token, waba_id}`
- Setup values for the connect card: `GET /api/channels/whatsapp/setup` (webhook URL + verify token, owner/admin)
- Threading: one continuous Signal per customer number (`thread_external_id` = wa_id); dedupe on `wamid`
- Outbound: `deliver_outbound` → Graph `POST /{phone_number_id}/messages` (text). Sends outside Meta's 24h customer-service window fail as `failed:outside_service_window`; expired tokens as `failed:auth`
- Media inbound is stored as a placeholder (`[Image received]` + caption) with the media id in message metadata; media download and template messages are V2
- UI: Add channel dialog on `/settings/channels` (WhatsAppConnectForm), rail entry in the Messages hub, AI mode (suggest default) on `/settings/communication`, marketplace tile links to the channel settings

**Tenant setup (own Meta app):**

1. Create a Meta Business app with the WhatsApp product; register a phone number.
2. Create a System User and generate a permanent token with `whatsapp_business_messaging` (dashboard tokens expire after 24h).
3. Connect the number in Bokito (phone number ID + token), then register the webhook URL + verify token in Meta App Dashboard > WhatsApp > Configuration and subscribe to the `messages` field.

**Env (FastAPI):** `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (set both secret and token or neither; enforced at prod startup).

**V2 (separate track):** Embedded Signup one-click onboarding (requires Meta Tech Provider status + app review), template messages for out-of-window sends, media send, read receipts.

## MCP

- Install: `POST /integrations/mcp/install`
- Bindings: `GET /integrations/mcp/bindings` (tenant `mcp_server_ids`)
- Platform server: Bjorn Lunden MCP (example id 8 in workspace 1)
- Custom MCP: URL + auth in connection metadata
- Remote MCP OAuth: `GET /integrations/mcp/oauth/start`, callback `GET /integrations/mcp/oauth/callback`, worker `POST /integrations/worker/mcp-credentials`, refresh `POST /integrations/mcp/oauth/refresh`
- UI: `McpConnectionForm` for API-key MCP; OAuth setup panel for `remote_mcp_oauth` providers; full management on `/integrations/mcp`

## Indexing

Unified `index_chunks` with `source_type` values including `repo_file`, `tenant_doc_section`, `workspace_doc_page`. Runtime: `POST /index/tenant-docs`, `POST /index/chunks`, vector search via `POST /index/search` with `{ project_id, embedding, top_k }`.

## OAuth patterns

| Pattern | When |
|---------|------|
| Central provider callback | `GET /oauth/microsoft/callback`, `/oauth/google/callback` on integrations group |
| App-group callback | Legacy email-specific routes on `/api/app` |
| State table | `email_outlook_oauth_state` with `return_url`, `feature` for routing |

Redirect URI in authorize URL must **exactly** match Entra / Google Cloud console registration.

## Related docs

- [07 – Inbox and communication](07-inbox-and-communication.md)
- [05 – Workforce and agents](05-workforce-and-agents.md)
- [README](README.md)
