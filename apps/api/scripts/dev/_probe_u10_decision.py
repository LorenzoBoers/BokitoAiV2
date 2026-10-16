"""Inspect U10 decision_request payload for options."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT m.created_at, m.kind, left(m.body_text, 120),
                           m.decision_id,
                           left(m.metadata_json::text, 500)
                    FROM signal_messages m
                    WHERE m.signal_id = :sid
                      AND m.created_at > '2026-10-15 20:29:00'
                    ORDER BY m.created_at
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        for r in rows:
            print("---", r[0], r[1], "dec=", r[3], repr(r[2]))
            print("meta", r[4])
        cols = (
            await s.execute(
                text(
                    """
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'decision_requests'
                    ORDER BY ordinal_position
                    """
                )
            )
        ).fetchall()
        print("=== decision_requests cols ===", [c[0] for c in cols])
        decs = (
            await s.execute(
                text(
                    """
                    SELECT id, status, left(title, 120), left(summary, 200),
                           left(options_json::text, 800),
                           chosen_option_id, created_at, message_id
                    FROM decision_requests
                    WHERE signal_id = :sid
                       OR id IN (
                         SELECT decision_id FROM signal_messages
                         WHERE signal_id = :sid AND decision_id IS NOT NULL
                       )
                    ORDER BY created_at DESC
                    LIMIT 8
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("=== decisions ===")
        for d in decs:
            print(d[6], d[0], d[1], "title=", repr(d[2]), "sum=", repr(d[3]))
            print("options", d[4], "chosen", d[5], "msg", d[7])
        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind, decision_id, left(body_text, 80),
                           left(metadata_json::text, 300)
                    FROM signal_messages
                    WHERE signal_id = :sid AND (kind LIKE '%decision%' OR decision_id IS NOT NULL)
                    ORDER BY created_at DESC LIMIT 10
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("=== decision msgs ===")
        for m in msgs:
            print(m[0], m[1], m[2], repr(m[3]), m[4])


if __name__ == "__main__":
    asyncio.run(main())
