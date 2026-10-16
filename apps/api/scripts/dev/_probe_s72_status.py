"""Probe S72 split-child thread status on remote-dev."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import Signal

SID = UUID("6466f9a1-1eef-4f8e-a03d-f1fa7ce563af")


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        if not sig:
            print("missing")
            return
        print(
            "SIGNAL",
            sig.id,
            "status",
            sig.status,
            "channel",
            sig.channel,
            "subject",
            (sig.subject or "")[:80],
            "ai_handling",
            getattr(sig, "ai_handling", None),
            "assigned_user_id",
            getattr(sig, "assigned_user_id", None),
            "agent_id",
            getattr(sig, "agent_id", None),
        )
        rows = (
            await s.execute(
                select(Signal)
                .where(Signal.channel == "widget", Signal.status == "closed")
                .order_by(Signal.updated_at.desc())
                .limit(8)
            )
        ).scalars().all()
        print("--- recent closed widget ---")
        for r in rows:
            print(r.id, (r.subject or "")[:50], "upd", r.updated_at)


if __name__ == "__main__":
    asyncio.run(main())
