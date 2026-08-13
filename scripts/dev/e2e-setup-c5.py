"""Set up a fresh tenant with suggest/draft/widget scenario for browser E2E.

Usage: python scripts/dev/e2e-setup-c5.py [base_url]
Prints credentials and IDs for the browser walkthrough.
"""

import sys
import time
import uuid

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
API = f"{BASE}/api"


def main() -> int:
    slug = f"e2e{uuid.uuid4().hex[:8]}"
    email = f"{slug}@example.com"
    password = "e2e-test-password-123"

    with httpx.Client(timeout=60) as c:
        r = c.post(
            f"{API}/auth/signup",
            json={
                "email": email,
                "password": password,
                "display_name": "E2E Operator",
                "tenant_slug": slug,
                "tenant_name": f"E2E {slug}",
            },
        )
        assert r.status_code == 200, f"signup failed: {r.status_code} {r.text[:300]}"
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # AI modes endpoint roundtrip
        r = c.get(f"{API}/settings/ai-modes", headers=headers)
        print("ai-modes GET:", r.status_code, r.json() if r.status_code == 200 else r.text[:200])

        # Connect mock mailbox
        r = c.get(
            f"{API}/email/oauth/start",
            headers=headers,
            params={"provider": "outlook", "return_url": f"{BASE}/settings"},
        )
        print("mock mailbox connect:", r.status_code)

        # Inbound email -> should create suggestion (email default = suggest)
        r = c.post(
            f"{API}/email/mock/inbound",
            headers=headers,
            json={
                "from_address": "klant@example.com",
                "subject": "Question about invoice 1234",
                "body_text": "Hi, can you help me with invoice 1234? It seems too high.",
            },
        )
        print("mock inbound email:", r.status_code, r.text[:200])
        time.sleep(3)

        r = c.get(f"{API}/signals?scope=external", headers=headers)
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        print("external signals:", len(items))
        signal_id = items[0]["id"] if items else None
        if signal_id:
            # Draft endpoint
            r = c.post(f"{API}/signals/{signal_id}/draft", headers=headers, json={})
            body = r.json() if r.status_code == 200 else r.text[:300]
            print("draft endpoint:", r.status_code, str(body)[:200])
            # Thread detail: suggestion card + suggested actions
            r = c.get(f"{API}/signals/{signal_id}", headers=headers)
            if r.status_code == 200:
                data = r.json()
                msgs = data.get("messages", [])
                kinds = [(m.get("authorType"), (m.get("meta") or {}).get("kind")) for m in msgs]
                print("thread messages:", kinds)
                print("suggested actions:", data.get("suggestedActions"))
            else:
                print("thread detail:", r.status_code, r.text[:200])

        # Widget/livechat visitor session -> auto reply
        r = c.post(f"{API}/livechat/session/start", json={"tenant_subdomain": slug})
        print("livechat session:", r.status_code, r.text[:200])
        if r.status_code == 200:
            sess = r.json()
            print("session keys:", list(sess.keys()))
            sess_token = sess.get("session_token") or sess.get("token")
            widget_headers = {"Authorization": f"Bearer {sess_token}"}
            # stream a message (SSE) - just consume until done
            with c.stream(
                "POST",
                f"{API}/livechat/stream-chat",
                headers=widget_headers,
                json={"message": "Hello, I need help with my order"},
            ) as resp:
                print("livechat stream:", resp.status_code)
                got = []
                for line in resp.iter_lines():
                    if line.startswith("data:"):
                        got.append(line[:120])
                    if len(got) > 30:
                        break
                print("stream events (first/last):", got[:2], got[-2:] if len(got) > 2 else [])
            time.sleep(2)
            r = c.get(f"{API}/signals?scope=external", headers=headers)
            items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
            print("external signals after widget:", len(items), [i.get("channel") for i in items])

        print("\n=== CREDENTIALS ===")
        print("email:", email)
        print("password:", password)
        print("tenant:", slug)
        print("signal_id:", signal_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
