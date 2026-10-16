"""Clear active_turn / ask floor chip on mail host (ghost Stop/Nadenken)."""
import asyncio
import json
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.gateway.publish import publish_thread_presence, publish_thread_update
from app.models.signal import Signal

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        sig = (await s.execute(select(Signal).where(Signal.id == SID))).scalar_one()
        before = sig.active_turn_json
        sig.active_turn_json = "{}"
        s.add(sig)
        await s.commit()
        await publish_thread_presence(
            sig.tenant_id,
            sig.id,
            phase="idle",
            actor_kind="agent",
            actor_id="",
            actor_name="",
            item={"active_turn": None},
        )
        await publish_thread_update(sig)
        print({"before": before, "after": sig.active_turn_json})


if __name__ == "__main__":
    asyncio.run(main())
