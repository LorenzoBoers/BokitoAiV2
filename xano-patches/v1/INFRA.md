# V1 infrastructure record (no secrets)

Last updated: 2026-05-23

## Hostinger VPS

| Field | Value |
|-------|-------|
| Provider | Hostinger KVM 2 |
| VPS id | 859418 |
| IPv4 | 31.97.45.44 |
| Hostname | srv859418.hstgr.cloud |
| OS | Ubuntu 24.04 LTS |
| SSH | Developement key attached in hPanel |

## DNS / routing

| Host | Target | Notes |
|------|--------|-------|
| `worker.bokito.ai` | A -> 31.97.45.44 | Must be Cloudflare **DNS only** (grey cloud) |
| `app.bokito.ai` | Xano static / Cloudflare | Portal (separate from worker) |

## Runtime

| Item | Value |
|------|-------|
| Repo path on VPS | `/root/bokito-runtime` |
| Process manager | PM2 (`apps/runtime/ecosystem.config.cjs`) |
| Bind | `127.0.0.1:3300` |
| Public URL | `https://worker.bokito.ai` via Caddy |
| Docker images | `bokito-agent-run:latest`, `bokito-agent-run-playwright:latest` |

## Xano env keys (names only)

- `WORKER_BASE_URL`
- `WORKER_INBOUND_SECRET`
- `XANO_WORKER_API_KEY`
- `EXPO_ACCESS_TOKEN`
- `GITHUB_APP_WEBHOOK_SECRET`

## Embedding contract

- Index worker + agent containers embed via Ollama on VPS host
- Agent container uses `http://host.docker.internal:11434` (`--add-host=host.docker.internal:host-gateway`)
- Xano `/index/search` accepts **embedding only**

## Deploy

```bash
bash scripts/deploy-runtime-vps.sh
```
