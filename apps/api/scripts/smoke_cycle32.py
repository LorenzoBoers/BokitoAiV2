"""Cycle 32 live smoke: end-to-end accountancy journey against the local dev stack.

Journey: SSO wiring check, onboarding email-first checklist, BL MCP connect,
inbound client email, suggest-mode decision card, approve with edited free
text, reply lands on the thread, compose with cc, palette search endpoints,
and notification prefs including the decisions category.

Run with the dev API on 127.0.0.1:8000 (LLM_MODE=mock, seeded admin).
"""

import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"


def call(method: str, path: str, payload=None, token=None, expect_error=False):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        if not expect_error:
            raise
        return err.code, json.loads(err.read().decode() or "{}")


def main():
    _, login = call(
        "POST", "/api/auth/login", {"email": "admin@bokito.ai", "password": "bokito-test-password"}
    )
    token = login["access_token"]
    print("[1] login ok")

    status, _ = call("GET", "/api/auth/microsoft/start", token=token, expect_error=True)
    assert status == 503, f"SSO start should be 503 when unconfigured in dev, got {status}"
    print("[2] Microsoft SSO endpoint wired (503 until Entra app configured)")

    _, onboarding = call("GET", "/api/app/onboarding", token=token)
    step_ids = [s["id"] for s in onboarding["steps"]]
    assert step_ids[0] == "email", f"expected email-first onboarding, got {step_ids}"
    print(f"[3] onboarding checklist email-first: {step_ids}")

    _, install = call(
        "POST",
        "/api/integrations/mcp/install",
        {"provider": "bjorn_lunden_mcp", "display_name": "Björn Lundén"},
        token,
    )
    discovery = install.get("discovery") or {}
    tools = [t["name"] for t in discovery.get("tools", [])]
    assert "list_invoices" in tools, f"BL accounting tools not discovered: {tools}"
    print(f"[4] BL MCP connected, {len(tools)} tools discovered")

    _, inbound = call(
        "POST",
        "/api/email/mock/inbound",
        {
            "from_address": "finance@clientfirm.se",
            "subject": "Openstaande facturen Q3",
            "body_text": "Which invoices are still open for our company this quarter?",
        },
        token,
    )
    thread_id = inbound["thread_id"]
    print(f"[5] inbound client email, thread={thread_id}")

    decision_msg = None
    for _ in range(20):
        time.sleep(1.5)
        _, thread = call("GET", f"/api/signals/{thread_id}", token=token)
        msgs = thread.get("messages", [])
        decision_msg = next((m for m in msgs if m.get("kind") == "decision_request"), None)
        if decision_msg:
            break
    assert decision_msg, "no suggest-mode decision card appeared"
    payload = decision_msg.get("payload") or {}
    options = (payload.get("decision") or {}).get("options") or []
    option_ids = [o.get("id") for o in options]
    print(f"[6] decision card with options {option_ids}")

    send_option = next((o for o in options if o.get("id") in ("send", "approve")), options[0])
    free_text = "Please only include invoices from Q3, not the full year."
    _, resolved = call(
        "POST",
        f"/api/signals/{thread_id}/messages/{decision_msg['id']}/resolve",
        {"action": "approved", "option_id": send_option["id"], "response_text": free_text},
        token,
    )
    print(f"[7] decision approved with free-text input: {json.dumps(resolved)[:120]}")

    _, thread = call("GET", f"/api/signals/{thread_id}", token=token)
    answers = [m for m in thread.get("messages", []) if free_text in (m.get("body_text") or "")]
    assert answers, "free-text decision answer not appended to the thread"
    print("[8] free-text answer landed on the thread")

    _, sent = call(
        "POST",
        "/api/email/send",
        {
            "thread_id": thread_id,
            "body_text": "Dear client, invoices 2024-118 and 2024-121 are still open. Regards, Bokito",
            "body_html": "<p>Dear client, invoices 2024-118 and 2024-121 are still open.</p>",
            "cc": "partner@accountancy.example",
        },
        token,
    )
    print(f"[9] reply with cc sent: {json.dumps(sent)[:120]}")

    _, thread = call("GET", f"/api/signals/{thread_id}", token=token)
    outbound = [m for m in thread.get("messages", []) if m.get("direction") == "outbound"]
    assert outbound, "outbound reply missing from the thread"
    print("[10] outbound reply visible on the thread")

    _, results = call("GET", "/api/signals?search=facturen&page=1&per_page=5", token=token)
    assert results.get("items"), "thread search returned nothing"
    _, contacts = call("GET", "/api/channels/contacts?search=clientfirm", token=token)
    assert contacts.get("contacts"), "contact search returned nothing"
    print(f"[11] palette search: {len(results['items'])} threads, {len(contacts['contacts'])} contacts")

    _, prefs = call("GET", "/api/user/notification-preferences", token=token)
    pref_ids = [r["id"] for r in prefs["rows"]]
    assert "decisions" in pref_ids, f"decisions pref row missing: {pref_ids}"
    print(f"[12] notification prefs categories: {pref_ids}")

    print("SMOKE CYCLE 32 OK")


if __name__ == "__main__":
    main()
