#!/usr/bin/env python3
import os
import paramiko

KEY = os.path.expanduser("~/.ssh/bokito_vps_deploy")
HOST = os.environ.get("VPS_HOST", "31.97.45.44")


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY, timeout=30)
    script = r"""
set -e
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-bokito
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sshd -t
systemctl reload ssh || systemctl reload sshd
echo ssh_hardened_ok
"""
    _, stdout, stderr = client.exec_command(script, timeout=60)
    print(stdout.read().decode(), stderr.read().decode())
    code = stdout.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
