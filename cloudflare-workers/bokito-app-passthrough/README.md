# bokito-app-passthrough

Minimal Cloudflare Worker: `return fetch(request)` for `app.bokito.ai/*` so HTML and assets hit the zone DNS origin (`app` CNAME to `bokitoapp-prod-…`) instead of whatever upstream `bokito-tenant-router` uses for `*.bokito.ai/*`.

**Sanity check:** after the zone route points at this worker, `curl -sI https://app.bokito.ai/` should **not** be `Content-Type: text/plain`. Plain text and a ~12-byte body is still Cloudflare’s default **Hello World** worker (not deployed from this repo). You should see `text/html` and the same `Last-Modified` / `x-goog-generation` as a direct HEAD to `bokitoapp-prod-*.f2.xano.io/`.

If you deployed this worker but `fetch(request)` still does not reach Xano (empty body, 530, or wrong content), redeploy with an explicit static origin (forwards path + `Host: app.bokito.ai`):

```powershell
cd cloudflare-workers\bokito-app-passthrough
npx wrangler deploy --var "BOKITO_STATIC_ORIGIN:https://bokitoapp-prod-YOURINSTANCE.f2.xano.io"
```

Replace the URL with your live `bokitoapp-prod` host from Xano static hosting.

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

One-off token without saving to `.env`:

```powershell
.\scripts\deploy-cloudflare-app-passthrough.ps1 -ApiToken '<paste token>'
```

**GitHub Actions:** after merging `.github/workflows/deploy-cloudflare-app-passthrough.yml`, add repository secret `CLOUDFLARE_API_TOKEN`, then run workflow **Deploy Cloudflare app passthrough** (Actions tab, Run workflow).

After deploy, run `.\scripts\live-portal-smoke.ps1` and confirm `app` matches `bokitoapp-prod-*` fingerprints.
