"""Upload local dashboard dist to prod web container."""
from __future__ import annotations

import os
import subprocess
import tempfile

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIST = os.path.join(ROOT, "apps", "dashboard", "dist")


def main() -> int:
    if not os.path.isdir(DIST):
        raise SystemExit(f"Missing dist: {DIST}")

    tar_path = tempfile.mktemp(suffix=".tar.gz")
    subprocess.check_call(["tar", "-czf", tar_path, "-C", DIST, "."])

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    sftp = client.open_sftp()
    remote_tar = "/tmp/bokito-web-dist.tar.gz"
    sftp.put(tar_path, remote_tar)
    sftp.close()
    os.remove(tar_path)

    remote = """
set -euo pipefail
cid=$(cd /opt/bokito && docker compose -p bokito ps -q web)
tmpdir=$(mktemp -d)
tar -xzf /tmp/bokito-web-dist.tar.gz -C "$tmpdir"
# Caddy serves from /srv in the web image (common pattern); detect path
docker exec "$cid" sh -c 'ls /srv >/dev/null 2>&1 && echo /srv || (ls /usr/share/caddy >/dev/null 2>&1 && echo /usr/share/caddy || echo /var/www/html)'
root=$(docker exec "$cid" sh -c 'if [ -d /srv ]; then echo /srv; elif [ -d /usr/share/caddy ]; then echo /usr/share/caddy; else echo /var/www/html; fi')
echo "web_root=$root"
docker cp "$tmpdir/." "$cid:$root/"
rm -rf "$tmpdir" /tmp/bokito-web-dist.tar.gz
echo dashboard_dist_deployed
"""
    _, stdout, stderr = client.exec_command(remote, timeout=180)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err.strip():
        print(err, file=__import__("sys").stderr)
    code = stdout.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
