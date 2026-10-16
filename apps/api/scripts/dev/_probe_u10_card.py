"""Inspect revealed U10 card message payload for UI."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

MID = UUID("61ac603c-fac2-445f-815c-ab347969b43d")
DID = UUID("f4a4e5a0-3f94-4849-b99c-d51e1b31f515")
ASK = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        m = (
            await s.execute(
                text(
                    """
                    SELECT id, signal_id, kind, decision_id, left(body_text,200),
                           left(metadata_json::text, 2000), created_at, received_at
                    FROM signal_messages WHERE id = :mid
                    """
                ),
                {"mid": str(MID)},
            )
        ).fetchone()
        print("MSG", m)
        d = (
            await s.execute(
                text(
                    """
                    SELECT id, signal_id, status, title, summary, options_json, message_id
                    FROM decision_requests WHERE id = :did
                    """
                ),
                {"did": str(DID)},
            )
        ).fetchone()
        print("DEC", d)
        cards = (
            await s.execute(
                text(
                    """
                    SELECT id, kind, decision_id, left(body_text,80), created_at
                    FROM signal_messages
                    WHERE signal_id = :sid AND kind = 'decision_request'
                    ORDER BY created_at DESC LIMIT 5
                    """
                ),
                {"sid": str(ASK)},
            )
        ).fetchall()
        print("CARDS", cards)


if __name__ == "__main__":
    asyncio.run(main())
