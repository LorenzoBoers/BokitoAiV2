#!/usr/bin/env python3
"""Update VPS /root/bokito-runtime/.env and reload PM2."""
import os
import sys
import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
PASSWORD = os.environ.get("VPS_ROOT_PASSWORD", "")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
ROOT = "/root/bokito-runtime"
ANTHROPIC = os.environ.get("ANTHROPIC_API_KEY", "")

BASE_ENV = """XANO_BASE_URL=https://xrex-nmji-j9ur.f2.xano.io
XANO_WORKER_API_KEY=SBP1e-dbWgRcgchFVME6pGKy2VCigp6yR4tkPGsj51I
REDIS_URL=redis://127.0.0.1:6379
WORKER_INBOUND_SECRET=97e28b2fa528dfd1b9863d9a464225618d21970d6821cd953965fd172f720991
WORKER_PORT=3300
WORKER_BIND_HOST=127.0.0.1
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text-v2-moe
DOCKER_IMAGE_TAG=bokito-agent-run:latest
DOCKER_IMAGE_TAG_PLAYWRIGHT=bokito-agent-run-playwright:latest
BULL_BOARD_BASIC_AUTH=admin:bokito2026
"""


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    if os.path.isfile(KEY_PATH):
        try:
            client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
            return client
        except Exception:
            pass
    if not PASSWORD:
        raise RuntimeError("Set VPS_ROOT_PASSWORD or configure SSH key auth")
    client.connect(HOST, username="root", password=PASSWORD, timeout=30)
    return client


def main():
    if not ANTHROPIC:
        print("Set ANTHROPIC_API_KEY", file=sys.stderr)
        return 1
    env = BASE_ENV + f"ANTHROPIC_API_KEY={ANTHROPIC}\n"
    client = connect()
    sftp = client.open_sftp()
    with sftp.file(f"{ROOT}/.env", "w") as f:
        f.write(env)
    sftp.close()
    _, stdout, stderr = client.exec_command(
        f"cd {ROOT}/apps/runtime && pm2 reload ecosystem.config.cjs --update-env && pm2 save",
        timeout=120,
    )
    code = stdout.channel.recv_exit_status()
    if stdout.read().decode():
        print(stdout.read().decode()[-1000:])
    if code != 0:
        print(stderr.read().decode(), file=sys.stderr)
    client.close()
    print("VPS .env updated and PM2 reloaded")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
