"""Probe U70-related messages."""
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
                      kind,
                      left(coalesce(body_text, ''), 120),
                      decision_id::text,
                      left(coalesce(metadata_json::text, ''), 300)
                    FROM signal_messages
                    WHERE signal_id = CAST(:sid AS uuid)
                      AND created_at > now() - interval '15 minutes'
                    ORDER BY created_at DESC
                    LIMIT 25
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        for r in rows:
            print(f"{r[0]} kind={r[1]} dec={r[3]} body={r[2]!r}")
            if r[4] and ("U70" in r[4] or "kleur" in r[4] or "rood" in r[4].lower()):
                print("  meta", r[4])


asyncio.run(main())
