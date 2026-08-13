import httpx

c = httpx.Client(timeout=60)
r = c.post(
    "http://127.0.0.1:8000/api/livechat/session/start",
    json={"tenant_subdomain": "e2ed631d54d"},
)
tok = r.json()["session_token"]
h = {"Authorization": f"Bearer {tok}"}

# Existing widget conversation
conv = "e29f476b-3bbd-4144-9914-03a1ac9742f4"
with c.stream(
    "POST",
    "http://127.0.0.1:8000/api/livechat/stream-chat",
    headers=h,
    json={"message": "Are you still there?", "conversation_id": conv},
) as resp:
    print("status:", resp.status_code)
    for line in resp.iter_lines():
        if line.startswith("data:"):
            print(line[:200])
