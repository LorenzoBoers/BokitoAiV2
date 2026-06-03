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

## Frontend e2e (Playwright)

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

## Environment

Copy `.env.example` to `.env` and set:
- `LLM_MODE=mock` for CI/local tests
- `LLM_MODE=live` + `ANTHROPIC_API_KEY` for live agent tests

## Strangler migration

Cloudflare worker `cloudflare-workers/bokito-api-strangler` routes migrated `/api/*` paths to the Python backend while legacy paths stay on Xano.

## V2 hooks

- Orchestra: `app/services/orchestra.py` + `orchestra_tick` arq job
- Coding runner: `app/services/coding_runner.py` + `coding_agent_run` arq job
