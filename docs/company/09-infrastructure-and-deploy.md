# Infrastructure and deploy

Last updated: May 2026

This chapter covers VPS runtime, portal static hosting, Cloudflare edge routing, and key environment variables.

VPS checklist: [`docs/phase-0-infrastructure.md`](../phase-0-infrastructure.md).

## VPS runtime (worker plane)

| Item | Value (example) |
|------|-----------------|
| Host | Hostinger KVM VPS (Ubuntu 24.04) |
| Public URL | `https://worker.bokito.ai` |
| Process | Node runtime on port 3300 |
| Reverse proxy | Caddy |
| Queue | Redis (BullMQ) |
| Embeddings | Ollama (`nomic-embed-text-v2-moe`) |
| Process manager | PM2 |

Caddyfile excerpt:

```
worker.bokito.ai {
    reverse_proxy localhost:3300
}
```

Deploy scripts:

- `scripts/deploy-runtime-vps.sh`
- `scripts/vps-redeploy.py`

Xano env: `WORKER_BASE_URL`, `WORKER_INBOUND_SECRET`, `XANO_WORKER_API_KEY`.

## Portal static hosting (Xano)

Root script: **`deploy.ps1`** at repo root.

Pipeline:

1. `npm run build:static` in dashboard (Vite; no `tsc` gate while typecheck is noisy)
2. `npm run build` in `apps/chat-widget`
3. Merge widget `dist/` into `apps/dashboard/dist/chat-widget/`
4. Zip `dist/`, upload via Xano Metadata API
5. Activate build for `dev` and/or `prod` env

Static host slug example: `bokitoapp` → URLs like `bokitoapp-prod-{instance}.f2.xano.io`.

### Deploy env vars (`.env` at repo root)

| Variable | Purpose |
|----------|---------|
| `XANO_METADATA_API_KEY` | Metadata API auth |
| `XANO_META_BASE_URL` | Metadata API base |
| `XANO_DASHBOARD_STATIC_HOST_NAME` | Static host slug (e.g. `bokitoapp`) |
| `XANO_DASHBOARD_WORKSPACE_ID` | Workspace for portal static (if not default) |
| `XANO_WIDGET_WORKSPACE_ID` | Fallback workspace |

`deploy.ps1` sets `VITE_APP_VERSION` to the build name for UI version display.

Use `-BothEnvs` to activate the same build on dev and prod.

## Cloudflare

### DNS

- Wildcard `*.bokito.ai` proxied to Cloudflare (required for tenant subdomains)
- `app` CNAME to Xano static host (`bokitoapp-prod-*`)
- Script: `scripts/update-cloudflare-app-cname.ps1` with `CLOUDFLARE_API_TOKEN`

### Workers

| Worker | Route pattern | Role |
|--------|---------------|------|
| `bokito-tenant-router` | `*.bokito.ai/*` | API proxy + tenant static |
| `bokito-app-passthrough` | `app.bokito.ai/*` (more specific) | Control-plane passthrough |

Deploy tenant router:

```bash
cd cloudflare-workers/bokito-tenant-router
npx wrangler deploy
```

Worker env vars: `BOKITO_API_ORIGIN`, `BOKITO_STATIC_ORIGIN`.

### Verification

Compare headers from `https://app.bokito.ai` vs direct `bokitoapp-prod-*.f2.xano.io` (`ETag`, `Last-Modified`). Mismatch often indicates wrong Worker upstream.

Login page JS bundle should contain `build:` and `APP_VERSION` after a successful deploy.

## Dashboard frontend env

See [`apps/dashboard/.env.example`](../../apps/dashboard/.env.example):

| Variable | Purpose |
|----------|---------|
| `VITE_XANO_BASE_URL` | Xano instance base |
| `VITE_API_GROUP_*` | API group canonicals |
| `VITE_APP_CONTROL_PLANE_HOST` | `app.bokito.ai` |
| `VITE_TENANT_ROOT_DOMAIN` | `.bokito.ai` |
| `VITE_APP_CONTROL_PLANE_HOST_DEV` | `app.localhost` |
| `VITE_TENANT_ROOT_DOMAIN_DEV` | `.localhost` |
| `VITE_APP_CONTROL_PLANE_URL` | Full dev control-plane origin |

Vite bakes `VITE_*` at build time.

## Agent containers

Docker image: `packages/docker/agent-run`. Run with `--add-host=host.docker.internal:host-gateway` for Ollama access on the VPS host.

Run token = `work_log_id` (UUID) passed as `auth_token` in request bodies.

## Related docs

- [02 – Tenant and hosting](02-tenant-and-hosting.md)
- [05 – Workforce and agents](05-workforce-and-agents.md)
- [`xano-patches/v1/INFRA.md`](../../xano-patches/v1/INFRA.md)
- [README](README.md)
