# Bokito API V2

FastAPI service behind `v2.bokito.ai`. Design: `docs/CORE_INTENT.md`, coexistence with V1: `docs/adr/002-v2-coexistence.md`.

## Layout

```
bokito/
  config.py       Settings (pydantic-settings), validate_production_settings
  db.py           async engine + session factory
  errors.py       AppError family -> {"error": {code, message, details}}
  deps.py         Principal (trust level), Operator / ApiClient dependencies
  domain/         SQLAlchemy 2 models, one file per aggregate
  services/       pure functions over sessions (no HTTP)
  tools/          tool registry + executor (every mutation is a tool)
  agent/          agent loop, model resolution (EU default, BYOK)
  channels/       email, widget, whatsapp, phone adapters
  workbench/      adapters that hand coding work to external tools (Cursor cloud agents)
  realtime/       gateway (WebSocket)
  api/            routers, thin: parse -> service -> response_model
                  incl. oauth (built-in AS for MCP clients) and mcp (Streamable HTTP)
  workers/        ARQ jobs
  modules/        module spec + first-party modules
alembic/          single baseline + forward migrations
tests/            pytest on real Postgres (embedded pgserver locally, service in CI)
```

## Run locally

```powershell
cd apps/api-v2
uv sync --extra dev
uv run uvicorn bokito.main:app --reload --port 8090
```

Tests and lint:

```powershell
uv run pytest -q          # embedded Postgres in %TEMP%; set TEST_DATABASE_URL to override
uv run ruff check . ; uv run ruff format .
uv run python scripts/check_migrations.py   # needs DATABASE_URL
```

Migrations:

```powershell
uv run alembic revision --autogenerate -m "describe change"
uv run alembic upgrade head
```

## Conventions

- Tenant scope is a column on every aggregate (`TenantMixin`); no cross-tenant joins.
- Enums are Postgres native enums; free-form config is JSONB; no JSON-in-text.
- API paths live under `settings.api_prefix` (`/api`). Errors are never HTML.
- Every mutation reachable by an agent, the MCP endpoint or the public API goes through `tools.execute_tool` with an explicit trust level. Consequential tools raise a Decision instead of executing when the workspace posture requires it.
- No imports from `apps/api` (V1). Port by copying and simplifying.

## Integration layer

- **Public API** is the REST surface itself. `Authorization: Bearer` accepts a dashboard JWT
  (trust `operator`), a `bok2_` API token (Govern -> Tokens) or a `bok2o_` OAuth access token;
  both token kinds resolve to trust `api` with the creating user's role. Token scopes:
  `read` (GET), `write` (mutations), `tools` (`/tools/execute` and `/api/mcp`); an empty scope
  list means all three.
- **MCP** at `POST /api/mcp` (Streamable HTTP, JSON-RPC 2.0, stateless). `tools/list` is
  `registry.list(trust="api")`; `tools/call` goes through `execute_tool`, so a policy `ask`
  returns `{"status": "decision"}` for the operator to approve in the thread. Resources are
  workspace docs (`bokito://docs/{path}`); two prompts (`workspace_brief`, `draft_reply`).
- **OAuth AS** under `/api/oauth`: RFC 7591 registration, authorization code + PKCE S256,
  consent in web-v2 (`/oauth/consent`), refresh with rotation, RFC 7009 revoke. Discovery at
  `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/api/mcp`
  (proxied by nginx/Vite to the API). Tables: `oauth_clients`, `oauth_codes`, `oauth_tokens`.
- **Workbench**: connection kind `workbench`, provider `cursor` (Cursor cloud agents API).
  Tools `dispatch_work`, `workbench_status`, `workbench_followup`; a job is `Run(kind=job)`;
  Cursor calls back on `POST /api/hooks/workbench/{public_key}` (HMAC-SHA256 over the raw body)
  and the result lands as a `run` message in the originating conversation. `WORKBENCH_MODE`
  defaults to `LLM_MODE`; in `mock` no network calls are made.
