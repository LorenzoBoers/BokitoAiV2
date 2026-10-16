"""Check whether Support agent authored s31ok on S31c."""
from __future__ import annotations

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = "72fbd32a-fb2c-4f12-8d7c-eb13ed87de58"
SUPPORT = "5a232347-decf-48f8-b5a6-2d7b7edc596e"
BOKITO = "8d4dede2-751e-4475-b614-206a8415c577"
ORCH = "cc965b16-aff8-44a2-a0ea-29ebd4e5bccf"


async def main() -> None:
    async with async_session_factory() as s:
        row = (
            await s.execute(
                text("SELECT active_turn_json FROM signals WHERE id = :id"),
                {"id": HOST},
            )
        ).first()
        print("active_turn", row)

        msgs = (
            await s.execute(
                text(
                    """
                    SELECT m.created_at, m.author_agent_id::text,
                           left(coalesce(m.body_text,''), 160)
                    FROM signal_messages m
                    WHERE m.signal_id = :id
                      AND m.created_at > '2026-10-15 07:13:00'
                    ORDER BY m.created_at
                    """
                ),
                {"id": HOST},
            )
        ).fetchall()
        print("msgs since S31c:")
        for m in msgs:
            who = (
                "SUPPORT"
                if m[1] == SUPPORT
                else "BOKITO"
                if m[1] == BOKITO
                else "ORCH"
                if m[1] == ORCH
                else m[1]
            )
            print(f"  {m[0]} {who}: {m[2]}")

        evs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, event_type,
                           left(coalesce(payload_json::text,''), 240)
                    FROM signal_events
                    WHERE signal_id = :id
                      AND created_at > '2026-10-15 07:13:00'
                    ORDER BY created_at
                    """
                ),
                {"id": HOST},
            )
        ).fetchall()
        print("events:")
        for e in evs:
            print(" ", e)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
