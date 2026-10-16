"""Probe active_turn / session state for S16 QA threads."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")
CHILD = UUID("32636deb-effb-4cc2-b87f-b7b32149fd71")
BOKITO = "8d4dede2-751e-4475-b614-206a8415c577"
ORCH = "cc965b16-aff8-44a2-a0ea-29ebd4e5bccf"


async def main() -> None:
    async with async_session_factory() as s:
        cols = (
            await s.execute(
                text(
                    "select column_name from information_schema.columns "
                    "where table_name='signals' and "
                    "(column_name like '%turn%' or column_name like '%active%' "
                    "or column_name like '%parent%' or column_name like '%session%') "
                    "order by 1"
                )
            )
        ).fetchall()
        print("COLS", [c[0] for c in cols])

        for sid in (HOST, CHILD):
            row = (
                await s.execute(
                    text(
                        """
                        SELECT id::text, subject, session_state, channel,
                               parent_signal_id::text, agent_id::text,
                               active_turn_json
                        FROM signals WHERE id = :id
                        """
                    ),
                    {"id": str(sid)},
                )
            ).mappings().first()
            print("SIGNAL", dict(row) if row else {"missing": str(sid)})

            msgs = (
                await s.execute(
                    text(
                        """
                        SELECT created_at, role, author_agent_id::text,
                               left(coalesce(body_text,''), 120)
                        FROM signal_messages
                        WHERE signal_id = :id
                        ORDER BY created_at DESC LIMIT 6
                        """
                    ),
                    {"id": str(sid)},
                )
            ).fetchall()
            print("  msgs", msgs)

        stuck = (
            await s.execute(
                text(
                    """
                    SELECT id::text, left(coalesce(subject,''),40), agent_id::text,
                           active_turn_json, session_state, parent_signal_id::text
                    FROM signals
                    WHERE active_turn_json IS NOT NULL
                    ORDER BY updated_at DESC NULLS LAST
                    LIMIT 15
                    """
                )
            )
        ).fetchall()
        print("STUCK_ACTIVE", stuck)

        s16 = (
            await s.execute(
                text(
                    """
                    SELECT m.created_at, m.signal_id::text, m.role,
                           m.author_agent_id::text,
                           left(coalesce(m.body_text,''), 160),
                           s.agent_id::text, s.session_state
                    FROM signal_messages m
                    JOIN signals s ON s.id = m.signal_id
                    WHERE m.body_text ILIKE '%S16%'
                    ORDER BY m.created_at DESC
                    LIMIT 20
                    """
                )
            )
        ).fetchall()
        print("S16_MSGS")
        for r in s16:
            who = "Bokito" if r[3] == BOKITO else "Orchestrator" if r[3] == ORCH else (r[3] or "-")
            sess = "Bokito" if r[5] == BOKITO else "Orchestrator" if r[5] == ORCH else (r[5] or "-")
            print(r[0], r[1][:8], r[2], who, "sess=", sess, r[4])


if __name__ == "__main__":
    asyncio.run(main())
