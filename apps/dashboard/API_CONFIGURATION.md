# Dashboard API Configuration

This document defines how frontend API endpoints are built in `apps/dashboard`.

## Standard endpoint composition

Use this composition for all Xano group-based requests:

1. Base URL from `VITE_XANO_BASE_URL`
2. Group canonical from `VITE_API_GROUP_*`
3. Feature path from the calling helper/module

Centralize all base composition in `src/lib/api.config.ts`.

## Naming conventions

- Env variable names:
  - `VITE_XANO_BASE_URL`
  - `VITE_API_GROUP_<NAME>` (uppercase snake case)
- API base constants in code:
  - `<NAME>_API_BASE` (uppercase snake case)
- Canonical fallback values:
  - lowercase short names, for example `app`, `auth`, `workforce`

## Implementation rules

- Do keep all origin/group composition logic in `src/lib/api.config.ts`.
- Do consume shared base exports in API utilities (`src/lib/xano.ts`, feature libs).
- Do keep endpoint paths close to feature logic.
- Do keep `VITE_*` values non-secret.

- Do not hardcode full API origins in pages, components, or hooks.
- Do not duplicate base-building logic in multiple feature files.
- Do not introduce ad-hoc env reads in UI components.

## Example pattern

```ts
// api.config.ts
export const API_GROUP_APP = import.meta.env.VITE_API_GROUP_APP || 'app'
export const APP_API_BASE = xanoApiBase(API_GROUP_APP)

// feature helper
await fetch(`${APP_API_BASE}/members`)
```

## Migration approach for existing fetch code

1. Identify feature files with direct origin usage.
2. Replace direct origins with shared base constants from `api.config.ts`.
3. Move repeated fetch calls into shared helpers where possible.
4. Keep only endpoint-specific path fragments in the feature layer.
5. Verify dev behavior (proxy path) and prod behavior (built origin).
