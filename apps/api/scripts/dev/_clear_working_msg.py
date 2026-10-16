"""Remove orphaned in-progress 'Working on this.' bubble that keeps Stop stuck."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

ASK = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT id, kind, body_text, left(metadata_json::text, 300), created_at
                    FROM signal_messages
                    WHERE signal_id = :sid
                      AND (
                        body_text ILIKE 'Working on this%'
                        OR metadata_json::text ILIKE '%in_progress%'
                        OR metadata_json::text ILIKE '%\"checkpoint\"%'
                      )
                    ORDER BY created_at DESC
                    LIMIT 10
                    """
                ),
                {"sid": str(ASK)},
            )
        ).fetchall()
        print("candidates", rows)
        await s.execute(
            text(
                """
                DELETE FROM signal_messages
                WHERE signal_id = :sid
                  AND body_text = 'Working on this.'
                  AND kind = 'agent_message'
                """
            ),
            {"sid": str(ASK)},
        )
        await s.commit()
        print("deleted working bubbles")


if __name__ == "__main__":
    asyncio.run(main())
