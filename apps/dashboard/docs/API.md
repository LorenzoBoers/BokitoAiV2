# Dashboard API integration

This document is the canonical reference for frontend API patterns in the dashboard.

Architecture overview: [docs/architecture.md](../../../docs/architecture.md)

## Quick rules

1. Construct endpoints from same-origin bases in `src/lib/api.config.ts` and paths in `src/api/routes/`.
2. In development, Vite proxies `/api/*` to `VITE_BOKITO_API_URL` (default `http://127.0.0.1:8000`).
3. Do not hardcode full API origins in pages or components.
4. Do not add ad-hoc path string literals outside `src/api/routes/`.

## Bokito mode (FastAPI)

When `VITE_API_MODE=bokito`, the Vite dev server proxies `/api/*` to the local FastAPI backend. Use same-origin paths:

| Feature | Client module | Backend prefix |
|---------|---------------|----------------|
| Govern | `lib/govern-api.ts` | `/api/govern` |
| OS graph | `lib/os-api.ts` | `/api/workforce/os` |
| Decisions (compat) | `lib/messages-api.ts` | `/api/workforce/messages` |
| Decisions (native) | notifications API | `/api/notifications/decisions` |
| Signals | `lib/signals-api.ts` | `/api/signals` |
| Learning | add routes as needed | `/api/learning` |
| Cockpit | `lib/bokito-api.ts` | `/api/cockpit` |
| Settings (providers/models) | `lib/models-api.ts` | `/api/settings` |
| Livechat | widget + `LIVECHAT_API_BASE` | `/api/livechat` |
| Product help / docs site | `lib/product-help-api.ts` | `/api/docs` (index+nav, `/search`, `/{slug}`, `/{slug}.md`, `/assets/{path}`, `/openapi.json`, `/sitemap.xml`) |
| Tenant help center | `lib/help-api.ts` | `/api/help` |

### Govern routes

- `GET /api/govern/changes?status=pending_review` — draft queue
- `POST /api/govern/changes/{id}/accept` — apply draft
- `POST /api/govern/changes/{id}/reject` — discard draft
- `POST /api/govern/changes/{id}/rollback` — revert accepted change
- `GET /api/govern/audit` — audit log
- `GET /api/govern/passports` — agent scopes and tools
- `GET/PUT /api/govern/posture` — autonomy posture presets
- `GET/PUT /api/govern/allowances` — tool category sliders

### Platform scopes (passport)

Canonical scope strings enforced server-side:

- `platform:read`, `platform:graph:edit`
- `platform:agent:create`, `platform:agent:update`
- `platform:workstream:create`, `platform:workstream:update`
- `platform:blueprint:write`
- `platform:integration:propose`, `platform:integration:create`
- `platform:mcp:register`, `platform:edge:connect`

### Settings routes (providers and models)

Bases: `SETTINGS_API_BASE` (`/api/settings`), route constants in `src/api/routes/settings.routes.ts`, client in `lib/models-api.ts`.

- `GET /api/settings/providers` — list tenant provider connections (masked keys) + preset registry
- `POST /api/settings/providers` — add provider (`provider_type`, `label`, `base_url`, `api_key`)
- `PATCH /api/settings/providers/{id}` — update label, base URL, key, enabled flag
- `DELETE /api/settings/providers/{id}` — remove provider and its models
- `POST /api/settings/providers/{id}/test` — verify credentials
- `GET /api/settings/models` — tenant models (when configured) or platform-catalog fallback
- `POST /api/settings/models` — add model or bulk-enable presets (`enable_presets: true`)
- `PATCH /api/settings/models/{id}` — enable/disable, set defaults
- `DELETE /api/settings/models/{id}` — remove tenant model row
- `PUT /api/settings/models` — legacy platform prefs (`default_chat`, `allowed_chat`) when no tenant models yet
- `PATCH /api/workforce/agents/{id}/model` — assign model slug to agent

Staff platform catalog: `STAFF_API_BASE` + `src/api/routes/staff.routes.ts` (`/api/staff/models`, `/platform-keys`, `/markup`).

## Onboarding

- Human docs: this file
- Route registry: `src/api/routes/index.ts`
- Transport: `lib/bokito-api.ts`, feature-specific `lib/*-api.ts` modules
