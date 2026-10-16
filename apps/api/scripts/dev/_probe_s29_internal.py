"""Inspect internal host active_turn + recent messages for S29."""
from __future__ import annotations

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = "72fbd32a-fb2c-4f12-8d7c-eb13ed87de58"
ORCH = "cc965b16-aff8-44a2-a0ea-29ebd4e5bccf"
BOKITO = "8d4dede2-5fec-4c0e-9f0e-0f0f0f0f0f0f"  # placeholder if unknown


async def main() -> None:
    async with async_session_factory() as s:
        row = (
            await s.execute(
                text(
                    """
                    SELECT id::text, subject, session_state, channel, source,
                           parent_signal_id::text, agent_id::text,
                           active_turn_json
                    FROM signals WHERE id = :id
                    """
                ),
                {"id": HOST},
            )
        ).mappings().first()
        print("=== SIGNAL", dict(row) if row else {"missing": HOST})

        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, role, author_agent_id::text,
                           left(coalesce(body_text,''), 200)
                    FROM signal_messages
                    WHERE signal_id = :id
                    ORDER BY created_at DESC LIMIT 20
                    """
                ),
                {"id": HOST},
            )
        ).fetchall()
        print("  msgs:")
        for m in msgs:
            print("   ", m)

        evs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, event_type,
                           left(coalesce(payload_json::text,''), 220)
                    FROM signal_events
                    WHERE signal_id = :id
                    ORDER BY created_at DESC LIMIT 20
                    """
                ),
                {"id": HOST},
            )
        ).fetchall()
        print("  events:")
        for e in evs:
            print("   ", e)

        children = (
            await s.execute(
                text(
                    """
                    SELECT id::text, subject, session_state, agent_id::text,
                           active_turn_json, parent_signal_id::text
                    FROM signals
                    WHERE parent_signal_id = :host
                    ORDER BY updated_at DESC NULLS LAST
                    LIMIT 10
                    """
                ),
                {"host": HOST},
            )
        ).mappings().all()
        print("  children:", [dict(c) for c in children])


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
