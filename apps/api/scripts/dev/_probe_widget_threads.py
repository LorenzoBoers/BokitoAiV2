"""Find widget / livechat threads for U80."""
import asyncio

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import Signal


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                select(Signal)
                .where(Signal.channel.in_(("livechat", "widget", "webchat")))
                .order_by(Signal.updated_at.desc())
                .limit(15)
            )
        ).scalars().all()
        for r in rows:
            print(
                str(r.id),
                r.status,
                r.channel,
                (r.subject or "")[:50],
                "updated=",
                r.updated_at,
            )


if __name__ == "__main__":
    asyncio.run(main())
