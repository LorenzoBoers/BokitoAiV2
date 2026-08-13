"""API smoketest for core flows against a running dev server.

Covers: health, signup (fresh tenant + onboarding), refresh, mock inbound
email -> signal, trigger create/fire -> single reused thread, decision
listing, and auth rate limiting.

Usage: python scripts/dev/smoketest-core-flows.py [base_url]
"""

import sys
import time
import uuid

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
API = f"{BASE}/api"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))


def main() -> int:
    slug = f"smoke{uuid.uuid4().hex[:8]}"
    email = f"{slug}@example.com"
    password = "smoketest-password-123"

    with httpx.Client(timeout=30) as c:
        # 1. Health
        r = c.get(f"{API}/health")
        check("health liveness", r.status_code == 200 and r.json().get("ok") is True)

        r = c.get(f"{API}/health/ready")
        body = r.json()
        check(
            "health readiness has checks+runtime",
            "checks" in body and "runtime" in body,
            f"status={r.status_code} checks={body.get('checks')}",
        )

        # 2. Signup -> fresh tenant
        r = c.post(
            f"{API}/auth/signup",
            json={
                "email": email,
                "password": password,
                "display_name": "Smoke Test",
                "tenant_slug": slug,
                "tenant_name": f"Smoke {slug}",
            },
        )
        check("signup", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
        if r.status_code != 200:
            return finish()
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Fresh tenant must be empty
        r = c.get(f"{API}/signals?scope=external", headers=headers)
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        check("fresh tenant has no external signals", r.status_code == 200 and len(items) == 0, f"count={len(items)}")

        # Onboarding status
        r = c.get(f"{API}/app/onboarding", headers=headers)
        check(
            "onboarding status available",
            r.status_code == 200 and isinstance(r.json().get("steps"), list),
            f"status={r.status_code}",
        )

        # 3. Refresh flow (cookie set at signup)
        r = c.post(f"{API}/auth/refresh")
        check("refresh via cookie", r.status_code == 200 and bool(r.json().get("access_token")), f"status={r.status_code}")

        # 4. Connect a dev mailbox (mock OAuth), then mock inbound email -> signal thread
        r = c.get(
            f"{API}/email/oauth/start",
            headers=headers,
            params={"provider": "outlook", "return_url": f"{BASE}/settings"},
        )
        check("dev mailbox connect (mock oauth)", r.status_code == 200, f"status={r.status_code} body={r.text[:150]}")

        r = c.post(
            f"{API}/email/mock/inbound",
            headers=headers,
            json={
                "from_address": "klant@example.com",
                "subject": "Vraag over factuur",
                "body_text": "Kunt u mij helpen met factuur 1234?",
            },
        )
        inbound_ok = r.status_code == 200
        check("mock inbound email accepted", inbound_ok, f"status={r.status_code} body={r.text[:200]}")
        if inbound_ok:
            time.sleep(1)
            r = c.get(f"{API}/signals?scope=external", headers=headers)
            items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
            check("inbound email created a signal", len(items) >= 1, f"count={len(items)}")

        # 5. Trigger create + fire twice -> one reused thread
        r = c.post(
            f"{API}/triggers",
            headers=headers,
            json={
                "name": "Smoke interval",
                "kind": "interval",
                "interval_minutes": 60,
                "agent_role": "assistant",
                "instructions": "Say OK.",
            },
        )
        check("trigger created", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
        if r.status_code == 200:
            trigger_id = r.json()["id"]
            for _ in range(2):
                rr = c.post(f"{API}/triggers/{trigger_id}/run", headers=headers)
                if rr.status_code != 200:
                    check("trigger manual fire", False, f"status={rr.status_code} body={rr.text[:200]}")
                    break
            else:
                r = c.get(f"{API}/signals?scope=internal", headers=headers)
                items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
                trigger_threads = [
                    i
                    for i in items
                    if isinstance(i, dict)
                    and "Smoke interval" in (i.get("email_subject") or i.get("subject") or "")
                ]
                check(
                    "trigger fires reuse one thread",
                    len(trigger_threads) == 1,
                    f"threads={len(trigger_threads)}",
                )

        # 6. Decisions endpoint reachable
        r = c.get(f"{API}/notifications/decisions?status=awaiting_human", headers=headers)
        check("decisions list reachable", r.status_code == 200, f"status={r.status_code}")

        # 7. Rate limiting on login
        codes = []
        for _ in range(12):
            rr = c.post(f"{API}/auth/login", json={"email": email, "password": "wrong-password"})
            codes.append(rr.status_code)
        check("login rate limited after burst", 429 in codes, f"codes={codes}")

    return finish()


def finish() -> int:
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
