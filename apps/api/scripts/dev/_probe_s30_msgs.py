"""Find S30 Ask child + recent events on mail host."""
from __future__ import annotations

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = "14cb3ae9-c892-458b-9e71-05f093d5aa47"


async def main() -> None:
    async with async_session_factory() as s:
        kids = (
            await s.execute(
                text(
                    """
                    SELECT id::text, subject, channel, source, session_state,
                           agent_id::text, parent_signal_id::text,
                           active_turn_json, updated_at
                    FROM signals
                    WHERE parent_signal_id = :host
                       OR (subject ILIKE '%MSTRL-API-932973-004%' AND id <> :host)
                    ORDER BY updated_at DESC NULLS LAST
                    LIMIT 15
                    """
                ),
                {"host": HOST},
            )
        ).mappings().all()
        print("kids/related:")
        for c in kids:
            print(" ", dict(c))

        # messages containing s30
        rows = (
            await s.execute(
                text(
                    """
                    SELECT m.signal_id::text, m.created_at, m.role,
                           m.author_agent_id::text,
                           left(coalesce(m.body_text,''), 120)
                    FROM signal_messages m
                    WHERE m.body_text ILIKE '%s30%'
                       OR m.signal_id = :host
                    ORDER BY m.created_at DESC
                    LIMIT 25
                    """
                ),
                {"host": HOST},
            )
        ).fetchall()
        print("msgs:")
        for r in rows:
            print(" ", r)

        evs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, event_type,
                           left(coalesce(payload_json::text,''), 200)
                    FROM signal_events
                    WHERE signal_id = :host
                    ORDER BY created_at DESC LIMIT 12
                    """
                ),
                {"host": HOST},
            )
        ).fetchall()
        print("host events:")
        for e in evs:
            print(" ", e)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
