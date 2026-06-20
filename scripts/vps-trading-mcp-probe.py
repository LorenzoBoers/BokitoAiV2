#!/usr/bin/env python3
"""Probe trading MCP from Bokito api container (tools/list + risk_status)."""
import json
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
import json
import os
import urllib.request

URL = os.environ.get("TRADING_MCP_URL", "http://trading-exec-mcp:8002/mcp")
KEY = os.environ.get("TRADING_MCP_API_KEY", "local-dev-key")


def mcp_call(method, params=None):
    body = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        body["params"] = params
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def mcp_tool(name, arguments=None):
    return mcp_call(
        "tools/call",
        {"name": name, "arguments": arguments or {}},
    )


print("mcp_url:", URL)
try:
    tools = mcp_call("tools/list")
    names = [t.get("name") for t in (tools.get("result") or {}).get("tools") or []]
    print("tools:", names)
except Exception as exc:
    print("tools/list error:", exc)
    raise SystemExit(1)

for tool in ("risk_status", "execution_status", "list_setups", "list_trade_plans"):
    if tool not in names:
        continue
    try:
        out = mcp_tool(tool)
        content = (out.get("result") or {}).get("content") or []
        text = content[0].get("text") if content else json.dumps(out)[:800]
        print(f"\n{tool}:")
        print(text[:1200] if isinstance(text, str) else text)
    except Exception as exc:
        print(f"\n{tool} error:", exc)
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
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
