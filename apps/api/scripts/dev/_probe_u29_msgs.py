"""Probe recent U29 messages on Ask thread."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "84c74f47-51bd-476c-ac12-4fcf1ac6f912"
EXTRA = "a2e4837d-3d58-4327-8f43-7d585d3948ce"
BOKITO = "8d4dede2-751e-4475-b614-206a8415c577"
ORCH = "cc965b16-aff8-44a2-a0ea-29ebd4e5bccf"


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT
                      m.id::text,
                      left(coalesce(m.body_text, ''), 120),
                      m.author_agent_id::text,
                      m.created_at
                    FROM signal_messages m
                    WHERE m.signal_id = CAST(:sid AS uuid)
                      AND (
                        m.body_text ILIKE '%u29%'
                        OR m.body_text ILIKE '%U29%'
                      )
                    ORDER BY m.created_at DESC
                    LIMIT 20
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        for r in rows:
            who = (
                "EXTRA"
                if r[2] == EXTRA
                else "BOKITO"
                if r[2] == BOKITO
                else "ORCH"
                if r[2] == ORCH
                else (r[2] or "user")
            )
            print(f"{r[3]} [{who}] {r[1]!r}")
        floor = (
            await s.execute(
                text("SELECT floor_json FROM signals WHERE id = CAST(:sid AS uuid)"),
                {"sid": SID},
            )
        ).scalar()
        print("floor", floor)


asyncio.run(main())
