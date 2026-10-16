"""Clear active_turn / streak remnant on the A2A QA host thread."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        await s.execute(
            text("UPDATE signals SET active_turn_json = :j WHERE id = :id"),
            {"j": "{}", "id": str(HOST)},
        )
        await s.commit()
        print("cleared", HOST)


if __name__ == "__main__":
    asyncio.run(main())
