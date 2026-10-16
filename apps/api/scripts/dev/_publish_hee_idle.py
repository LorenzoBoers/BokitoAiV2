"""Publish idle presence after clearing the stuck Ask floor on 'hee'."""
from __future__ import annotations

import asyncio
from uuid import UUID

from app.db.session import async_session_factory
from app.gateway.publish import publish_thread_presence, publish_thread_update
from app.models.signal import Signal

TID = UUID("aaf94197-fd12-4a18-8520-d1861254573e")


async def main() -> None:
    async with async_session_factory() as session:
        signal = await session.get(Signal, TID)
        if not signal:
            print("missing")
            return
        print("active=", signal.active_turn_json)
        await publish_thread_presence(
            signal.tenant_id,
            signal.id,
            phase="idle",
            actor_kind="system",
            actor_id="",
            actor_name="",
            item={"active_turn": None},
        )
        await publish_thread_update(signal)
        print("published idle")


if __name__ == "__main__":
    asyncio.run(main())
