"""E2E check for Cycle 8: assistant-chat decision UX.

Verifies against a running dev API (mock LLM):
1. A simple question yields exactly one assistant reply and no decision.
2. An explicit approval question yields one decision-request message whose
   serialized payload carries server-driven options + status.
3. Resolving the decision leaves no extra chat messages (no duplicate
   "Decision resolved"/"Decision approved" noise) and the decision status
   flips to approved, which survives a fresh message list (reload).

Run: python scripts/dev/e2e-assistant-chat-c8.py
"""

from __future__ import annotations

import sys
import uuid

import httpx

BASE = "http://127.0.0.1:8000"

FAILURES: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {label}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


def main() -> int:
    suffix = uuid.uuid4().hex[:10]
    client = httpx.Client(base_url=BASE, timeout=60)

    r = client.post(
        "/api/auth/signup",
        json={
            "email": f"c8-{suffix}@example.com",
            "password": "c8-testpass-123",
            "tenant_slug": f"c8-{suffix}",
            "tenant_name": f"C8 {suffix}",
            "display_name": "C8 Tester",
        },
    )
    check("signup", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    token = r.json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/chat/conversations", headers=h, json={"title": "C8 chat"})
    check("create conversation", r.status_code == 200, r.text[:200])
    conv_id = r.json()["id"]

    # 1. Simple question: one reply, no decision, no system events.
    r = client.post(
        f"/api/chat/conversations/{conv_id}/messages",
        headers=h,
        json={"content": "Who are you?"},
    )
    check("simple question send", r.status_code == 200, r.text[:200])

    r = client.get(f"/api/chat/conversations/{conv_id}/messages", headers=h)
    msgs = r.json()
    assistant = [m for m in msgs if m["role"] == "assistant"]
    decisions = [m for m in msgs if m.get("decision_request_id")]
    system = [m for m in msgs if m.get("kind") == "system_event"]
    check("simple: one assistant reply", len(assistant) == 1, f"got {len(assistant)}")
    check("simple: no decision", len(decisions) == 0, f"got {len(decisions)}")
    check("simple: no system events", len(system) == 0, f"got {len(system)}")

    # 2. Approval question: exactly one decision card with server payload.
    r = client.post(
        f"/api/chat/conversations/{conv_id}/messages",
        headers=h,
        json={"content": "I need your approval decision on sending this offer."},
    )
    check("approval question send", r.status_code == 200, r.text[:300])

    r = client.get(f"/api/chat/conversations/{conv_id}/messages", headers=h)
    msgs = r.json()
    decisions = [m for m in msgs if m.get("decision_request_id")]
    check("approval: exactly one decision message", len(decisions) == 1, f"got {len(decisions)}")
    if not decisions:
        return report()
    dmsg = decisions[0]
    dec = dmsg.get("decision")
    check("decision payload present", isinstance(dec, dict), str(dmsg)[:300])
    check(
        "decision awaiting_human",
        bool(dec) and dec.get("status") == "awaiting_human",
        str(dec)[:200],
    )
    check(
        "decision has options",
        bool(dec) and len(dec.get("options") or []) >= 2,
        str(dec)[:200],
    )

    count_before = len(msgs)

    # 3. Resolve (approve) and confirm: status flips, no message noise added.
    r = client.post(
        f"/api/signals/{conv_id}/messages/{dmsg['id']}/resolve",
        headers=h,
        json={"action": "approved", "option_id": "approve"},
    )
    check("resolve decision", r.status_code == 200, f"{r.status_code} {r.text[:300]}")

    r = client.get(f"/api/chat/conversations/{conv_id}/messages", headers=h)
    msgs = r.json()
    dmsg_after = next((m for m in msgs if m["id"] == dmsg["id"]), None)
    check("decision message still present", dmsg_after is not None)
    dec_after = (dmsg_after or {}).get("decision") or {}
    check(
        "decision resolved server-side (survives reload)",
        dec_after.get("status") == "approved",
        str(dec_after)[:200],
    )
    noise = [
        m
        for m in msgs
        if "Decision resolved" in (m.get("content") or "")
        or (m.get("content") or "").strip().startswith("Decision approved")
    ]
    check("no duplicate resolution chat messages", len(noise) == 0, str(noise)[:300])
    check(
        "no extra chat messages after resolve",
        len(msgs) == count_before,
        f"before={count_before} after={len(msgs)}",
    )

    return report()


def report() -> int:
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("All Cycle 8 checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
