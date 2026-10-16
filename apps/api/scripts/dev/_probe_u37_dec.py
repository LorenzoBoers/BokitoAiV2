"""Probe U37 decision on Ask thread."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "84c74f47-51bd-476c-ac12-4fcf1ac6f912"
EXTRA = "a2e4837d-3d58-4327-8f43-7d585d3948ce"


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT
                      d.id::text,
                      d.status,
                      d.title,
                      d.prompt,
                      d.created_by_agent_id::text,
                      d.created_at
                    FROM decision_requests d
                    WHERE d.signal_id = CAST(:sid AS uuid)
                      AND (
                        d.title ILIKE '%U37%'
                        OR d.prompt ILIKE '%U37%'
                      )
                    ORDER BY d.created_at DESC
                    LIMIT 5
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        if not rows:
            # fallback: latest from Extra
            rows = (
                await s.execute(
                    text(
                        """
                        SELECT
                          d.id::text,
                          d.status,
                          d.title,
                          d.prompt,
                          d.created_by_agent_id::text,
                          d.created_at
                        FROM decision_requests d
                        WHERE d.signal_id = CAST(:sid AS uuid)
                        ORDER BY d.created_at DESC
                        LIMIT 5
                        """
                    ),
                    {"sid": SID},
                )
            ).fetchall()
        for r in rows:
            who = "EXTRA" if r[4] == EXTRA else (r[4] or "?")
            print(f"{r[5]} [{who}] status={r[1]} title={r[2]!r} prompt={r[3]!r}")


asyncio.run(main())
