# BokitoAiV2

Minimal repo: Bokito portal (React dashboard) and the embeddable chat widget, deployed as **one** Xano static host.

## Layout

- `apps/dashboard` — portal (Vite + React). Build output: `apps/dashboard/dist/`.
- `apps/chat-widget` — public embed script and static assets (`bokito-chat.js`, demos). No production bundle step; files are copied into the dashboard build before upload.
- `deploy.ps1` — `npm run build` in dashboard, merge `chat-widget` into `dist/chat-widget/`, zip `dist/`, upload and activate on Xano.

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

Skip rebuild (only merge widget + zip + upload):

```powershell
.\deploy.ps1 -SkipBuild
```

## Public embed URL

After deploy, the widget is served from the same origin as the portal, for example:

`/chat-widget/bokito-chat.js`

See `apps/chat-widget/README.md` for embed attributes and API contract.
