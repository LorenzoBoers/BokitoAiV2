# Production readiness checklist (Cycle 32)

Operator actions required to flip the accountancy-client journey fully live on
`app.bokito.ai` / `api.bokito.ai` (Hostinger VPS srv859418, Compose + Caddy).
Everything below is configuration only — the code paths already exist and are
covered by tests and the `apps/api/scripts/smoke_cycle32.py` dry run.

## 1. Microsoft Entra app (SSO login + Outlook mailbox)

One Entra app registration serves both flows.

1. Azure Portal > Entra ID > App registrations > New registration.
   - Supported account types: multitenant + personal ("common") unless the
     client requires single-tenant.
   - Redirect URI (Web): `https://app.bokito.ai/api/integrations/oauth/callback`
2. API permissions (Microsoft Graph, delegated): `openid`, `email`, `profile`,
   `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `offline_access`. Grant admin
   consent if the client tenant requires it.
3. Certificates & secrets > New client secret; copy the secret VALUE.
4. On the VPS, set `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`,
   `MICROSOFT_OAUTH_TENANT` (usually `common`) via
   `python scripts/ops/vps-set-microsoft-oauth.py` and restart api + worker.

Result: "Sign in with Microsoft" works on `/login` and `/signup`
(`GET /api/auth/microsoft/start`), and Outlook mailbox connect works from
Settings > Channels. Until set, SSO start returns 503 (no silent mock in prod).

## 2. Björn Lundén MCP (Swedish BLA)

- Optional: set `BJORN_LUNDEN_MCP_URL` in `/opt/bokito/.env.prod` only when
  using an external MCP server. Empty uses the native Swedish BLA adapter
  (`native://bjorn-lunden`).
- Client ID / client secret are entered at install time. This is not the
  Dutch KING Accountancy path.

## 2b. KING Accountancy / KING Finance Cloudswitch (Dutch)

- Set `KING_FINANCE_PARTNER_KEY` in `/opt/bokito/.env.prod` (issued by
  `partners@muis.nl` after the partner agreement). Ask BL to allowlist the
  VPS outbound IP on that key.
- Tenants add omgevingscodes per administratie in Marketplace > KING
  Accountancy. Do not store King usernames or passwords.
- Sandbox (before the live key): partnerkey `abcdefghijklmnopqrstuvwxyz`,
  omgevingscode `00000`, admin 2000 at https://kingfinance.nl/demo.

## 3. Transactional + notification email (SMTP)

- Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`,
  `SMTP_USE_TLS` in `/opt/bokito/.env.prod`.
- Used for: invites, password reset, email verification, and per-user
  notification emails (assignment / mention / decision categories, opt-in per
  user under Settings > Notifications).
- **Tenant SMTP/IMAP mailboxes** (`provider=smtp_imap`) are separate: workers
  need outbound TCP to customer IMAP/SMTP hosts (993 / 587 / 465). See
  `docs/DEPLOY.md` (Mailbox SMTP/IMAP egress).

## 4. Web push (optional)

- Generate a VAPID key pair and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_CLAIMS_EMAIL`. Until set, `GET /api/push/vapid-public-key` returns
  503 and browser push stays disabled (no mock key in prod).

## 5. Boot-time guards already enforced in prod

`validate_production_settings` fails boot when:

- `LLM_MODE` is not `live` or `BOKITO_MOCK_EXECUTION` is truthy.
- JWT secret/database URL are dev defaults.
- `CREDENTIALS_FERNET_KEY` is empty (OAuth/integration credential encryption).

Runtime guards: mock MCP servers are refused (install, test, tool calls),
GitHub mock repo/branch fallbacks are disabled, mock OAuth endpoints return
503, `/api/email/mock/inbound` returns 404.

## 6. Verification after configuring

1. `https://api.bokito.ai/api/health` returns ok.
2. `/login` shows "Sign in with Microsoft"; completing it lands in a fresh
   workspace with the email-first onboarding checklist.
3. Settings > Channels > Connect Outlook completes OAuth and the mailbox
   syncs selected folders (Inbox/Sent, per-folder cursors).
4. Send a test email to the connected mailbox; a suggest-mode agent should
   post a decision card in the thread within one sync interval (~60s).
5. Approving with edited text sends the reply through Graph `/reply` so it
   threads correctly in the recipient's Outlook.
