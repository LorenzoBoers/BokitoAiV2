"""One-off live smoke: BL MCP connect + inbound email -> grounded suggestion."""

import json
import time
import urllib.request

BASE = "http://127.0.0.1:8000"


def call(method: str, path: str, payload=None, token=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main():
    login = call("POST", "/api/auth/login", {"email": "admin@bokito.ai", "password": "bokito-test-password"})
    token = login["access_token"]
    print("[1] login ok")

    install = call(
        "POST",
        "/api/integrations/mcp/install",
        {"provider": "bjorn_lunden_mcp", "display_name": "Björn Lundén"},
        token,
    )
    discovery = install.get("discovery") or {}
    tools = [t["name"] for t in discovery.get("tools", [])]
    print(f"[2] BL MCP installed, discovery ok={discovery.get('ok')} tools={tools}")
    assert "list_invoices" in tools, "accounting tools not discovered"

    inbound = call(
        "POST",
        "/api/email/mock/inbound",
        {
            "from_address": "finance@clientfirm.se",
            "subject": "Vraag over openstaande facturen",
            "body_text": "Kunnen jullie nakijken welke facturen nog openstaan voor ons bedrijf?",
        },
        token,
    )
    thread_id = inbound["thread_id"]
    print(f"[3] inbound simulated, thread={thread_id} status={inbound['status']}")

    decision_msg = None
    for _ in range(20):
        time.sleep(1.5)
        thread = call("GET", f"/api/signals/{thread_id}", None, token)
        msgs = thread.get("messages", [])
        decision_msg = next((m for m in msgs if m.get("kind") == "decision_request"), None)
        if decision_msg:
            break
    assert decision_msg, "no suggestion/decision card appeared on the thread"
    print(f"[4] decision card on thread: '{(decision_msg.get('body_text') or '')[:80]}'")

    servers = call("GET", "/api/integrations/mcp/servers", None, token)
    bl = next(s for s in servers if "Lund" in s["name"])
    print(f"[5] server tools cached: {len(bl['tools'])} synced_at={bl['tools_synced_at']}")
    print("SMOKE OK")


if __name__ == "__main__":
    main()
