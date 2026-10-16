"""Inspect external mail host + Ask child for S30."""
from __future__ import annotations

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = "14cb3ae9-c892-458b-9e71-05f093d5aa47"


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
        print("=== HOST", dict(row) if row else {"missing": HOST})

        kids = (
            await s.execute(
                text(
                    """
                    SELECT id::text, subject, session_state, agent_id::text,
                           active_turn_json, updated_at
                    FROM signals
                    WHERE parent_signal_id = :host
                    ORDER BY updated_at DESC NULLS LAST
                    LIMIT 8
                    """
                ),
                {"host": HOST},
            )
        ).mappings().all()
        print("  children:")
        for c in kids:
            print("   ", dict(c))

        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, role, author_agent_id::text,
                           left(coalesce(body_text,''), 160)
                    FROM signal_messages
                    WHERE signal_id = :id
                    ORDER BY created_at DESC LIMIT 8
                    """
                ),
                {"id": HOST},
            )
        ).fetchall()
        print("  host msgs:")
        for m in msgs:
            print("   ", m)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
