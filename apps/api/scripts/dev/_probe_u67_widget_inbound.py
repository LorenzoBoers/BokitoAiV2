"""Latest inbound on widget for U67 stale draft."""
import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import SignalMessage

SID = UUID("6466f9a1-1eef-4f8e-a03d-f1fa7ce563af")


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
        if not rows:
            print("NO_INBOUND")
            return
        for r in rows:
            print(str(r.id), r.created_at, (r.body_text or "")[:60])


if __name__ == "__main__":
    asyncio.run(main())
