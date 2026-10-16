"""Race helper: when S35 deferred floor appears, set deadline in the past."""
from __future__ import annotations

import asyncio
import json
import time
from uuid import UUID

from app.db.session import async_session_factory
from app.models.signal import Signal

SID = UUID("e1be17a5-827f-4cbc-aafe-ea059dda3d1f")


async def main() -> None:
    deadline = time.time() + 45
    while time.time() < deadline:
        async with async_session_factory() as s:
            sig = await s.get(Signal, SID)
            if not sig:
                print("missing")
                return
            try:
                floor = json.loads(sig.active_turn_json or "{}")
            except json.JSONDecodeError:
                floor = {}
            if floor.get("deferred") and floor.get("nonce") and floor.get("ref_id"):
                floor["deadline"] = "2000-01-01T00:00:00"
                sig.active_turn_json = json.dumps(floor)
                s.add(sig)
                await s.commit()
                print("expired", floor.get("ref_id"), floor.get("nonce")[:8])
                return
            print("wait", floor.get("deferred"), bool(floor.get("nonce")))
        await asyncio.sleep(0.4)
    print("timeout waiting for deferred floor")


if __name__ == "__main__":
    asyncio.run(main())
