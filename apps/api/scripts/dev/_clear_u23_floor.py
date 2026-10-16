"""Clear interrupted handoff floor on Ask thread so peer can wake."""
from __future__ import annotations

import asyncio
import json

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "84c74f47-51bd-476c-ac12-4fcf1ac6f912"


async def main() -> None:
    async with async_session_factory() as s:
        row = (
            await s.execute(
                text("SELECT floor_json FROM signals WHERE id = CAST(:id AS uuid)"),
                {"id": SID},
            )
        ).first()
        print("before", json.dumps(row[0] if row else None)[:400])
        await s.execute(
            text(
                """
                UPDATE signals
                SET floor_json = jsonb_build_object(
                  'handoff_session', NULL,
                  'active_turn', NULL
                )
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": SID},
        )
        await s.commit()
        row2 = (
            await s.execute(
                text("SELECT floor_json FROM signals WHERE id = CAST(:id AS uuid)"),
                {"id": SID},
            )
        ).first()
        print("after", row2[0])


if __name__ == "__main__":
    asyncio.run(main())
