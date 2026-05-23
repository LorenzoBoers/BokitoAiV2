#!/usr/bin/env python3
import os
import paramiko

KEY = os.path.expanduser("~/.ssh/bokito_vps_deploy")
HOST = os.environ.get("VPS_HOST", "31.97.45.44")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username="root", key_filename=KEY, timeout=30)
for cmd in [
    "docker ps -a --format '{{.ID}} {{.Status}} {{.Names}}' | head -8",
    "pm2 logs bokito-runtime --lines 40 --nostream",
]:
    _, stdout, stderr = client.exec_command(cmd, timeout=90)
    print(">>>", cmd)
    print(stdout.read().decode()[-4000:])
    err = stderr.read().decode()
    if err:
        print(err[-1000:])
client.close()
