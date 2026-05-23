#!/usr/bin/env python3
"""Run VPS bootstrap + deploy via SSH (password auth)."""
import os
import sys
import time
import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
USER = "root"
PASSWORD = os.environ.get("VPS_ROOT_PASSWORD", "")
REPO = os.environ.get("BOKITO_REPO", "https://github.com/LorenzoBoers/BokitoAiV2.git")
ROOT = "/root/bokito-runtime"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BOOTSTRAP = os.path.join(SCRIPT_DIR, "vps-bootstrap.sh")

def run(client: paramiko.SSHClient, cmd: str, timeout: int = 3600) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    return code, stdout.read().decode(), stderr.read().decode()

def main() -> int:
    if not PASSWORD:
        print("Set VPS_ROOT_PASSWORD", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    sftp = client.open_sftp()
    sftp.put(BOOTSTRAP, "/root/vps-bootstrap.sh")
    sftp.close()

    print("[1/4] bootstrap (may take 10-20 min)...")
    chan = client.get_transport().open_session()
    chan.exec_command(
        "chmod +x /root/vps-bootstrap.sh && "
        "nohup bash /root/vps-bootstrap.sh > /root/bootstrap.log 2>&1 </dev/null & echo started"
    )
    chan.close()
    print("bootstrap started in background")
    if code != 0:
        print(err, file=sys.stderr)
        return code

    for i in range(120):
        time.sleep(15)
        _, out, _ = run(client, "test -f /root/bootstrap.done && echo DONE || tail -3 /root/bootstrap.log", timeout=30)
        print(f"  poll {i+1}: {out.strip()[:200]}")
        if "DONE" in out:
            break
    else:
        print("bootstrap timeout", file=sys.stderr)
        return 2

    print("[2/4] clone repo...")
    code, out, err = run(
        client,
        f"rm -rf {ROOT} && git clone {REPO} {ROOT}",
        timeout=600,
    )
    print(out[-500:] if out else err[-500:])
    if code != 0:
        return code

    env_content = os.environ.get("VPS_ENV_FILE", "")
    if env_content:
        print("[3/4] write .env...")
        sftp = client.open_sftp()
        with sftp.file(f"{ROOT}/.env", "w") as f:
            f.write(env_content)
        sftp.close()
    else:
        print("[3/4] skip .env (VPS_ENV_FILE not set)")

    print("[4/4] deploy...")
    code, out, err = run(
        client,
        f"cd {ROOT} && bash scripts/deploy-runtime-vps.sh",
        timeout=3600,
    )
    print(out[-2000:] if out else "")
    if err:
        print(err[-1000:], file=sys.stderr)
    client.close()
    return code

if __name__ == "__main__":
    raise SystemExit(main())
