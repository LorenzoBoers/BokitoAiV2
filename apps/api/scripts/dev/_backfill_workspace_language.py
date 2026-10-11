"""Persist ai_workspace_language=nl when unset (makes the General setting sticky)."""
from __future__ import annotations

import asyncio
import json
import os
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def _async_url(raw: str) -> str:
    if raw.startswith("postgresql://"):
        return raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    if raw.startswith("postgres://"):
        return raw.replace("postgres://", "postgresql+asyncpg://", 1)
    return raw


async def main(*, apply: bool, default: str = "nl") -> None:
    eng = create_async_engine(_async_url(os.environ["DATABASE_URL"]))
    async with eng.begin() as c:
        rows = (await c.execute(text("SELECT id, slug, settings_json FROM tenants"))).all()
        updated = 0
        for tenant_id, slug, sj in rows:
            data = json.loads(sj or "{}") if isinstance(sj, str) else {}
            if not isinstance(data, dict):
                data = {}
            if data.get("ai_workspace_language") in ("nl", "en", "de", "fr", "es"):
                print(slug, "already", data.get("ai_workspace_language"))
                continue
            print(slug, "→", default)
            if apply:
                data["ai_workspace_language"] = default
                await c.execute(
                    text(
                        "UPDATE tenants SET settings_json = :sj WHERE id = :id"
                    ),
                    {"sj": json.dumps(data), "id": tenant_id},
                )
                updated += 1
        print("updated" if apply else "dry-run would update", updated if apply else "all unset")
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv))
