#!/usr/bin/env python3
"""Pull latest master on VPS and redeploy runtime."""
import os
import sys
import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
PASSWORD = os.environ.get("VPS_ROOT_PASSWORD", "")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
ROOT = "/root/bokito-runtime"
REPO = os.environ.get("BOKITO_REPO", "https://github.com/LorenzoBoers/BokitoAiV2.git")


def run(client, cmd, timeout=3600):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode()
    err = stderr.read().decode()
    print(">>>", cmd[:120])
    if out:
        print(out[-3000:])
    if err:
        print(err[-1500:], file=sys.stderr)
    return code, out, err


def connect(client: paramiko.SSHClient) -> None:
    if os.path.isfile(KEY_PATH):
        try:
            client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
            return
        except Exception:
            pass
    if not PASSWORD:
        raise RuntimeError("Configure VPS_SSH_KEY or VPS_ROOT_PASSWORD")
    client.connect(HOST, username="root", password=PASSWORD, timeout=30)


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect(client)

    _, out, _ = run(client, f"test -d {ROOT}/.git && echo HASGIT || echo NOGIT", 30)
    if "HASGIT" not in out:
        code, _, _ = run(client, f"rm -rf {ROOT} && git clone {REPO} {ROOT}", 600)
        if code != 0:
            client.close()
            return code
    else:
        code, _, _ = run(
            client,
            f"cd {ROOT} && git fetch origin master && git reset --hard origin/master",
            300,
        )
        if code != 0:
            client.close()
            return code

    _, env_out, _ = run(client, f"test -f {ROOT}/.env && echo env_ok || echo env_missing", 30)

    if "env_missing" in env_out:
        env_body = """XANO_BASE_URL=https://xrex-nmji-j9ur.f2.xano.io
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
        sftp = client.open_sftp()
        with sftp.file(f"{ROOT}/.env", "w") as f:
            f.write(env_body)
        sftp.close()
        print("wrote .env")

    code, _, _ = run(client, f"cd {ROOT} && bash scripts/deploy-runtime-vps.sh", 3600)
    run(client, "curl -sf http://127.0.0.1:3300/health", 30)
    run(client, "curl -sf https://worker.bokito.ai/health", 30)
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
