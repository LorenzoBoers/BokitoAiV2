"""Probe latest decisions on Ask (U70 multi-option)."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "84c74f47-51bd-476c-ac12-4fcf1ac6f912"


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT
                      created_at,
                      status,
                      title,
                      left(options_json::text, 400),
                      chosen_option_id
                    FROM decision_requests
                    WHERE signal_id = CAST(:sid AS uuid)
                    ORDER BY created_at DESC
                    LIMIT 8
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        for r in rows:
            print(r[0], r[1], repr(r[2]), "opts", r[3], "chosen", r[4])


asyncio.run(main())
