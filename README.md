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

1. Copy `.env.example` to `.env` and fill in Metadata API and static host values (same variables as before: `XANO_METADATA_API_KEY`, `XANO_META_BASE_URL`, `XANO_WEBSITEWORKSPACE_ID`, `XANO_DASHBOARD_STATIC_HOST_NAME`).
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

## Frontend API configuratie (dashboard)

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
