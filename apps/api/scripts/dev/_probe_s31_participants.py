"""Agents + participants for S31 Support chain."""
from __future__ import annotations

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = "72fbd32a-fb2c-4f12-8d7c-eb13ed87de58"


async def main() -> None:
    async with async_session_factory() as s:
        agents = (
            await s.execute(
                text("SELECT id::text, name FROM agents ORDER BY name")
            )
        ).fetchall()
        print("agents:")
        for a in agents:
            print(" ", a)

        parts = (
            await s.execute(
                text(
                    """
                    SELECT kind, ref_id::text, name, role, created_at
                    FROM signal_participants
                    WHERE signal_id = :id
                    ORDER BY created_at
                    """
                ),
                {"id": HOST},
            )
        ).fetchall()
        print("participants:")
        for p in parts:
            print(" ", p)

        # any Support-authored msgs recently?
        msgs = (
            await s.execute(
                text(
                    """
                    SELECT m.created_at, a.name, left(coalesce(m.body_text,''), 100)
                    FROM signal_messages m
                    LEFT JOIN agents a ON a.id = m.author_agent_id
                    WHERE m.signal_id = :id
                      AND m.created_at > now() - interval '30 minutes'
                    ORDER BY m.created_at
                    """
                ),
                {"id": HOST},
            )
        ).fetchall()
        print("msgs with agent names:")
        for m in msgs:
            print(" ", m)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
