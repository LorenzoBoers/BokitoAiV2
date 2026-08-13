import time

import httpx

API = "http://127.0.0.1:8000/api"
c = httpx.Client(timeout=60)
r = c.post(
    f"{API}/auth/login",
    json={"email": "e2ed631d54d@example.com", "password": "e2e-test-password-123"},
)
h = {"Authorization": f"Bearer {r.json()['access_token']}"}

# 1. New inbound email -> suggest flow creates a decision
r = c.post(
    f"{API}/email/mock/inbound",
    headers=h,
    json={
        "from_address": "klant2@example.com",
        "subject": "Refund request",
        "body_text": "I want a refund for order 555.",
    },
)
print("inbound:", r.status_code, r.json())
sig_id = r.json().get("signal_id") or r.json().get("thread_id")

# 2. Wait for inline processing to attach the suggestion decision
msg_id = None
for _ in range(20):
    time.sleep(1)
    d = c.get(f"{API}/signals/{sig_id}", headers=h).json()
    for m in d["messages"]:
        if m["kind"] == "decision_request":
            msg_id = m["id"]
            break
    if msg_id:
        break
print("decision message:", msg_id)

# 3. Approve (send)
r = c.post(
    f"{API}/signals/{sig_id}/messages/{msg_id}/resolve",
    headers=h,
    json={"action": "approve", "option_id": "send"},
)
print("resolve:", r.status_code, r.json())

# 4. Verify outbound message exists
d = c.get(f"{API}/signals/{sig_id}", headers=h).json()
for m in d["messages"]:
    print(
        "msg:", m["kind"], "|", m["direction"], "|",
        (m.get("body_text") or "")[:70],
    )
