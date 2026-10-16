"""Clear active_turn / streak remnant on the internal Orchestrator QA thread."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = UUID("72fbd32a-fb2c-4f12-8d7c-eb13ed87de58")


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
