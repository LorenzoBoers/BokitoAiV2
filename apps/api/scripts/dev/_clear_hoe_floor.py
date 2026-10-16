"""Clear stuck floor on hoe-is-het probe thread."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "6d4dd5fa-c715-48fe-881b-e5968176ca57"


async def main() -> None:
    async with async_session_factory() as s:
        await s.execute(
            text(
                "UPDATE signals SET active_turn_json='{}', handoff_session_json='{}' "
                "WHERE id = :id"
            ),
            {"id": SID},
        )
        await s.commit()
        print("cleared", SID)


if __name__ == "__main__":
    asyncio.run(main())
