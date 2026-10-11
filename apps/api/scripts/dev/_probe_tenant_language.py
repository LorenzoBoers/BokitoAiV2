"""Print ai_workspace_language / ai_reply_language per tenant."""
from __future__ import annotations

import asyncio
import json
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def _async_url(raw: str) -> str:
    if raw.startswith("postgresql://"):
        return raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    if raw.startswith("postgres://"):
        return raw.replace("postgres://", "postgresql+asyncpg://", 1)
    return raw


async def main() -> None:
    eng = create_async_engine(_async_url(os.environ["DATABASE_URL"]))
    async with eng.connect() as c:
        rows = (
            await c.execute(text("SELECT slug, settings_json FROM tenants ORDER BY slug"))
        ).all()
        for slug, sj in rows:
            data = json.loads(sj or "{}") if isinstance(sj, str) else {}
            print(
                slug,
                {
                    "ai_workspace_language": data.get("ai_workspace_language"),
                    "ai_reply_language": data.get("ai_reply_language"),
                },
            )
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
