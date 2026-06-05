# Dashboard API integration

This document is the canonical reference for frontend API patterns in the dashboard.

For full details, see [API_CONFIGURATION.md](../API_CONFIGURATION.md) in the dashboard app root.

Architecture overview: [docs/architecture.md](../../../docs/architecture.md)

## Quick rules

1. Construct endpoints from `VITE_XANO_BASE_URL`, `VITE_API_GROUP_*`, and paths in `src/api/routes/`.
2. Centralize env and group bases in `src/lib/api.config.ts`.
3. Do not hardcode full Xano origins in pages or components.
4. Do not add ad-hoc path string literals outside `src/api/routes/`.

## Bokito mode (FastAPI)

When `VITE_API_MODE=bokito`, the Vite dev server proxies `/api/*` to the local FastAPI backend. Use same-origin paths:

| Feature | Client module | Backend prefix |
|---------|---------------|----------------|
| Govern | `lib/govern-api.ts` | `/api/govern` |
| OS graph | `lib/os-api.ts` | `/api/workforce/os` |
| Decisions (compat) | `lib/messages-api.ts` | `/api/workforce/messages` |
| Decisions (native) | notifications API | `/api/notifications/decisions` |
| Signals | add routes as needed | `/api/signals` |
| Learning | add routes as needed | `/api/learning` |
| Cockpit | `lib/bokito-api.ts` | `/api/cockpit` |

### Govern routes

- `GET /api/govern/changes?status=pending_review` — draft queue
- `POST /api/govern/changes/{id}/accept` — apply draft
- `POST /api/govern/changes/{id}/reject` — discard draft
- `POST /api/govern/changes/{id}/rollback` — revert accepted change
- `GET /api/govern/apply-modes` / `PUT /api/govern/apply-modes` — yolo/draft/decision matrix
- `GET /api/govern/audit` — audit log
- `GET /api/govern/passports` — agent scopes and tools

### Platform scopes (passport)

Canonical scope strings enforced server-side:

- `platform:read`, `platform:graph:edit`
- `platform:agent:create`, `platform:agent:update`
- `platform:workstream:create`, `platform:workstream:update`
- `platform:blueprint:write`
- `platform:integration:propose`, `platform:integration:create`
- `platform:mcp:register`, `platform:edge:connect`

## Onboarding

- Human docs: this file + [API_CONFIGURATION.md](../API_CONFIGURATION.md)
- Route registry: `src/api/routes/index.ts`
- Transport: `lib/xano.ts`
- Bokito direct fetch: `lib/bokito-api.ts`, `lib/govern-api.ts`
