# Phase 0 - Infrastructure setup checklist

Co-driven setup on Hostinger VPS (Ubuntu 24.04). Run each verification before enabling crons.

## Hostinger inventory (2026-05-23)

| Item | Value |
|------|-------|
| VPS id | 859418 |
| Plan | KVM 2 (2 vCPU, 8 GB RAM) |
| IPv4 | 31.97.45.44 |
| Hostname | srv859418.hstgr.cloud |
| Template | Ubuntu 24.04 LTS (install Docker manually) |
| SSH key | Developement key in hPanel |

## VPS software (Step 0.2)

```bash
apt update && apt upgrade -y
apt install -y docker.io && systemctl enable --now docker
apt install -y redis-server
# /etc/redis/redis.conf: appendonly yes, bind 127.0.0.1, requirepass <password>
systemctl enable --now redis-server
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
npm install -g pm2 && pm2 startup systemd -u root --hp /root
curl -fsSL https://ollama.com/install.sh | sh && systemctl enable --now ollama
ollama pull nomic-embed-text-v2-moe
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
```

## Caddy reverse proxy (DECISION: Caddy only)

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
worker.bokito.ai {
    reverse_proxy localhost:3300
}
```

```bash
systemctl enable --now caddy
```

### Cloudflare DNS (required)

Add `worker` A record to `31.97.45.44` as **DNS only (grey cloud)** so the wildcard `*.bokito.ai` Worker does not intercept traffic.

Set FastAPI env: `WORKER_BASE_URL=https://worker.bokito.ai`

Runtime binds localhost only: `WORKER_BIND_HOST=127.0.0.1`

## Environment (Step 0.7)

Copy `apps/runtime/.env.example` to `/root/bokito-runtime/.env`. Generate `WORKER_INBOUND_SECRET` with `openssl rand -hex 32` and set the same value in FastAPI workspace env.

## Deploy runtime

```bash
mkdir -p /root/bokito-runtime/secrets
cd /root/bokito-runtime
git clone <repo-url> .
cp apps/runtime/.env.example .env   # fill values
bash scripts/deploy-runtime-vps.sh
```

## Verification checklist

1. `ssh root@31.97.45.44` connects
2. `docker run --rm hello-world` succeeds
3. `redis-cli -a <password> ping` returns PONG
4. `node --version` reports v20.x
5. Ollama embeddings return length 768 for nomic-embed-text-v2-moe
6. FastAPI worker API key returns 200 on auth/me
7. GitHub App PEM at `/root/bokito-runtime/secrets/github-app.pem`
8. `.env` complete on VPS; secrets not in git
9. Anthropic API test returns 200
10. `WORKER_INBOUND_SECRET` hash matches FastAPI env
11. `curl https://worker.bokito.ai/health` returns JSON `{ok:true}`
12. `curl -X POST https://worker.bokito.ai/agent/po/run -H "Authorization: Bearer $SECRET" -d '{}'` returns 400/401, not connection refused
