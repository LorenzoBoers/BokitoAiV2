"""List agents for S31 specialist chain."""
from __future__ import annotations

from sqlalchemy import text

from app.db.session import async_session_factory


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT id::text, name, status
                    FROM agents
                    ORDER BY name
                    """
                )
            )
        ).fetchall()
        for r in rows:
            print(r)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
