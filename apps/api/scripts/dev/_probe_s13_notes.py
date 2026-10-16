"""Probe recent notes/messages on QA thread for S13 mention wake."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        cols = (
            await s.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'signal_messages'
                    ORDER BY 1
                    """
                )
            )
        ).fetchall()
        print("columns:", [c[0] for c in cols])
        # Prefer body/text/content whichever exists
        names = {c[0] for c in cols}
        body_col = next(
            (c for c in ("body_text", "body", "text", "content", "message") if c in names),
            None,
        )
        meta_col = next(
            (c for c in ("metadata_json", "meta", "meta_json", "metadata") if c in names),
            None,
        )
        if not body_col:
            raise SystemExit("no body column")
        meta_sel = f"left(coalesce({meta_col}::text,''), 240)" if meta_col else "''"
        msgs = (
            await s.execute(
                text(
                    f"""
                    SELECT created_at, role, left(coalesce({body_col},''), 200),
                           {meta_sel}
                    FROM signal_messages
                    WHERE signal_id = :sid
                    ORDER BY created_at DESC
                    LIMIT 12
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("--- messages ---")
        for r in msgs:
            print(r[0], r[1], repr(r[2]))
            if r[3]:
                print("  meta:", r[3][:220])
        ev = (
            await s.execute(
                text(
                    """
                    SELECT created_at, event_type, actor_type,
                           left(coalesce(payload_json,''), 160)
                    FROM signal_events
                    WHERE signal_id = :sid
                    ORDER BY created_at DESC
                    LIMIT 15
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("--- events ---")
        for r in ev:
            print(r[0], r[1], r[2], (r[3] or "")[:140])


if __name__ == "__main__":
    asyncio.run(main())
