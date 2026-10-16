"""Clear the stuck Ask floor chip on the 'hee' thread."""
from __future__ import annotations

import asyncio
import json
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

TID = "aaf94197-fd12-4a18-8520-d1861254573e"


async def main() -> None:
    e = create_async_engine(os.environ["DATABASE_URL"])
    async with e.begin() as c:
        row = (
            await c.execute(
                text("select active_turn_json from signals where id = :id"),
                {"id": TID},
            )
        ).first()
        print("before=", row[0] if row else None)
        # Keep streak remnant if any; drop the open floor chip.
        raw = json.loads((row[0] if row else None) or "{}")
        streak = int(raw.get("streak") or 0)
        streak_at = str(raw.get("streak_at") or "").strip()
        remnant = {}
        if streak > 0:
            remnant["streak"] = streak
            if streak_at:
                remnant["streak_at"] = streak_at
        await c.execute(
            text("update signals set active_turn_json = :j where id = :id"),
            {"id": TID, "j": json.dumps(remnant)},
        )
        after = (
            await c.execute(
                text("select active_turn_json from signals where id = :id"),
                {"id": TID},
            )
        ).first()
        print("after=", after[0] if after else None)
    await e.dispose()


if __name__ == "__main__":
    asyncio.run(main())
