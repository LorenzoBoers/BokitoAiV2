"""Supersede orphaned U10 decisions that never got a thread card."""
from __future__ import annotations

import asyncio
from datetime import datetime
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

IDS = [
    UUID("1742432f-4038-4ed3-88d2-2c958e36d02d"),
    UUID("4214a816-3eca-4554-9545-74d914235453"),
    UUID("8573dec5-fe3b-456d-aee4-e09b0eb9205a"),
    UUID("338e000f-6e5d-49c7-9c54-4eb58f840056"),
]


async def main() -> None:
    async with async_session_factory() as s:
        for did in IDS:
            await s.execute(
                text(
                    """
                    UPDATE decision_requests
                    SET status = 'deferred',
                        chosen_option_id = 'superseded',
                        resolved_at = :now
                    WHERE id = :id AND status = 'awaiting_human' AND message_id IS NULL
                    """
                ),
                {"id": str(did), "now": datetime.utcnow()},
            )
        await s.commit()
        print("superseded", len(IDS))


if __name__ == "__main__":
    asyncio.run(main())
