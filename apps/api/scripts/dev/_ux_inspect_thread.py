import asyncio
import json

import httpx

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

SID = "a9b77989-b69c-441f-b67a-3e778b8d35d1"


async def main() -> None:
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=30) as c:
        r = await c.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        d = await c.get(f"/api/signals/{SID}", headers=h)
        t = d.json().get("thread") or d.json()
        keys = [
            "channel",
            "owner",
            "turn",
            "has_open_decision",
            "agent_id",
            "folder",
            "ai_handling",
            "contact_name",
        ]
        print(json.dumps({k: t.get(k) for k in keys}, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
