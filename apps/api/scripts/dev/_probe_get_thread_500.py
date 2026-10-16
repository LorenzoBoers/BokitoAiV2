"""Reproduce get_thread failure for ec8d606c…"""
from __future__ import annotations

import asyncio
import traceback
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.auth import Membership
from app.models.signal import Signal
from app.services.signal_threads import get_thread

SID = UUID("ec8d606c-71dc-44f8-bb4f-9b3c9977e922")


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        if sig is None:
            print("missing signal")
            return
        mem = (
            await s.execute(
                select(Membership)
                .where(Membership.tenant_id == sig.tenant_id)
                .limit(1)
            )
        ).scalar_one_or_none()
        user_id = mem.user_id if mem else None
        print("tenant", sig.tenant_id, "user", user_id, "channel", sig.channel)
        try:
            detail = await get_thread(s, sig.tenant_id, user_id, SID, limit=80)
            if detail is None:
                print("NULL detail")
            else:
                print(
                    "OK",
                    "msgs",
                    len(detail.get("messages") or []),
                    "events",
                    len(detail.get("events") or []),
                    "participants",
                    len(detail.get("participants") or []),
                )
        except Exception as exc:  # noqa: BLE001
            print("FAIL", type(exc).__name__, exc)
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
