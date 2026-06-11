# Bokito AI OS — local development

## Quick start

```bash
docker compose -f docker-compose.dev.yml up --build
```

Services:
- API: http://127.0.0.1:8000
- Dashboard: http://127.0.0.1:5174

## Test credentials (seed)

- Email: `admin@bokito.ai`
- Password: `bokito-test-password`

## Backend tests (mock LLM, no API keys)

```bash
cd apps/api
pip install -e ".[dev]"
pytest
```

## Verification

Fast checks (no browser):

```bash
npm run verify:bokito
```

Runs API pytest (mock LLM) and dashboard `vite build` — same as the CI `api` and `dashboard` jobs. The CI `mobile` job additionally typechecks `apps/mobile` (`npx tsc --noEmit`).

## Frontend e2e (Playwright)

Starts API (seeded SQLite) and dashboard dev servers automatically unless they are already running locally.

```bash
npm install
npx playwright install chromium
npm run verify:bokito:e2e
```

Playwright uses isolated ports by default (so it does not clash with a running dev stack): API `8008`, dashboard `5184`. Override with `PLAYWRIGHT_API_PORT` and `PLAYWRIGHT_DASHBOARD_PORT`.

When not in CI, Playwright reuses servers already listening on those URLs (`reuseExistingServer`).

Credentials: `admin@bokito.ai` / `bokito-test-password`

## Mobile app (Expo)

```bash
npm run start -w bokito-mobile
```

Point `expo.extra.apiUrl` in `apps/mobile/app.json` at the machine running the API (use your LAN IP for physical devices). See `apps/mobile/README.md`.

## Environment

Copy `.env.example` to `.env` and set:
- `LLM_MODE=mock` for CI/local tests
- `LLM_MODE=live` + `ANTHROPIC_API_KEY` for live agent tests
