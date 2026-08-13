"""Cycles 10-11 live E2E: mentions -> notifications, assignment -> notification,
inline agent invocation, ask-assistant grounding.

Run: python scripts/dev/e2e-mentions-agents-c1011.py
"""

from __future__ import annotations

import sys
import uuid

import httpx

BASE = "http://127.0.0.1:8000"
FAILURES: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    print(f"[{'PASS' if cond else 'FAIL'}] {label}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


def main() -> int:
    sfx = uuid.uuid4().hex[:8]
    c = httpx.Client(base_url=BASE, timeout=120)

    r = c.post("/api/auth/signup", json={
        "email": f"c10-owner-{sfx}@example.com", "password": "ownerpass123",
        "tenant_slug": f"c10-{sfx}", "tenant_name": f"C10 {sfx}", "display_name": "Owner",
    })
    check("signup", r.status_code == 200, r.text[:200])
    owner = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # Teammate joins via invite.
    r = c.post("/api/auth/invite", headers=owner, json={"email": f"c10-mate-{sfx}@example.com", "role": "member"})
    token = r.json()["token"]
    r = c.post("/api/auth/accept-invite", json={"token": token, "password": "matepass123", "display_name": "Mate"})
    check("teammate joined", r.status_code == 200, r.text[:200])
    mate = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # Customer thread.
    r = c.post("/api/signals/inbound", headers=owner, json={
        "channel": "email", "source": "e2e", "subject": "Order delayed",
        "body_text": "My order is a week late.", "contact_email": "cust@example.com",
        "contact_name": "Cust",
    })
    signal_id = r.json()["id"]

    members = c.get("/api/signals/members", headers=owner).json()
    mate_num = next(m["id"] for m in members if m["email"].startswith("c10-mate"))
    check("members expose avatar_url field", all("avatar_url" in m for m in members), str(members)[:200])

    # Mention in a note -> teammate notification.
    r = c.post(f"/api/signals/{signal_id}/notes", headers=owner,
               json={"body_text": f"@[Mate](user:{mate_num}) can you check the carrier?"})
    check("note with mention posted", r.status_code == 200, r.text[:200])
    rows = [n for n in c.get("/api/notifications", headers=mate).json() if n["kind"] == "mention"]
    check("mention notification for teammate", len(rows) == 1 and rows[0]["payload"].get("signal_id") == signal_id, str(rows)[:300])
    owner_rows = [n for n in c.get("/api/notifications", headers=owner).json() if n["kind"] == "mention"]
    check("mention notification is private", owner_rows == [], str(owner_rows)[:200])

    # Assignment -> notification.
    r = c.patch(f"/api/signals/{signal_id}", headers=owner, json={"assigned_to_user_id": mate_num})
    check("assign thread", r.status_code == 200, r.text[:200])
    rows = [n for n in c.get("/api/notifications", headers=mate).json() if n["kind"] == "assignment"]
    check("assignment notification", len(rows) == 1, str(rows)[:300])

    # Inline agent invocation as note.
    agents = c.get("/api/workforce/agents", headers=owner).json().get("items", [])
    check("agents available", bool(agents), str(agents)[:200])
    agent_id = agents[0]["id"]
    r = c.post(f"/api/signals/{signal_id}/invoke-agent", headers=owner,
               json={"agent_id": agent_id, "instruction": "Summarize the issue for the team", "output": "note"})
    check("invoke agent note", r.status_code == 200 and r.json().get("output") == "note", r.text[:300])
    notes = c.get(f"/api/signals/{signal_id}/notes", headers=owner).json()
    check("agent note in thread", any(n.get("body_text") for n in notes) and len(notes) >= 2, str(len(notes)))

    # Invoke agent for a reply suggestion.
    r = c.post(f"/api/signals/{signal_id}/invoke-agent", headers=owner,
               json={"agent_id": agent_id, "instruction": "Draft an apology", "output": "reply_suggestion"})
    ok = r.status_code == 200 and (r.json().get("decision_id") or r.json().get("skipped"))
    check("invoke agent reply suggestion", bool(ok), r.text[:300])

    # Ask-assistant conversation grounded in the thread.
    r = c.post("/api/chat/conversations", headers=owner,
               json={"title": "Assist: Order delayed", "context_signal_id": signal_id})
    check("grounded conversation created", r.status_code == 200, r.text[:300])

    print()
    if FAILURES:
        print(f"FAILED: {FAILURES}")
        return 1
    print("All Cycle 10/11 live checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
