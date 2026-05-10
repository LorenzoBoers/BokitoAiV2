# bokito-app-passthrough

Minimal Cloudflare Worker: `return fetch(request)` for `app.bokito.ai/*` so HTML and assets hit the zone DNS origin (`app` CNAME to `bokitoapp-prod-…`) instead of whatever upstream `bokito-tenant-router` uses for `*.bokito.ai/*`.

## Deploy

From repo root (requires [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) auth, e.g. `wrangler login` or `CLOUDFLARE_API_TOKEN`):

```powershell
cd cloudflare-workers\bokito-app-passthrough
npx wrangler deploy
```

Or:

```powershell
.\scripts\deploy-cloudflare-app-passthrough.ps1
```

After deploy, run `.\scripts\live-portal-smoke.ps1` and confirm `app` matches `bokitoapp-prod-*` fingerprints.
