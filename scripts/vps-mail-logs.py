#!/usr/bin/env python3
import os
import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
cd /opt/bokito && docker compose -p bokito logs api --since 72h --tail 8000 2>&1 | grep -iE '320b3fea|65cd2cd3|harold|bourgondien|smtp|send_smtp|deliver_outbound|auth_expired|no_credentials|Failed to|traceback' | tail -100
echo '==== worker ===='
docker compose -p bokito logs worker --since 72h --tail 4000 2>&1 | grep -iE '320b3fea|65cd2cd3|harold|smtp|send_smtp' | tail -40
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=180)
    print(stdout.read().decode(errors="replace"), end="")
    err = stderr.read().decode(errors="replace")
    if err:
        print(err[-2000:], file=__import__("sys").stderr)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
