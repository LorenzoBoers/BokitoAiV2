"""Clear handoff floor on Ask thread so a fresh live turn can start."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

ASK = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        row = (
            await s.execute(
                text("SELECT left(coalesce(floor_json::text,''), 200) FROM signals WHERE id = :id"),
                {"id": str(ASK)},
            )
        ).fetchone()
        print("before", row)
        await s.execute(
            text("UPDATE signals SET floor_json = CAST('{}' AS jsonb) WHERE id = :id"),
            {"id": str(ASK)},
        )
        await s.commit()
        row2 = (
            await s.execute(
                text("SELECT floor_json FROM signals WHERE id = :id"),
                {"id": str(ASK)},
            )
        ).fetchone()
        print("after", row2)


asyncio.run(main())
