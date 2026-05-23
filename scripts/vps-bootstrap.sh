#!/usr/bin/env bash
# One-time VPS bootstrap for Bokito runtime (run as root on Hostinger VPS 859418).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt update && apt upgrade -y

apt install -y docker.io git redis-server curl ca-certificates gnupg
systemctl enable --now docker redis-server

if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

if ! command -v pm2 >/dev/null; then
  npm install -g pm2
  pm2 startup systemd -u root --hp /root | tail -1 | bash || true
fi

if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
  systemctl enable --now ollama
fi
ollama pull nomic-embed-text-v2-moe || true

if ! command -v caddy >/dev/null; then
  apt install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt update && apt install -y caddy
fi

cat >/etc/caddy/Caddyfile <<'EOF'
worker.bokito.ai {
    reverse_proxy localhost:3300
}
EOF
systemctl enable --now caddy

ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

mkdir -p /root/bokito-runtime/secrets
echo "Bootstrap complete. Clone repo and configure /root/bokito-runtime/.env"
touch /root/bootstrap.done
