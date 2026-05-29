# Dashboard API integration

This document is the canonical reference for frontend API patterns in the dashboard.

For full details, see [API_CONFIGURATION.md](../API_CONFIGURATION.md) in the dashboard app root.

## Quick rules

1. Construct endpoints from `VITE_XANO_BASE_URL`, `VITE_API_GROUP_*`, and paths in `src/api/routes/`.
2. Centralize env and group bases in `src/lib/api.config.ts`.
3. Do not hardcode full Xano origins in pages or components.
4. Do not add ad-hoc path string literals outside `src/api/routes/`.

## Onboarding

- Human docs: this file + [API_CONFIGURATION.md](../API_CONFIGURATION.md)
- Route registry: `src/api/routes/index.ts`
- Transport: `src/lib/xano.ts`
