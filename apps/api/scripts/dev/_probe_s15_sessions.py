"""Probe assistant sessions linked to host thread for S15."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")
BOKITO = "8d4dede2-751e-4475-b614-206a8415c577"
ORCH = "cc965b16-aff8-44a2-a0ea-29ebd4e5bccf"


async def main() -> None:
    async with async_session_factory() as s:
        sessions = (
            await s.execute(
                text(
                    """
                    SELECT created_at, id::text, agent_id::text, session_state,
                           parent_signal_id::text, channel,
                           left(coalesce(subject,''), 50)
                    FROM signals
                    WHERE session_state IS NOT NULL
                      AND (parent_signal_id = :sid OR id = :sid)
                    ORDER BY created_at DESC
                    LIMIT 15
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("--- sessions ---", len(sessions))
        for r in sessions:
            aid = r[2]
            who = "Bokito" if aid == BOKITO else "Orchestrator" if aid == ORCH else aid
            print(r[0], r[1][:8], who, r[3], "parent=", (r[4] or "-")[:8], r[5], r[6])

        msgs = (
            await s.execute(
                text(
                    """
                    SELECT m.created_at, m.signal_id::text, m.role, m.author_agent_id::text,
                           left(coalesce(m.body_text,''), 160),
                           s.agent_id::text, s.session_state, s.parent_signal_id::text
                    FROM signal_messages m
                    JOIN signals s ON s.id = m.signal_id
                    WHERE m.body_text ILIKE '%S15%'
                    ORDER BY m.created_at DESC
                    LIMIT 10
                    """
                )
            )
        ).fetchall()
        print("--- S15 msgs ---", len(msgs))
        for r in msgs:
            author = "Bokito" if r[3] == BOKITO else "Orchestrator" if r[3] == ORCH else (r[3] or "-")
            sess = "Bokito" if r[5] == BOKITO else "Orchestrator" if r[5] == ORCH else (r[5] or "-")
            print(
                r[0],
                r[1][:8],
                r[2],
                "auth=" + author,
                "sess=" + sess,
                r[6],
                "parent=",
                (r[7] or "-")[:8],
                repr(r[4]),
            )

        # latest assistant messages mentioning bokito word
        recent = (
            await s.execute(
                text(
                    """
                    SELECT m.created_at, m.signal_id::text, s.agent_id::text, m.role,
                           m.author_agent_id::text, left(coalesce(m.body_text,''), 120),
                           s.parent_signal_id::text
                    FROM signal_messages m
                    JOIN signals s ON s.id = m.signal_id
                    WHERE s.channel = 'assistant'
                      AND m.created_at > now() - interval '30 minutes'
                    ORDER BY m.created_at DESC
                    LIMIT 20
                    """
                )
            )
        ).fetchall()
        print("--- recent assistant msgs ---")
        for r in recent:
            sess = "Bokito" if r[2] == BOKITO else "Orchestrator" if r[2] == ORCH else (r[2] or "-")
            author = "Bokito" if r[4] == BOKITO else "Orchestrator" if r[4] == ORCH else (r[4] or "-")
            print(r[0], r[1][:8], "sess="+sess, r[3], "auth="+author, "parent=", (r[6] or "-")[:8], repr(r[5]))


if __name__ == "__main__":
    asyncio.run(main())
