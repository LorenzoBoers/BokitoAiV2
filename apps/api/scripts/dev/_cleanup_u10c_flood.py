"""Remove flood of U10c duplicate decision cards; keep one and approve it."""
from __future__ import annotations

import asyncio
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, text

from app.db.session import async_session_factory
from app.models.notification import DecisionRequest

ASK = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")
KEEP = UUID("aa2fed87-d4a2-4d3e-bc44-513794770542")
KEEP_MSG = UUID("23cbbbc6-c0c7-4892-8aa1-a7fe45d98715")


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                select(DecisionRequest).where(
                    DecisionRequest.signal_id == ASK,
                    DecisionRequest.title == "U10c klaar?",
                )
            )
        ).scalars().all()
        for d in rows:
            if d.id == KEEP:
                continue
            d.status = "deferred"
            d.chosen_option_id = "superseded"
            d.resolved_at = datetime.utcnow()
            s.add(d)
        # Drop duplicate decision messages (keep one)
        await s.execute(
            text(
                """
                DELETE FROM signal_messages
                WHERE signal_id = :sid
                  AND kind = 'decision_request'
                  AND id <> :keep_msg
                  AND (
                    body_text = 'U10c klaar?'
                    OR decision_id IN (
                      SELECT id FROM decision_requests
                      WHERE signal_id = :sid AND title = 'U10c klaar?' AND id <> :keep
                    )
                  )
                """
            ),
            {"sid": str(ASK), "keep_msg": str(KEEP_MSG), "keep": str(KEEP)},
        )
        # Approve keep
        keep = await s.get(DecisionRequest, KEEP)
        if keep is not None:
            keep.status = "approved"
            keep.chosen_option_id = "ja"
            keep.resolved_at = datetime.utcnow()
            s.add(keep)
        await s.commit()
        print("cleaned; keep approved", KEEP)


if __name__ == "__main__":
    asyncio.run(main())
