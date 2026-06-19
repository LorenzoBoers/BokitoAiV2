#!/usr/bin/env python3
"""Send a test message to MMXM Trader thread and wait for agent reply on prod."""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("PROD_BASE", "https://app.bokito.ai")
EMAIL = os.environ.get("PROD_EMAIL", "trader@bokito.ai")
PASSWORD = os.environ.get("PROD_PASSWORD", "BokitoProd-Trader-2026!")
THREAD_ID = os.environ.get("THREAD_ID", "847c0b0e-6bd3-440b-a352-bd1c32701667")


def req(method: str, path: str, body: dict | None = None, token: str | None = None) -> dict:
    url = f"{BASE}{path}"
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=60) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    login = req("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
    token = login["access_token"]
    print("login_ok tenant=", login.get("tenant", {}).get("slug"))

    body_text = f"Prod smoke: report execution_mode and whether trading MCP is reachable. ({int(time.time())})"
    msg = req(
        "POST",
        f"/api/signals/{THREAD_ID}/reply",
        {"body_text": body_text},
        token=token,
    )
    print("sent_message id=", msg.get("id"))

    for attempt in range(12):
        time.sleep(5)
        thread = req("GET", f"/api/signals/{THREAD_ID}", token=token)
        messages = thread.get("messages") or []
        agent_msgs = [
            m
            for m in messages
            if m.get("kind") == "agent_message"
            or m.get("payload", {}).get("agent_id")
            or m.get("author_type") == "agent"
        ]
        latest_agent = agent_msgs[-1] if agent_msgs else None
        if latest_agent and latest_agent.get("created_at", "") >= msg.get("created_at", ""):
            print("agent_reply:", (latest_agent.get("body") or "")[:500])
            return 0
        print(f"waiting for agent reply... attempt {attempt + 1}/12")

    print("no agent reply within timeout", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
