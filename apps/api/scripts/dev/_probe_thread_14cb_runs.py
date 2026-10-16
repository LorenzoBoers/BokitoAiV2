"""Inspect session child + agent runs for stuck turn."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import or_, select

from app.db.session import async_session_factory
from app.models.signal import Signal, SignalMessage

HOST = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")
SESSION = UUID("c9dce58b-8f77-46b3-96be-5f708f7e14b5")


async def main() -> None:
    async with async_session_factory() as s:
        kids = (
            await s.execute(
                select(Signal).where(or_(Signal.context_signal_id == HOST, Signal.id == SESSION))
            )
        ).scalars().all()
        print("RELATED", len(kids))
        ids = [HOST]
        for sig in kids:
            ids.append(sig.id)
            print(
                " ",
                sig.id,
                "ch=",
                sig.channel,
                "session_state=",
                sig.session_state,
                "subject=",
                (sig.subject or "")[:60],
            )
            msgs = (
                await s.execute(
                    select(SignalMessage)
                    .where(SignalMessage.signal_id == sig.id)
                    .order_by(SignalMessage.created_at)
                )
            ).scalars().all()
            print("  msgs", len(msgs))
            for m in msgs[-10:]:
                try:
                    meta = json.loads(m.metadata_json or "{}")
                except json.JSONDecodeError:
                    meta = {}
                print(
                    "   ",
                    m.created_at,
                    m.role,
                    m.kind,
                    (m.body_text or "")[:120],
                    "keys",
                    list(meta)[:10],
                    "in_progress=",
                    meta.get("in_progress"),
                )
        # raw agent_runs if table exists
        try:
            rows = (
                await s.execute(
                    select(Signal).where(Signal.id.in_(ids))  # keep session warm
                )
            ).scalars().all()
            del rows
            from sqlalchemy import text

            result = await s.execute(
                text(
                    "select id, status, signal_id, created_at, "
                    "coalesce(error, '') as err from agent_runs "
                    "where signal_id = ANY(:ids) order by created_at desc limit 12"
                ),
                {"ids": [str(i) for i in ids]},
            )
            print("RUNS")
            for row in result:
                print(" ", dict(row._mapping))
        except Exception as exc:  # noqa: BLE001
            print("RUNS query failed", type(exc).__name__, exc)


if __name__ == "__main__":
    asyncio.run(main())
