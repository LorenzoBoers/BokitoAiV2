"""Probe 'hoe is het' thread for handoff / events / authorship."""
from __future__ import annotations

import asyncio
import json

from sqlalchemy import text

from app.db.session import async_session_factory


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT id::text, subject, agent_id::text,
                           active_turn_json, handoff_session_json, updated_at
                    FROM signals
                    WHERE subject ILIKE :q
                    ORDER BY updated_at DESC
                    LIMIT 5
                    """
                ),
                {"q": "%hoe is het%"},
            )
        ).all()
        print("THREADS", len(rows))
        for r in rows:
            print(r[0], r[1], "agent", r[2], "upd", r[5])
        if not rows:
            return
        sid = rows[0][0]
        print("ACTIVE", rows[0][3])
        print("HANDOFF", rows[0][4])
        msgs = (
            await s.execute(
                text(
                    """
                    SELECT id::text, kind, direction, author_agent_id::text,
                           left(body_text, 140), created_at
                    FROM signal_messages
                    WHERE signal_id = :id
                    ORDER BY created_at DESC
                    LIMIT 15
                    """
                ),
                {"id": sid},
            )
        ).all()
        print("MSGS")
        for m in msgs:
            print(m)
        evs = (
            await s.execute(
                text(
                    """
                    SELECT event_type, actor_type, actor_id,
                           left(coalesce(payload_json, ''), 100), created_at
                    FROM signal_events
                    WHERE signal_id = :id
                    ORDER BY created_at DESC
                    LIMIT 25
                    """
                ),
                {"id": sid},
            )
        ).all()
        print("EVENTS")
        for e in evs:
            print(e)
        agents = (
            await s.execute(
                text(
                    """
                    SELECT id::text, name FROM agents
                    WHERE id IN (
                      SELECT DISTINCT author_agent_id FROM signal_messages
                      WHERE signal_id = :id AND author_agent_id IS NOT NULL
                    )
                    OR id = (SELECT agent_id FROM signals WHERE id = :id)
                    """
                ),
                {"id": sid},
            )
        ).all()
        print("AGENTS", agents)


if __name__ == "__main__":
    asyncio.run(main())
