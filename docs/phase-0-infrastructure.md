# Phase 0 - Infrastructure setup checklist

Co-driven setup on Hostinger KVM 4 (Ubuntu 24.04 + Docker). Run each verification before Phase 1.

## VPS (Step 0.1-0.2)

```bash
apt update && apt upgrade -y
docker --version && systemctl is-enabled docker
apt install -y redis-server
# /etc/redis/redis.conf: appendonly yes, bind 127.0.0.1, requirepass <password>
systemctl enable --now redis-server
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
npm install -g pm2 && pm2 startup systemd -u root --hp /root
curl -fsSL https://ollama.com/install.sh | sh
ollama pull nomic-embed-text-v2-moe
ufw allow OpenSSH && ufw enable
```

## Environment (Step 0.7)

Copy `apps/runtime/.env.example` to `/root/bokito-runtime/.env` on the VPS. Generate `WORKER_INBOUND_SECRET` with `openssl rand -hex 32` and set the same value in Xano workspace env.

## Verification checklist

1. `ssh root@<vps>` connects
2. `docker run --rm hello-world` succeeds
3. `redis-cli -a <password> ping` returns PONG
4. `node --version` reports v20.x
5. Ollama embeddings return length 768 for nomic-embed-text-v2-moe
6. Xano worker API key returns 200 on auth/me
7. GitHub App created with PEM on VPS
8. `.env` complete on VPS; `.env.example` committed (no secrets)
9. Anthropic API test returns 200
10. WORKER_INBOUND_SECRET matches between VPS and Xano (compare hashes only)

## Deploy runtime after Phase 2

```bash
cd /root/bokito-runtime
git pull
npm install
npm run build -w @bokito/runtime
docker build -t bokito-agent-run:latest packages/docker/agent-run
pm2 start apps/runtime/ecosystem.config.cjs
```
