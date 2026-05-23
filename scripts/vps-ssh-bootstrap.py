#!/usr/bin/env python3
import os
import sys
import paramiko

HOST = "31.97.45.44"
PASSWORD = os.environ.get("VPS_ROOT_PASSWORD", "")
PUB = open(os.path.expanduser("~/.ssh/bokito_vps_deploy.pub")).read().strip()
KEY = os.path.expanduser("~/.ssh/bokito_vps_deploy")


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=30)
    cmd = (
        "mkdir -p /root/.ssh && chmod 700 /root/.ssh && "
        f"grep -qxF '{PUB}' /root/.ssh/authorized_keys 2>/dev/null || "
        f"echo '{PUB}' >> /root/.ssh/authorized_keys && "
        "chmod 600 /root/.ssh/authorized_keys && echo authorized_ok"
    )
    _, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode(), stderr.read().decode())
    client.close()

    test = paramiko.SSHClient()
    test.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    test.connect(HOST, username="root", key_filename=KEY, timeout=30)
    test.close()
    print("deploy_key_auth_ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
