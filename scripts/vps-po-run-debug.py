#!/usr/bin/env python3
import json
import os
import time
import urllib.request
import paramiko

KEY = os.path.expanduser("~/.ssh/bokito_vps_deploy")
SECRET = "97e28b2fa528dfd1b9863d9a464225618d21970d6821cd953965fd172f720991"
BODY = {
    "project_id": "7baa7578-2119-40a5-bdde-b1bb3e2ef27d",
    "tenant_id": "067ebc22-6aac-4986-868b-857bc1c55f5f",
    "po_agent_id": "96312783-18b2-4484-a31b-60b815f69740",
}

req = urllib.request.Request(
    "https://worker.bokito.ai/agent/po/run",
    data=json.dumps(BODY).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {SECRET}"},
    method="POST",
)
started = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
print("started", started)
time.sleep(15)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("31.97.45.44", username="root", key_filename=KEY, timeout=30)
for cmd in [
    "docker ps -a --format '{{.ID}} {{.Status}} {{.Names}}' | head -5",
    "pm2 logs bokito-runtime --lines 80 --nostream",
]:
    _, stdout, _ = client.exec_command(cmd, timeout=60)
    print(">>>", cmd)
    print(stdout.read().decode()[-5000:])
client.close()
