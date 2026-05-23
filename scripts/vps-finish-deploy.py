#!/usr/bin/env python3
"""Finish VPS deploy after bootstrap: clone, .env, deploy, verify."""
import os
import sys
import time
import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
PASSWORD = os.environ.get("VPS_ROOT_PASSWORD", "")
ROOT = "/root/bokito-runtime"
REPO = os.environ.get("BOKITO_REPO", "https://github.com/LorenzoBoers/BokitoAiV2.git")

ENV = """XANO_BASE_URL=https://xrex-nmji-j9ur.f2.xano.io
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


def run(client, cmd, timeout=3600):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    return code, stdout.read().decode(), stderr.read().decode()


def main():
    if not PASSWORD:
        print("Set VPS_ROOT_PASSWORD", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=30)

    for i in range(80):
        _, out, _ = run(client, "test -f /root/bootstrap.done && echo DONE || tail -1 /root/bootstrap.log", 60)
        line = out.strip().split("\n")[-1]
        print(f"bootstrap poll {i+1}: {line[:120]}")
        if "DONE" in out:
            break
        time.sleep(20)
    else:
        print("bootstrap timeout", file=sys.stderr)
        return 2

    code, out, err = run(client, f"rm -rf {ROOT} && git clone {REPO} {ROOT}", 600)
    if code != 0:
        print(err or out, file=sys.stderr)
        return code
    print("cloned:", out.strip()[-80:])

    sftp = client.open_sftp()
    with sftp.file(f"{ROOT}/.env", "w") as f:
        f.write(ENV)
    sftp.close()
    print("wrote .env")

    code, out, err = run(client, f"cd {ROOT} && bash scripts/deploy-runtime-vps.sh", 3600)
    print(out[-3000:] if out else "")
    if err:
        print(err[-1500:], file=sys.stderr)
    if code != 0:
        return code

    for path in ["/health", ""]:
        _, out, _ = run(client, f"curl -sf http://127.0.0.1:3300/health", 30)
        print("local health:", out.strip())

    _, out, _ = run(client, "curl -sf https://worker.bokito.ai/health || curl -sk https://worker.bokito.ai/health", 30)
    print("public health:", out.strip())

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
