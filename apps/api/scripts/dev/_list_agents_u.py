import asyncio
from sqlalchemy import text
from app.db.session import async_session_factory


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT id::text, name
                    FROM agents
                    WHERE name ILIKE '%orch%'
                       OR name ILIKE '%extra%'
                       OR name ILIKE '%bokito%'
                    ORDER BY name
                    """
                )
            )
        ).fetchall()
        for r in rows:
            print(f"{r[0]}\t{r[1]}")


asyncio.run(main())
