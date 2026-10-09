# Bokito deploy pipeline

Push to `master` runs CI, then builds container images, deploys to **staging**, smokes it, and promotes the same API image to **production** automatically (no manual approval).

## Flow

```text
local dev + tests  ->  git push master  ->  CI (ruff, pytest, build, e2e)
                                              ->  GHCR build (api + web staging + web prod)
                                              ->  auto deploy staging.bokito.ai
                                              ->  smoke test staging
                                              ->  auto deploy production (app.bokito.ai)
                                              ->  smoke test prod (rollback on failure)
                                              ->  VERSION +0.0.01 on master and the dev checkout
```

`VERSION` (repo root) is the release number baked into the dashboard (`VITE_APP_VERSION`). It starts at `1.2.01`. After production smoke passes, the workflow commits the next patch (`[skip ci]`) and writes the same number to `/opt/bokito-dev/VERSION`. The dev host then shows one patch ahead of the image production is running. Set `VERSION` to a larger number yourself before a deploy when the step should be more than `0.0.01`; the workflow still advances one patch after that release so dev stays ahead.

## GitHub setup (one-time)

### Environments

In **Settings -> Environments**:

| Environment | Protection | Purpose |
|-------------|------------|---------|
| `staging` | None (auto) | Cloud test bed for 24/7 autonomous flows |
| `production` | None (auto) | Promotes the staging-tested image |

### Secrets (repository or both environments)

| Secret | Example / notes |
|--------|-----------------|
| `VPS_HOST` | `31.97.45.44` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | Private key matching `~/.ssh/bokito_vps_deploy` on the VPS |
| `STAGING_SMOKE_EMAIL` | `trader@staging.bokito.ai` |
| `STAGING_SMOKE_PASSWORD` | `staging-trader-password` (from `seed_staging.py`) |
| `PROD_SMOKE_EMAIL` | `trader@bokito.ai` |
| `PROD_SMOKE_PASSWORD` | Production trader password (never commit) |

### GHCR package access

1. After the first successful `Deploy` workflow, open **Packages** for `bokito-api` / `bokito-web`.
2. Packages are private by default; the Deploy workflow passes `GITHUB_TOKEN` to `docker login` on the VPS for pulls. To pull manually on the server, use a PAT with `read:packages` or make the packages public.

Grant the workflow `packages: write` (already set in `deploy.yml` via `GITHUB_TOKEN`).

## VPS layout

| Path | Role |
|------|------|
| `/opt/bokito` | Git checkout; compose files + deploy scripts |
| `/opt/bokito/.env.prod` | Production secrets + image tags (CI updates tags) |
| `/opt/bokito/.env.staging` | Staging secrets + image tags |
| Host Caddy `/etc/caddy/Caddyfile` | TLS + `reverse_proxy` to `:8088` (prod) / `:8089` (staging) |

Compose projects:

- **Production:** `docker compose -p bokito` (preserves existing volumes)
- **Staging:** `docker compose -p bokito-staging` (isolated DB/Redis)

Manual deploy on the server:

```bash
cd /opt/bokito
./scripts/vps-pull-deploy.sh staging <git-sha>
./scripts/vps-pull-deploy.sh prod <git-sha>
```

Smoke (from laptop or CI):

```bash
SMOKE_EMAIL=... SMOKE_PASSWORD=... ./scripts/smoke-deploy.sh https://staging.bokito.ai
```

## Staging vs production

| | Staging | Production |
|---|---------|------------|
| URL | `https://staging.bokito.ai` | `https://app.bokito.ai` |
| LLM | `mock` (default) | `live` or per-tenant keys |
| DB | `bokito_staging` (separate volume) | `bokito` |
| Web image tag | `<sha>-staging` | `<sha>-prod` |
| API image | Same `<sha>` as prod after promotion | Same digest tested on staging |

Seed staging users (first deploy):

```bash
docker compose -p bokito-staging --env-file .env.staging \
  -f docker-compose.deploy.yml -f docker-compose.vps.yml \
  exec -T api python scripts/seed_staging.py
```

## Rollback

Each deploy writes `.rollback.prod.env` / `.rollback.staging.env` with the previous image tags. Production smoke failure triggers automatic rollback via the workflow. Manual rollback:

```bash
cd /opt/bokito
set -a && source .rollback.prod.env && set +a
docker compose -p bokito --env-file .env.prod \
  -f docker-compose.deploy.yml -f docker-compose.vps.yml pull
docker compose -p bokito --env-file .env.prod \
  -f docker-compose.deploy.yml -f docker-compose.vps.yml up -d
```

## Security: credentials encryption

Set a dedicated Fernet key for OAuth/integration `credentials_json` (required in production):

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# → CREDENTIALS_FERNET_KEY=...
```

Do not reuse `JWT_SECRET`. After deploy, run `python apps/api/scripts/dev/migrate_encrypt_credentials.py` once to encrypt any plaintext legacy rows. Rotation: `docs/legal/KEY-ROTATION.md`.

## Mailbox SMTP/IMAP egress

Tenant mailboxes with provider `smtp_imap` open outbound IMAP (usually **993**) and SMTP (**587** STARTTLS or **465** SSL) from the **API and ARQ worker** containers to customer mail hosts. Hostinger (and similar) VPS firewalls must allow that egress, or verify/sync/send fail with a clear network error in Channels. Platform transactional mail (`SMTP_HOST` / Resend) is separate and unchanged.

## Security: rotate leaked V1 secrets

The removed V1 scripts (`vps-redeploy.py`, `vps-finish-deploy.py`, `vps-update-env.py`) contained hardcoded worker-plane credentials. **Rotate these on the VPS** even though the scripts are deleted (git history may still contain them):

- `BOKITO_WORKER_API_KEY`
- `WORKER_INBOUND_SECRET`
- `BULL_BOARD_BASIC_AUTH` (Bull Board on the legacy worker plane)

## Remote dev (`dev.app.bokito.ai`)

Hot reload for Cursor Remote SSH. This is a third origin, separate from `staging.bokito.ai` (built image) and from `/opt/bokito` (production checkout).

- DNS: `dev.app.bokito.ai` A record to the VPS, **DNS only** (grey cloud), so host Caddy can issue the certificate and Vite HMR websockets are not proxied by Cloudflare.
- Host Caddy proxies that hostname to `127.0.0.1:5174` only. There is no extra browser password: an HTTP basic-auth gate retriggers on API calls and the Vite reload socket. Ports 5174 and the dev API are not published on `0.0.0.0`.
- Checkout: `/opt/bokito-dev`. Database: compose project `bokito-dev` (`docker-compose.dev-remote.yml`), Postgres on `127.0.0.1:5433`, Redis on `127.0.0.1:6380`. A fresh database is created with `alembic upgrade 003_baseline` and then `alembic stamp head` (later revisions assume the old shape and fail on an empty database). Host port 8000 is already the trading API, so the dev API listens on `127.0.0.1:8010`.
- Processes: systemd `bokito-dev-api` (`uvicorn --reload`), `bokito-dev-dashboard` (Vite), `bokito-dev-worker` (ARQ, no reload). Saving a file reloads the dashboard immediately and the API after uvicorn restarts. Restart the worker unit after worker-code changes.
- AI is live (`LLM_MODE=live`) with the same platform model keys as production, on this server's own database. Transactional mail uses the production Resend key. Inbound webhooks stay on production (`hooks.bokito.ai`). Google, Microsoft and Moneybird OAuth need `https://dev.app.bokito.ai/api/integrations/oauth/callback` on the provider app before a real connect succeeds. Knowledge embeddings stay local until an OpenAI key is set.
- Laptop SSH: host `bokito-dev` in `~/.ssh/config`, then Cursor Remote-SSH, folder `/opt/bokito-dev`.
- **Agents:** when Cursor is open on the laptop checkout (not `/opt/bokito-dev`), sync feature changes to the VPS before treating work as visible on `dev.app.bokito.ai`. Project rule: `.cursor/rules/remote-dev-ssh.mdc`.
- Vite HMR on that host only: `VITE_DEV_PUBLIC_HOST=dev.app.bokito.ai` (wss, client port 443). Leave it unset on a laptop so `127.0.0.1:5174` stays the same.

## Local development (unchanged)

```powershell
docker compose -f docker-compose.dev.yml up
cd apps\api && uvicorn app.main:app --reload --port 8000
cd apps\dashboard && npm run dev
```

Production-like local build:

```bash
cp .env.prod.example .env.prod
docker compose --env-file .env.prod -f docker-compose.prod.yml -f docker-compose.vps.yml up -d --build
```
