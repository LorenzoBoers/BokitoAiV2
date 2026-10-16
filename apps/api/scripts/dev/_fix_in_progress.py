"""Find and clear stuck in_progress message metadata on internal QA host."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("72fbd32a-fb2c-4f12-8d7c-eb13ed87de58")


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    select id::text, direction, created_at,
                           left(coalesce(body_text,''), 80),
                           metadata_json
                    from signal_messages
                    where signal_id = :sid
                    order by created_at desc
                    limit 50
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        print("messages", len(rows))
        stuck = []
        for r in rows:
            raw = r[4] or "{}"
            try:
                meta = json.loads(raw) if isinstance(raw, str) else (raw or {})
            except Exception:
                meta = {}
            if not isinstance(meta, dict):
                meta = {}
            ip = meta.get("in_progress")
            tid = meta.get("turn_id") or meta.get("stream_id")
            if ip or True:
                # only print last 15 always; highlight stuck
                pass
            print(
                " ",
                r[0][:8],
                r[1],
                "in_progress=",
                ip,
                "turn=",
                str(tid or "")[:12],
                "|",
                (r[3] or "")[:60],
            )
            if ip:
                stuck.append((r[0], meta))
        if not stuck:
            print("no stuck in_progress")
            return
        for mid, meta in stuck:
            meta.pop("in_progress", None)
            await s.execute(
                text(
                    """
                    update signal_messages
                    set metadata_json = :meta
                    where id = :mid
                    """
                ),
                {"mid": mid, "meta": json.dumps(meta, default=str)},
            )
            print("cleared", mid)
        await s.commit()
        print("done")


if __name__ == "__main__":
    asyncio.run(main())
