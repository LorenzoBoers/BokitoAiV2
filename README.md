# BokitoAiV2

Monorepo for the Bokito portal (React dashboard), embeddable chat widget, and FastAPI backend (`apps/api`).

## Layout

- `apps/dashboard` — portal (Vite + React). Build output: `apps/dashboard/dist/`.
- `apps/chat-widget` — embeddable livechat widget (TypeScript + Vite). Run `npm run build` to produce `dist/bokito-chat.js` (IIFE) plus copied `public/` assets. The dashboard dev server serves `/chat-widget/*` from that build output.
- `apps/api` — FastAPI backend (auth, signals, workforce, livechat, govern, orchestration).

## Local development

**API**

```powershell
cd apps\api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

**Portal**

```powershell
cd apps\dashboard
npm install
npm run dev
```

Vite proxies `/api/*` (HTTP + WebSocket) to `http://127.0.0.1:8000` by default (`VITE_BOKITO_API_URL`).

**Chat widget** (standalone dev pages)

```powershell
cd apps\chat-widget
npm install
npm run build
npm run dev
```

Seed credentials (after `python scripts/seed.py` in `apps/api`): `admin@bokito.ai` / `bokito-test-password`.

## Frontend API pattern

The dashboard constructs endpoints from same-origin paths:

- Bases in `apps/dashboard/src/lib/api.config.ts` (`APP_API_BASE`, `AUTH_API_BASE`, `WORKFORCE_API_BASE`, `LIVECHAT_API_BASE`, …)
- Route path constants in `apps/dashboard/src/api/routes/`
- Transport in `apps/dashboard/src/lib/bokito-api.ts`

Do not hardcode full API origins in components. `VITE_*` values are build-time only; never store secrets in them.

Human onboarding: `apps/dashboard/docs/API.md`.

## Public embed URL

After building the widget, the bundle is served from the same origin as the portal:

- `/chat-widget/bokito-chat.js` — one bundle for both audiences; the embed snippet sets `data-auth-mode="anonymous"` (site visitors) or `"required"` (logged-in platform users) plus `data-tenant`

Livechat API: `/api/livechat/*` (`session/start`, `stream-chat`, theme from workspace branding).

See `apps/chat-widget/README.md` for embed attributes and API contract.

## Production deployment (Hostinger VPS)

The whole stack runs on a single Hostinger VPS (`31.97.45.44`) via Docker Compose + Caddy:

```bash
cp .env.prod.example .env.prod   # fill in real secrets
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

`docker-compose.prod.yml` runs `postgres` (pgvector), `redis`, `api` (uvicorn, single replica — the in-process trigger scheduler has no distributed lock), `worker` (arq), and `web` (Caddy serving the dashboard + widget bundles and reverse-proxying `/api`).

- **Live hosts:** `bokito.ai`, `app.bokito.ai`, `api.bokito.ai`, and `*.bokito.ai` are Cloudflare-proxied A records pointing at the VPS. `app.bokito.ai` is the control-plane (login) host; `api.bokito.ai` now serves this FastAPI backend (moved off the old Xano API). The legacy Cloudflare Workers (`bokito-tenant-router`, `bokito-app-passthrough`) are removed — traffic goes straight to the VPS.
- **Env-driven domain:** the dashboard's control-plane/tenant hosts are baked at build time from `VITE_APP_CONTROL_PLANE_HOST` / `VITE_TENANT_ROOT_DOMAIN` (defaults `app.bokito.ai` / `.bokito.ai`; see `apps/dashboard/Dockerfile` and `web.build.args` in the compose file). Because `VITE_*` is baked in, switching domains requires a `web` image rebuild, not just a restart. See `host-routing.ts`.
- **Health/login checks:** `GET /api/health` returns `{"ok":true,"service":"bokito-api"}` on all three hosts; `POST /api/auth/login` returns a JWT carrying the user's `tenant.id`.

Full deploy notes and the bokito.ai cutover log live in `BOKITO_KNOWLEDGE.md` (section 17).

## CI/CD (GitHub -> GHCR -> VPS)

Push to `master` runs CI, builds images to GHCR, auto-deploys **staging** (`https://staging.bokito.ai`), then waits for a **production** approval before promoting the same API image to `app.bokito.ai`.

Setup (GitHub Environments, secrets, rollback): [`docs/DEPLOY.md`](docs/DEPLOY.md).

```text
local tests  ->  push master  ->  CI  ->  GHCR build  ->  staging deploy + smoke
                                                      ->  [approve] prod deploy + smoke
```

## Verification

```powershell
npm run verify:bokito
```

Runs API pytest and dashboard type-check/build as configured in the root `package.json`.
