"""Latest inbound message id on mail host for U67 stale draft."""
import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import SignalMessage

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == SID,
                    SignalMessage.direction == "inbound",
                )
                .order_by(SignalMessage.created_at.desc())
                .limit(3)
            )
        ).scalars().all()
        for r in rows:
            print(str(r.id), r.created_at, (r.body_text or "")[:60])


if __name__ == "__main__":
    asyncio.run(main())
