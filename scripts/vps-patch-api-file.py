#!/usr/bin/env python3
"""Copy a local API source file into the running prod container and restart api."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: vps-patch-api-file.py apps/api/app/services/signal_threads.py", file=sys.stderr)
        return 1
    rel = sys.argv[1].replace("\\", "/")
    local_path = os.path.join(REPO_ROOT, rel)
    if not os.path.isfile(local_path):
        print(f"Not found: {local_path}", file=sys.stderr)
        return 1
    container_path = "/app/" + rel.split("apps/api/", 1)[-1]

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    remote_tmp = f"/tmp/{os.path.basename(local_path)}"
    sftp = client.open_sftp()
    sftp.put(local_path, remote_tmp)
    sftp.close()

    cmds = [
        f"docker cp {remote_tmp} bokito-api-1:{container_path}",
        "docker compose -p bokito restart api",
    ]
    for cmd in cmds:
        _, stdout, stderr = client.exec_command(cmd, timeout=180)
        out = stdout.read().decode()
        err = stderr.read().decode()
        code = stdout.channel.recv_exit_status()
        if out:
            print(out, end="" if out.endswith("\n") else "\n")
        if err:
            print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
        if code != 0:
            client.close()
            return code
    client.close()
    print(f"Patched {container_path} and restarted api")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
