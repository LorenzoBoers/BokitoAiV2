"""Cycle 9 live E2E against the running dev API: invites, roles, reset, verification.

Run: python scripts/dev/e2e-usermgmt-c9.py
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
    c = httpx.Client(base_url=BASE, timeout=60)

    r = c.post("/api/auth/signup", json={
        "email": f"c9-owner-{sfx}@example.com", "password": "ownerpass123",
        "tenant_slug": f"c9-{sfx}", "tenant_name": f"C9 {sfx}", "display_name": "C9 Owner",
    })
    check("signup owner", r.status_code == 200, r.text[:200])
    owner = {"Authorization": f"Bearer {r.json()['access_token']}"}

    ws = c.get("/api/app/workspaces", headers=owner).json()[0]["id"]

    # Invite -> link -> accept.
    r = c.post("/api/app/workspace-invites", headers=owner, json={
        "workspace_id": ws, "email": f"c9-member-{sfx}@example.com", "role": "member",
    })
    check("create invite", r.status_code == 200 and "/accept-invite?token=" in r.json().get("invite_link", ""), r.text[:300])
    token = r.json()["invite_link"].split("token=")[1]

    r = c.get("/api/auth/invite-info", params={"token": token})
    check("invite info", r.status_code == 200 and r.json()["existing_user"] is False, r.text[:200])

    r = c.post("/api/auth/accept-invite", json={"token": token, "password": "memberpass123", "display_name": "C9 Member"})
    check("accept invite", r.status_code == 200, r.text[:300])
    member_token = r.json()["access_token"]

    r = c.post("/api/auth/login", json={"email": f"c9-member-{sfx}@example.com", "password": "memberpass123"})
    check("member login", r.status_code == 200, r.text[:200])

    # Role change + remove.
    members = c.get(f"/api/app/workspaces/{ws}/members", headers=owner).json()
    member = next(m for m in members if "member" in m["email"])
    r = c.patch(f"/api/app/workspaces/{ws}/members/{member['uuid']}", headers=owner, json={"role": "admin"})
    check("role change to admin", r.status_code == 200 and r.json()["role"] == "admin", r.text[:200])
    r = c.delete(f"/api/app/workspaces/{ws}/members/{member['uuid']}", headers=owner)
    check("remove member", r.status_code == 200, r.text[:200])
    members = c.get(f"/api/app/workspaces/{ws}/members", headers=owner).json()
    check("member gone", len(members) == 1, str(members)[:200])
    r = c.get("/api/auth/me", headers={"Authorization": f"Bearer {member_token}"})
    check("removed member loses access", r.status_code in (401, 403), f"{r.status_code}")

    # Password reset via dev link.
    r = c.post("/api/auth/password-reset-request", json={"email": f"c9-owner-{sfx}@example.com"})
    reset_token = r.json().get("dev_token")
    check("reset request exposes dev token", bool(reset_token), r.text[:200])
    r = c.post("/api/auth/password-reset", json={"token": reset_token, "password": "ownerpass456"})
    check("reset password", r.status_code == 200, r.text[:200])
    r = c.post("/api/auth/login", json={"email": f"c9-owner-{sfx}@example.com", "password": "ownerpass456"})
    check("login with new password", r.status_code == 200, r.text[:200])
    owner = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # Email change -> verification.
    r = c.patch("/api/auth/profile", headers=owner, json={"email": f"c9-renamed-{sfx}@example.com"})
    payload = r.json()
    check("email change flags verification", r.status_code == 200 and payload.get("verification_required") is True and payload.get("email_verified") is False, r.text[:300])
    r = c.post("/api/auth/verify-email", json={"token": payload.get("dev_token")})
    check("verify new email", r.status_code == 200 and r.json().get("email_verified") is True, r.text[:200])

    print()
    if FAILURES:
        print(f"FAILED: {FAILURES}")
        return 1
    print("All Cycle 9 live checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
