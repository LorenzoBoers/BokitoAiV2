"""Cycle 6 widget E2E: visitor + logged-in livechat flows against a fresh tenant.

Creates a tenant via signup, then exercises the livechat API contract exactly
as dist/bokito-chat.js does (session/start, conversation, stream-chat,
customer/conversations, user/conversations, attachment) and finally verifies
the visitor thread is visible in the tenant inbox via /api/signals.

Usage: .venv\\Scripts\\python.exe scripts/dev/e2e-widget-c6.py  (from apps/api)
"""

from __future__ import annotations

import io
import json
import sys
import uuid

import httpx

API = "http://127.0.0.1:8000/api"
PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    (PASSED if ok else FAILED).append(name)
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def sse_done_text(resp: httpx.Response) -> str:
    """Collect the final text from a livechat SSE stream response."""
    text_chunks: list[str] = []
    done_content = ""
    for line in resp.iter_lines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        raw = line.removeprefix("data:").strip()
        try:
            evt = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(evt, dict):
            if evt.get("t"):
                text_chunks.append(str(evt["t"]))
            if evt.get("type") == "done":
                done_content = str(evt.get("content") or "")
    return done_content or "".join(text_chunks)


def main() -> int:
    slug = f"wgt{uuid.uuid4().hex[:8]}"
    email = f"{slug}@example.com"
    password = "widget-e2e-password-123"

    with httpx.Client(timeout=60) as c:
        # 1. Fresh tenant via signup
        r = c.post(
            f"{API}/auth/signup",
            json={
                "email": email,
                "password": password,
                "display_name": "Widget E2E",
                "tenant_slug": slug,
                "tenant_name": f"Widget E2E {slug}",
            },
        )
        check("signup", r.status_code == 200, f"status={r.status_code}")
        if r.status_code != 200:
            print(r.text[:300])
            return 1
        owner_token = r.json().get("access_token", "")

        # 2. Visitor flow: anonymous session start with explicit tenant slug
        r = c.post(
            f"{API}/livechat/session/start",
            json={"agent_slug": "assistant", "auth_mode": "anonymous", "tenant_subdomain": slug},
        )
        check("visitor session/start", r.status_code == 200, f"status={r.status_code}")
        visitor = r.json()
        visitor_token = visitor.get("session_token", "")
        customer_id = visitor.get("customer_id", "")
        check("visitor anonymous identity", visitor.get("identity_type") == "anonymous")
        check("visitor tenant match", (visitor.get("tenant") or {}).get("slug") == slug)
        vh = {"Authorization": f"Bearer {visitor_token}"}

        # 3. Visitor creates a conversation + streams a message
        r = c.post(f"{API}/livechat/conversation", headers=vh, json={"customer_id": customer_id})
        check("visitor conversation", r.status_code == 200, f"status={r.status_code}")
        conv_id = r.json().get("conversation_id", "")

        with c.stream(
            "POST",
            f"{API}/livechat/stream-chat",
            headers=vh,
            json={"message": "Hello, what are your opening hours?", "conversation_id": conv_id},
        ) as resp:
            check("visitor stream-chat status", resp.status_code == 200, f"status={resp.status_code}")
            reply = sse_done_text(resp)
        check("visitor stream reply text", bool(reply.strip()), f"len={len(reply)}")

        # 4. Visitor attachment upload (new endpoint)
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
            b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00"
            b"\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        r = c.post(
            f"{API}/livechat/attachment",
            headers=vh,
            files={"file": ("pixel.png", io.BytesIO(png), "image/png")},
        )
        ok = r.status_code == 200 and bool(r.json().get("url"))
        check("visitor attachment upload", ok, f"status={r.status_code}")

        # 5. Visitor conversation list (new endpoint)
        r = c.get(f"{API}/livechat/customer/conversations?per_page=10", headers=vh)
        items = r.json().get("items", []) if r.status_code == 200 else []
        check(
            "visitor customer/conversations",
            r.status_code == 200 and any(i.get("id") == conv_id for i in items),
            f"status={r.status_code} items={len(items)}",
        )

        # 6. Logged-in flow: session start with host_auth_token
        r = c.post(
            f"{API}/livechat/session/start",
            json={
                "agent_slug": "assistant",
                "auth_mode": "required",
                "tenant_subdomain": slug,
                "host_auth_token": owner_token,
            },
        )
        check("logged-in session/start", r.status_code == 200, f"status={r.status_code}")
        member = r.json()
        check("logged-in identity", member.get("identity_type") == "authenticated")
        member_token = member.get("session_token", "")
        mh = {"Authorization": f"Bearer {member_token}"}

        r = c.get(f"{API}/livechat/me", headers=mh)
        check("logged-in /me", r.status_code == 200 and r.json().get("email") == email)

        r = c.post(f"{API}/livechat/conversation", headers=mh, json={})
        m_conv = r.json().get("conversation_id", "")
        with c.stream(
            "POST",
            f"{API}/livechat/stream-chat",
            headers=mh,
            json={"message": "What can you help me with today?", "conversation_id": m_conv},
        ) as resp:
            check("logged-in stream-chat status", resp.status_code == 200, f"status={resp.status_code}")
            reply = sse_done_text(resp)
        check("logged-in stream reply text", bool(reply.strip()), f"len={len(reply)}")

        r = c.get(f"{API}/livechat/user/conversations?per_page=10", headers=mh)
        items = r.json().get("items", []) if r.status_code == 200 else []
        check(
            "logged-in user/conversations",
            r.status_code == 200 and any(i.get("id") == m_conv for i in items),
            f"status={r.status_code} items={len(items)}",
        )

        # 7. Removed auth endpoints stay gone
        r = c.post(f"{API}/livechat/auth/login", json={"email": email, "password": password})
        check("livechat auth/login removed", r.status_code in (404, 405), f"status={r.status_code}")

        # 8. Inbox verification: visitor thread visible to the tenant owner
        oh = {"Authorization": f"Bearer {owner_token}"}
        r = c.get(f"{API}/signals?view=all_open&per_page=50", headers=oh)
        rows = r.json().get("items", []) if r.status_code == 200 else []
        widget_rows = [x for x in rows if x.get("channel") == "widget"]
        check(
            "visitor thread in inbox",
            r.status_code == 200 and any(str(x.get("id", "")).replace("-", "") == conv_id.replace("-", "") for x in widget_rows),
            f"status={r.status_code} widget_threads={len(widget_rows)}",
        )

        # 9. Tenant isolation spot-check: visitor session cannot read another tenant
        r = c.post(
            f"{API}/livechat/session/start",
            json={"agent_slug": "assistant", "auth_mode": "anonymous", "tenant_subdomain": "does-not-exist-xyz"},
        )
        check("unknown tenant rejected", r.status_code == 404, f"status={r.status_code}")

    print()
    print(f"{len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("FAILED:", ", ".join(FAILED))
    print(f"tenant={slug} email={email} password={password}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
