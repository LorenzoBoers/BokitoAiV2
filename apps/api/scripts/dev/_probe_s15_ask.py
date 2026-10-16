"""Probe S15 Ask target switch — which agent answered."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")
BOKITO = UUID("8d4dede2-751e-4475-b614-206a8415c577")
ORCH = UUID("cc965b16-aff8-44a2-a0ea-29ebd4e5bccf")


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT created_at, role, author_agent_id::text,
                           left(coalesce(body_text,''), 160)
                    FROM signal_messages
                    WHERE signal_id = :sid
                    ORDER BY created_at DESC
                    LIMIT 8
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        for r in rows:
            aid = r[2]
            who = (
                "Bokito"
                if aid == str(BOKITO)
                else "Orchestrator"
                if aid == str(ORCH)
                else (aid or "-")
            )
            print(r[0], r[1], who, repr(r[3]))


if __name__ == "__main__":
    asyncio.run(main())
