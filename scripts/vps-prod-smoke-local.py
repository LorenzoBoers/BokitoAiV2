#!/usr/bin/env python3
"""Run prod smoke via VPS localhost (bypasses Cloudflare bot protection)."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
EMAIL = os.environ.get("PROD_EMAIL", "trader@bokito.ai")
PASSWORD = os.environ.get("PROD_PASSWORD", "BokitoProd-Trader-2026!")
THREAD_ID = os.environ.get("THREAD_ID", "847c0b0e-6bd3-440b-a352-bd1c32701667")

REMOTE = f"""
python3 <<'PY'
import json
import time
import urllib.request

BASE = "http://127.0.0.1:8088"
EMAIL = {EMAIL!r}
PASSWORD = {PASSWORD!r}
THREAD_ID = {THREAD_ID!r}


def req(method, path, body=None, token=None):
    url = BASE + path
    data = None if body is None else json.dumps(body).encode()
    headers = {{"Content-Type": "application/json"}}
    if token:
        headers["Authorization"] = f"Bearer {{token}}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=60) as resp:
        return json.loads(resp.read().decode())

login = req("POST", "/api/auth/login", {{"email": EMAIL, "password": PASSWORD}})
token = login["access_token"]
print("login_ok tenant=", login.get("tenant", {{}}).get("slug"))

agents = req("GET", "/api/workforce/agents", token=token)
items = agents.get("items") or []
print("agents_count=", len(items))
for a in items:
    print(" agent:", a.get("name"), a.get("role_slug") or a.get("role"))

body_text = f"Prod smoke local: report execution_mode and MCP status. ({{int(time.time())}})"
msg = req("POST", f"/api/signals/{{THREAD_ID}}/reply", {{"body_text": body_text}}, token=token)
print("sent_message id=", msg.get("id"))

for attempt in range(12):
    time.sleep(5)
    thread = req("GET", f"/api/signals/{{THREAD_ID}}", token=token)
    messages = thread.get("messages") or []
    agent_msgs = [m for m in messages if m.get("kind") == "agent_message" or m.get("payload", {{}}).get("agent_id")]
    latest = agent_msgs[-1] if agent_msgs else None
    if latest and latest.get("created_at", "") >= msg.get("created_at", ""):
        print("agent_reply:", (latest.get("body") or "")[:500])
        raise SystemExit(0)
    print(f"waiting for agent reply... {{attempt + 1}}/12")

print("no agent reply within timeout")
raise SystemExit(1)
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=180)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    code = stdout.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
