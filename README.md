# BokitoAiV2

Minimal repo: Bokito portal (React dashboard) and the embeddable chat widget, deployed as **one** Xano static host.

## Layout

- `apps/dashboard` — portal (Vite + React). Build output: `apps/dashboard/dist/`.
- `apps/chat-widget` — public embed script and static assets (`bokito-chat.js`, demos). No production bundle step; files are copied into the dashboard build before upload.
- `deploy.ps1` — `npm run build:static` in dashboard (Vite only; run `npm run build` locally when you want full `tsc` + Vite), merge `chat-widget` into `dist/chat-widget/`, zip `dist/`, upload and activate on Xano (Metadata API).

## Local development

**Portal**

```powershell
cd apps\dashboard
npm install
npm run dev
```

**Chat widget** (Vite dev server for static pages)

```powershell
cd apps\chat-widget
npm install
npm run dev
```

## Deploy to Xano

1. Copy `.env.example` to `.env` and fill in Metadata API and static host values. **Important:** `XANO_DASHBOARD_STATIC_HOST_NAME` must be the exact static host slug in Xano for the site that serves your portal (e.g. `bokitoapp`). If that host lives in a **different workspace** than `XANO_WEBSITEWORKSPACE_ID`, set `XANO_DASHBOARD_WORKSPACE_ID` to that workspace’s numeric id (see `deploy.ps1` and `.env.example`).
2. From repo root:

```powershell
.\deploy.ps1
```

Activate production instead of dev:

```powershell
.\deploy.ps1 -Prod
```

Same uploaded build on **both** dev and prod:

```powershell
.\deploy.ps1 -BothEnvs
```

Skip rebuild (only merge widget + zip + upload):

```powershell
.\deploy.ps1 -SkipBuild
```

### Troubleshooting: nieuwe build in Xano, maar `app.bokito.ai` toont oude portal

Xano kan meerdere `*.f2.xano.io` hostnames tonen. Als prod in de UI op `widget-prod-…` staat maar je deploy naar static host **`bokitoapp`**, dan is de inhoud die bij **`bokitoapp-prod-…`** hoort vaak de juiste. Controleer met `curl -sI` of `app.bokito.ai` dezelfde `Last-Modified` / `ETag` heeft als `bokitoapp-prod-…`. Zo niet: pas in **Cloudflare DNS** (of Workers origin) het doel aan naar **`bokitoapp-prod-<jouw-instance>.f2.xano.io`**, niet een legacy `widget-prod-*` host.

### Smoke check script (live portal)

Use this script to validate origin parity, `/api/auth` reachability, optional tenant host reachability, and optional CORS preflight:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\live-portal-smoke.ps1 `
  -TenantHost "https://acme.bokito.ai" `
  -ApiBase "https://xrex-nmji-j9ur.f2.xano.io/api:integrations"
```

If the script reports that `app.bokito.ai` matches `widget-prod-*` instead of `bokitoapp-prod-*` while DNS `app` already points at `bokitoapp-prod-*`, the wildcard Worker route is likely overriding the origin. Deploy the passthrough worker in `cloudflare-workers/bokito-app-passthrough` (`npx wrangler deploy` or `scripts/deploy-cloudflare-app-passthrough.ps1`) so `app.bokito.ai/*` uses zone DNS. Alternatively, fix `bokito-tenant-router` upstreams. See `BOKITO_KNOWLEDGE.md` (Cloudflare Worker route).

### Visible build marker in UI

- Login page footer shows `build: <version>`.
- User menu (under `Sign out`) shows the same build marker.
- `deploy.ps1` sets `VITE_APP_VERSION` automatically to the current build name so each deploy is traceable from the UI.

De dashboard frontend gebruikt een vaste endpoint-opbouw:

- Base URL: `VITE_XANO_BASE_URL`
- API group canonical: `VITE_API_GROUP_*`
- Endpoint path: feature-specifiek pad, bijvoorbeeld `/members` of `/auth/login`

De centrale configuratie staat in `apps/dashboard/src/lib/api.config.ts`.
Gebruik in featurecode altijd de gedeelde API-bases (`APP_API_BASE`, `AUTH_API_BASE`, etc.) in plaats van hardcoded origins.

### Dev vs production gedrag

- Development: routes lopen via de Vite proxy (`/api/<group>`) voor local development.
- Production build: routes gebruiken `VITE_XANO_BASE_URL` gecombineerd met de API group canonical.

Let op: `VITE_*` variabelen zijn build-time waarden en worden in de frontend bundle ingebakken.

### Checklist voor nieuwe API integraties

1. Voeg (indien nodig) een nieuwe `VITE_API_GROUP_<NAME>` toe aan `apps/dashboard/.env.example`.
2. Voeg de bijbehorende constanten toe in `apps/dashboard/src/lib/api.config.ts`.
3. Gebruik de gedeelde base in een API helper of lib-bestand, niet direct in componenten.
4. Houd alleen endpoint paths feature-specifiek (`/resource`, `/resource/:id`).
5. Zet geen secrets in `VITE_*` variabelen.

## Public embed URL

After deploy, the widget is served from the same origin as the portal, for example:

`/chat-widget/bokito-chat.js`

See `apps/chat-widget/README.md` for embed attributes and API contract.
