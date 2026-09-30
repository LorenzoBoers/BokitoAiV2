# ADR 002 — V2 next to V1

Status: accepted
Date: 2026-09-30

## Context

The September 2026 strategy ([`../STRATEGY_2026-09.md`](../STRATEGY_2026-09.md)) repositions Bokito as the governed conversation layer for companies run with AI. The V1 audit found a data model of ~88 tables with five work ledgers and four connection families, ~450 endpoints with duplicated decision, orchestration and knowledge paths, stringly typed enums and JSON-as-text, a branched migration history, SQLite tests against a Postgres production, and a 1.6k-line Communication page. Incremental refactoring would carry every one of those into the new strategy. A clean V2 was chosen instead, with V1 kept alive for existing tenants.

## Decisions

- **D1 Two applications, one monorepo.** V2 is `apps/api-v2` (FastAPI, Python package `bokito`) and `apps/web-v2` (Vite + React + TypeScript). V1 (`apps/api`, `apps/dashboard`, `apps/mobile`) stays in place, unchanged, and is labelled legacy in docs. V1 receives fixes only.
- **D2 No shared code between V1 and V2.** V2 ports by copying and simplifying (agent loop, policy engine, tool registry and executor, gateway, channel adapters, model resolution, auth, MCP and OAuth AS, design tokens, decision card, composer). V2 never imports from `apps/api` or `apps/dashboard`. `packages/shared` and `apps/chat-widget` are shared; the widget gains a build target against api-v2.
- **D3 Own database, same server.** V2 uses database `bokito_v2` on the same Postgres instance (pgvector), its own Redis key prefix, and one Alembic baseline. No data migration from V1 in this phase; tenants move by re-onboarding when V2 is ready for them.
- **D4 Own deployment.** Compose project `bokito-v2` with images `ghcr.io/lorenzoboers/bokito-api-v2` and `bokito-web-v2`, exposed on port 8090 behind the host Caddy as `v2.bokito.ai` (staging `v2-staging.bokito.ai`). The V1 pipeline and its production approval gate are untouched; CI gains `api-v2` and `web-v2` jobs and the deploy workflow gains a V2 matrix entry.
- **D5 Postgres in tests.** V2 tests run against Postgres (compose service locally, service container in CI). No SQLite path exists in V2.
- **D6 Same stack, new shape.** FastAPI, SQLAlchemy 2 (typed mapped columns, native enums, JSONB, pgvector), Alembic, ARQ, Redis; React 19, Vite, TanStack Query, react-router, i18next, Tailwind. Chosen so proven V1 logic ports with low risk while the schema and API are redesigned.
- **D7 Tools-first API.** Every mutation in V2 is a tool in one registry. REST routers, the agent loop, the MCP endpoint and the command palette call `execute_tool` with a trust level (`operator`, `agent`, `api`, `external`). REST is a thin mirror; there is no second write path.
- **D8 Cutover later, per tenant.** When V2 covers a tenant's channels and modules, the tenant is onboarded on V2 and its V1 workspace is archived. V1 is decommissioned when no tenant remains. That decision is recorded in a later ADR.

## Consequences

- Two stacks run for a period; CI and hosting cost roughly double until cutover.
- V2 starts without V1's long tail (projects, custom DB, canvas, calendar, investing). Each returns only as a module when a tenant needs it.
- Product help gains a V2 section; V1 articles remain until V1 is decommissioned.
- `docs/architecture.md` describes V1 and is marked legacy; V2 architecture lives in `docs/CORE_INTENT.md` and in `apps/api-v2/README.md`.
