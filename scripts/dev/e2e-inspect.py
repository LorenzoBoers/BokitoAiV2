import httpx

c = httpx.Client(timeout=30)
r = c.post(
    "http://127.0.0.1:8000/api/auth/login",
    json={"email": "e2ed631d54d@example.com", "password": "e2e-test-password-123"},
)
h = {"Authorization": f"Bearer {r.json()['access_token']}"}

for st in ["awaiting_human", "resolved"]:
    r2 = c.get(
        f"http://127.0.0.1:8000/api/notifications/decisions?status={st}", headers=h
    )
    ds = r2.json()
    print("---", st, len(ds))
    for d in ds:
        print(
            " id:", d["id"][:8],
            "| status:", d["status"],
            "| signal:", (d.get("signal_id") or "")[:8],
            "| title:", d["title"],
            "| options:", [o.get("action_type") for o in d.get("options", [])],
        )

for sid, label in [
    ("7f129131-ebf4-4bee-b234-9c20eb3e6392", "email"),
    ("e29f476b-3bbd-4144-9914-03a1ac9742f4", "widget"),
]:
    d = c.get(f"http://127.0.0.1:8000/api/signals/{sid}", headers=h).json()
    print(f"--- {label} thread {sid[:8]} suggested_actions:", d["thread"].get("suggested_actions"))
    for m in d["messages"]:
        print(
            "  msg kind:", m["kind"],
            "| dir:", m["direction"],
            "| from:", m.get("from_address"),
            "| decision:", (m.get("decision_id") or "")[:8],
            "| text:", (m.get("body_text") or "")[:60],
        )
