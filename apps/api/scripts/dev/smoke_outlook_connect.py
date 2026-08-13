"""Live smoke: dev Outlook connect flow must yield a connected mailbox.

Reproduces the exact UI flow: login -> Connect mailbox (oauth/start) ->
accounts list -> Sync now. Run against a running dev API on :8000.
"""

import asyncio
import sys

import httpx

BASE = "http://127.0.0.1:8000"
EMAIL = "admin@bokito.ai"
PASSWORD = "bokito-test-password"


async def main() -> int:
    async with httpx.AsyncClient(base_url=BASE, timeout=30) as client:
        login = await client.post(
            "/api/auth/login", json={"email": EMAIL, "password": PASSWORD}
        )
        login.raise_for_status()
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        start = await client.get(
            "/api/email/oauth/start",
            headers=headers,
            params={
                "provider": "outlook",
                "return_url": "http://127.0.0.1:5174/settings/channels",
            },
        )
        start.raise_for_status()
        url = start.json()["authorize_url"]
        print("authorize_url:", url[:100])
        assert "oauth_status=connected" in url, "expected dev mock connect URL"

        accounts = await client.get("/api/email/accounts", headers=headers)
        accounts.raise_for_status()
        mine = next(
            a
            for a in accounts.json()
            if a["provider"] == "outlook" and a["mailbox_email"] == EMAIL
        )
        print("account status:", mine["status"])
        assert mine["status"] == "connected", f"expected connected, got {mine['status']}"

        sync = await client.post("/api/email/sync", headers=headers)
        sync.raise_for_status()
        statuses = [r["status"] for r in sync.json()["results"]]
        print("sync statuses:", statuses)
        assert "error" not in statuses, "sync must not error on mock mailbox"

        accounts2 = await client.get("/api/email/accounts", headers=headers)
        mine2 = next(
            a
            for a in accounts2.json()
            if a["provider"] == "outlook" and a["mailbox_email"] == EMAIL
        )
        print("account status after sync:", mine2["status"])
        assert mine2["status"] == "connected"

        print("OK: dev Outlook connect is consistent (connected + sync skips)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
