# Bokito deploy pipeline

Push to `master` runs CI, then builds container images, deploys to **staging**, and waits for **production** approval before promoting the same API image to prod.

## Flow

```text
local dev + tests  ->  git push master  ->  CI (ruff, pytest, build, e2e)
                                              ->  GHCR build (api + web staging + web prod)
                                              ->  auto deploy staging.bokito.ai
                                              ->  smoke test staging
                                              ->  [manual approve] production (app.bokito.ai)
                                              ->  smoke test prod (rollback on failure)
```

## GitHub setup (one-time)

### Environments

In **Settings -> Environments**:

| Environment | Protection | Purpose |
|-------------|------------|---------|
| `staging` | None (auto) | Cloud test bed for 24/7 autonomous flows |
| `production` | Required reviewers (you) | Promotes the staging-tested image |

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

## Bokito V2 (v2.bokito.ai)

V2 (`apps/api-v2`, `apps/web-v2`) ships through the same `Deploy` workflow as V1 and lands on the same VPS as two extra compose projects with their own Postgres and Redis volumes. Nothing is shared with V1 except the host Caddy.

| | V2 staging | V2 production |
|---|---|---|
| URL | `https://v2-staging.bokito.ai` | `https://v2.bokito.ai` |
| Compose project | `bokito-v2-staging` | `bokito-v2` |
| Env file | `/opt/bokito/.env.v2-staging` | `/opt/bokito/.env.v2` |
| Web port (host Caddy) | `127.0.0.1:8091` | `127.0.0.1:8090` |
| `ENVIRONMENT` / `LLM_MODE` | `staging` / `mock` | `production` / `live` |
| Images | `ghcr.io/lorenzoboers/bokito-api-v2:<sha>`, `ghcr.io/lorenzoboers/bokito-web-v2:<sha>` (one web image for both) | same digest as staging |

Flow inside `deploy.yml`: the `build` job pushes the two V2 images; `deploy-staging` runs `scripts/vps-v2-bootstrap.sh staging` on first use (env file with generated `POSTGRES_PASSWORD`, `JWT_SECRET`, `CREDENTIALS_KEY`, `INBOUND_SECRET`, plus the Caddy route) and then `scripts/vps-pull-deploy-v2.sh staging <sha>`; `scripts/smoke-v2.sh` checks `/api/health/ready`, OAuth discovery, the MCP 401 challenge and the web shell. `deploy-production` repeats this for `prod` after the environment approval, with `.rollback.v2-prod.env` as the rollback snapshot.

Manual deploy on the server:

```bash
cd /opt/bokito
bash scripts/vps-v2-bootstrap.sh staging   # once
./scripts/vps-pull-deploy-v2.sh staging <git-sha>
bash scripts/smoke-v2.sh https://v2-staging.bokito.ai
./scripts/vps-pull-deploy-v2.sh prod <git-sha>
```

Production requirements are enforced at startup by `validate_production_settings`: `JWT_SECRET` of at least 32 characters, `CREDENTIALS_KEY` (Fernet), `LLM_MODE=live`, `REDIS_URL`, a public `PUBLIC_APP_URL`. The managed model defaults to `mistral:mistral-large-latest` (EU); set `MISTRAL_API_KEY` in `.env.v2`, or override `MANAGED_MODEL` with another provider key until a Mistral key is available. `alembic upgrade head` runs on every API container start. Rollback:

```bash
cd /opt/bokito
set -a && source .rollback.v2-prod.env && set +a
docker compose -p bokito-v2 --env-file .env.v2 -f docker-compose.v2.deploy.yml pull
docker compose -p bokito-v2 --env-file .env.v2 -f docker-compose.v2.deploy.yml up -d
```

Local V2 stack: `docker compose -p bokito-v2 -f docker-compose.v2.yml up -d --build` (web on `http://127.0.0.1:8090`).

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
