"""Probe open DecisionRequest duplicates on Ask/mail for U75."""
import asyncio
from uuid import UUID

from sqlalchemy import select, func

from app.db.session import async_session_factory
from app.models.notification import DecisionRequest

ASK = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")
MAIL = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")
ASK2 = UUID("000fefc7-bd1b-40f9-9f44-f6b24f9cb925")


async def main() -> None:
    async with async_session_factory() as s:
        for label, sid in [("ask84", ASK), ("ask000", ASK2), ("mail", MAIL)]:
            rows = (
                await s.execute(
                    select(DecisionRequest)
                    .where(
                        DecisionRequest.signal_id == sid,
                        DecisionRequest.status == "awaiting_human",
                    )
                    .order_by(DecisionRequest.created_at.desc())
                )
            ).scalars().all()
            print(f"=== {label} awaiting={len(rows)} ===")
            for r in rows[:12]:
                print(
                    str(r.id)[:8],
                    r.created_at,
                    "title=",
                    (r.title or "")[:50],
                    "bundle=",
                    (r.bundle_id or "")[:12],
                )
            # title dupes
            titles = (
                await s.execute(
                    select(DecisionRequest.title, func.count())
                    .where(DecisionRequest.signal_id == sid)
                    .group_by(DecisionRequest.title)
                    .having(func.count() > 1)
                    .order_by(func.count().desc())
                )
            ).all()
            if titles:
                print("title dups:", [(t, c) for t, c in titles[:8]])


if __name__ == "__main__":
    asyncio.run(main())
