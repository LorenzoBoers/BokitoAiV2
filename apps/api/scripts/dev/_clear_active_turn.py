"""Clear stuck active_turn on the A2A QA thread."""
from __future__ import annotations

import asyncio
from uuid import UUID

from app.db.session import async_session_factory
from app.models.signal import Signal

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        print("before:", sig.active_turn_json if sig else None)
        if sig:
            sig.active_turn_json = "{}"
            s.add(sig)
            await s.commit()
            print("cleared")


if __name__ == "__main__":
    asyncio.run(main())
