# Infrastructure and deploy

Last updated: June 2026

This chapter covers the single-VPS Docker Compose runtime, Cloudflare DNS, and key environment variables. The full deploy log + bokito.ai cutover lives in `BOKITO_KNOWLEDGE.md` §17.

VPS checklist: [`docs/phase-0-infrastructure.md`](../phase-0-infrastructure.md).

> **Superseded (V1):** the earlier worker-plane (Node on :3300 with PM2/BullMQ/Ollama), the FastAPI Metadata-API static-host pipeline (`deploy.ps1`, `bokitoapp-prod-*`), and the Cloudflare Workers (`bokito-tenant-router`, `bokito-app-passthrough`) are **retired**. They are documented only in `docs/archived/v1/`. `worker.bokito.ai` (:3300, DNS-only) is a separate pre-existing service, untouched by the Bokito app.

## Runtime: single VPS, Docker Compose + Caddy

| Item | Value |
|------|-------|
| Host | Hostinger VPS `srv859418` (`31.97.45.44`), Ubuntu 24.04, 2 vCPU / 8 GB |
| Orchestration | Docker Compose (`docker-compose.prod.yml`) |
| Services | `postgres` (pgvector), `redis`, `api` (uvicorn, 1 replica), `worker` (arq), `web` (Caddy + SPA/widget) |
| Reverse proxy / TLS | Caddy (`web` container, host-agnostic `{$BOKITO_DOMAIN}` block) |
| Checkout | `/opt/bokito` (git pull + compose up to redeploy) |

Deploy / redeploy:

```bash
cp .env.prod.example .env.prod   # fill secrets
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Run exactly **one** `api` replica: the in-process trigger scheduler has no distributed lock, so multiple replicas would double-fire triggers.

Static bundles are built inside the `web` image (`apps/dashboard/Dockerfile`): the dashboard SPA and the webchat widget (served at `/chat-widget/*`). `VITE_*` build args are baked at build time, so a domain/version change requires `docker compose -f docker-compose.prod.yml build web && up -d web` (not just a restart).

## Cloudflare (current)

### DNS (zone `bokito.ai` → VPS `31.97.45.44`)

| Record | Type | Proxy | Role |
|--------|------|-------|------|
| `bokito.ai` | A | Proxied | App entry (VPS API + SPA) |
| `app.bokito.ai` | A | Proxied | Control plane (login / workspace hub) |
| `api.bokito.ai` | A | Proxied | FastAPI backend (moved off the old Xano API) |
| `*.bokito.ai` | A | Proxied | Tenant subdomains (required for `<slug>.bokito.ai`) |
| `worker.bokito.ai` | A | DNS only | Pre-existing Node service (:3300) |

No Cloudflare Workers / routes are involved anymore — requests hit the VPS Caddy directly. Mail/SendGrid records are unchanged. `bokito.chargecars.app` still resolves to the VPS but the SPA redirects it client-side to `app.bokito.ai` (the baked control-plane host).

### Verification

```bash
curl -sI https://app.bokito.ai/api/health   # 200 {"ok":true,"service":"bokito-api"}
curl -s  -X POST https://app.bokito.ai/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<user>","password":"<pw>"}'  # returns access_token + tenant
```

The login JS bundle is built with `VITE_APP_VERSION` for the footer version label.

## Dashboard frontend env

See [`apps/dashboard/.env.example`](../../apps/dashboard/.env.example):

| Variable | Purpose |
|----------|---------|
| `VITE_BOKITO_API_URL` | FastAPI instance base |
| `VITE_API_GROUP_*` | API group canonicals |
| `VITE_APP_CONTROL_PLANE_HOST` | Control-plane / login host (prod default `app.bokito.ai`; baked at build time) |
| `VITE_TENANT_ROOT_DOMAIN` | Tenant subdomain suffix (prod default `.bokito.ai`) |
| `VITE_APP_CONTROL_PLANE_HOST_DEV` | `app.localhost` |
| `VITE_TENANT_ROOT_DOMAIN_DEV` | `.localhost` |
| `VITE_APP_CONTROL_PLANE_URL` | Full dev control-plane origin |

Vite bakes `VITE_*` at build time.

## CI/CD (GitHub Actions + GHCR + VPS)

Canonical guide: [`docs/DEPLOY.md`](../DEPLOY.md).

| Stage | Trigger | Target |
|-------|---------|--------|
| CI | push / PR to `master` | ruff, pytest, dashboard build, Playwright e2e |
| Build | CI success on `master` | Push `ghcr.io/lorenzoboers/bokito-api:<sha>` + web images (`-staging` / `-prod`) |
| Staging deploy | automatic | `https://staging.bokito.ai` (`bokito-staging` compose project, port 8089) |
| Production deploy | GitHub Environment approval | `https://app.bokito.ai` (same API image digest as staging) |

Rollback: previous image tags saved in `.rollback.prod.env`; production smoke failure triggers automatic rollback in the workflow.

## Agent containers

Docker image: `packages/docker/agent-run`. Run with `--add-host=host.docker.internal:host-gateway` for Ollama access on the VPS host.

Run token = `work_log_id` (UUID) passed as `auth_token` in request bodies.

## Related docs

- [02 – Tenant and hosting](02-tenant-and-hosting.md)
- [05 – Workforce and agents](05-workforce-and-agents.md)
- [`docs/archived/v1/INFRA.md`](../../docs/archived/v1/INFRA.md)
- [README](README.md)
