"""Why U10 decisions landed on mail thread 14cb instead of ask thread 84c."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

ASK = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")
MAIL = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")
RUN = UUID("e7250a50-1b2e-4138-8dae-bd119c9b734a")


async def main() -> None:
    async with async_session_factory() as s:
        for label, sid in (("ask", ASK), ("mail", MAIL)):
            row = (
                await s.execute(
                    text(
                        """
                        SELECT id, subject, channel, status, context_signal_id,
                               left(coalesce(floor_json::text,''),400)
                        FROM signals WHERE id = :sid
                        """
                    ),
                    {"sid": str(sid)},
                )
            ).fetchone()
            print(f"=== {label} ===", row)
        run = (
            await s.execute(
                text("SELECT id, signal_id, agent_id, status, started_at FROM agent_runs WHERE id = :rid"),
                {"rid": str(RUN)},
            )
        ).fetchone()
        print("=== run ===", run)
        bubble = (
            await s.execute(
                text(
                    """
                    SELECT signal_id, kind, left(body_text,60)
                    FROM signal_messages
                    WHERE metadata_json::text LIKE :rid
                    ORDER BY created_at DESC LIMIT 5
                    """
                ),
                {"rid": f"%{RUN}%"},
            )
        ).fetchall()
        print("=== bubbles mentioning run ===")
        for b in bubble:
            print(b)
        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind, decision_id, left(body_text,100)
                    FROM signal_messages
                    WHERE signal_id = :sid AND created_at > '2026-10-15 20:29:00'
                    ORDER BY created_at
                    """
                ),
                {"sid": str(MAIL)},
            )
        ).fetchall()
        print("=== mail msgs after 20:29 ===")
        for m in msgs:
            print(m)


if __name__ == "__main__":
    asyncio.run(main())
