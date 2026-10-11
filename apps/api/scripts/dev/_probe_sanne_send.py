"""Probe Sanne thread outbound send state."""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def _url() -> str:
    url = os.environ["DATABASE_URL"]
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def main() -> None:
    tid = "314aa35f-a7fa-451e-bbf5-a86ea1cacd20"
    eng = create_async_engine(_url())
    async with eng.connect() as c:
        rows = (
            await c.execute(
                text(
                    """
SELECT m.id::text, m.kind, m.direction, m.send_status,
       left(coalesce(m.body_text,''), 80) AS body,
       m.created_at
FROM signal_messages m
WHERE m.signal_id = :tid
ORDER BY m.created_at DESC
LIMIT 8
"""
                ),
                {"tid": tid},
            )
        ).mappings().all()
        for r in rows:
            print(dict(r))
        ch = (
            await c.execute(
                text(
                    """
SELECT s.channel, s.channel_account_id::text, ca.provider, ca.status
FROM signals s
LEFT JOIN channel_accounts ca ON ca.id = s.channel_account_id
WHERE s.id = :tid
"""
                ),
                {"tid": tid},
            )
        ).mappings().first()
        print("THREAD", dict(ch) if ch else None)
        # Recent outbound on this tenant with QA marker
        recent = (
            await c.execute(
                text(
                    """
SELECT m.id::text, m.signal_id::text, m.send_status, left(coalesce(m.body_text,''), 60) AS body, m.created_at
FROM signal_messages m
WHERE m.body_text ILIKE '%QA soft-undo%'
ORDER BY m.created_at DESC
LIMIT 5
"""
                )
            )
        ).mappings().all()
        print("QA_MSGS", [dict(r) for r in recent])
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
