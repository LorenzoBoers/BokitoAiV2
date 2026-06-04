# Bokito AI OS — local development

## Quick start

```bash
docker compose -f docker-compose.dev.yml up --build
```

Services:
- API: http://127.0.0.1:8000
- Dashboard: http://127.0.0.1:5174 (set `VITE_API_MODE=bokito`)
- Messenger PWA: http://127.0.0.1:5175

## Test credentials (seed)

- Email: `admin@bokito.ai`
- Password: `bokito-test-password`

## Backend tests (mock LLM, no API keys)

```bash
cd apps/api
pip install -e ".[dev]"
pytest
```

## Verification (P9)

Fast checks (no browser):

```bash
npm run verify:bokito
```

Runs API pytest (mock LLM), dashboard `vite build`, and messenger build — same as CI `api`, `dashboard`, and `messenger` jobs.

## Frontend e2e (Playwright)

Starts API (seeded SQLite), dashboard (`VITE_API_MODE=bokito`), and messenger dev servers automatically unless they are already running locally.

```bash
npm install
npx playwright install chromium
npm run verify:bokito:e2e
```

Playwright uses isolated ports by default (so it does not clash with a running dev stack): API `8008`, dashboard `5184`, messenger `5185`. Override with `PLAYWRIGHT_API_PORT`, `PLAYWRIGHT_DASHBOARD_PORT`, `PLAYWRIGHT_MESSENGER_PORT`.

When not in CI, Playwright reuses servers already listening on those URLs (`reuseExistingServer`).

Credentials: `admin@bokito.ai` / `bokito-test-password`

## Environment

Copy `.env.example` to `.env` and set:
- `LLM_MODE=mock` for CI/local tests
- `LLM_MODE=live` + `ANTHROPIC_API_KEY` for live agent tests

## Strangler migration

Cloudflare worker `cloudflare-workers/bokito-api-strangler` routes migrated `/api/*` paths to the Python backend while legacy paths stay on Xano.

## V2 hooks

- Orchestra: `app/services/orchestra.py` + `orchestra_tick` arq job
- Coding runner: `app/services/coding_runner.py` + `coding_agent_run` arq job
