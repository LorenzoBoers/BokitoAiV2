"""Probe mail/ask thread status for U83 close/reopen live."""
import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import Signal

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")
ASK = UUID("000fefc7-bd1b-40f9-9f44-f6b24f9cb925")


async def main() -> None:
    async with async_session_factory() as s:
        for label, sid in [("mail", SID), ("ask", ASK)]:
            row = (await s.execute(select(Signal).where(Signal.id == sid))).scalar_one_or_none()
            if not row:
                print(label, "MISSING")
                continue
            print(
                label,
                "status=",
                row.status,
                "subject=",
                (row.subject or "")[:60],
                "ai_handling=",
                getattr(row, "ai_handling", None),
                "ticket=",
                getattr(row, "ticket_tag_id", None),
            )


if __name__ == "__main__":
    asyncio.run(main())
