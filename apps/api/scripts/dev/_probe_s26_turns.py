"""Inspect host/child active_turn + recent messages for S26."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")
CHILD = UUID("5cd56319-2a26-4c2b-ad54-2d97c44a52e6")


async def main() -> None:
    async with async_session_factory() as s:
        for sid in (HOST, CHILD):
            row = (
                await s.execute(
                    text(
                        """
                        SELECT id::text, subject, session_state, channel, source,
                               parent_signal_id::text, agent_id::text,
                               active_turn_json
                        FROM signals WHERE id = :id
                        """
                    ),
                    {"id": str(sid)},
                )
            ).mappings().first()
            print("=== SIGNAL", dict(row) if row else {"missing": str(sid)})
            if not row:
                continue
            msgs = (
                await s.execute(
                    text(
                        """
                        SELECT created_at, role, author_agent_id::text,
                               left(coalesce(body_text,''), 140)
                        FROM signal_messages
                        WHERE signal_id = :id
                        ORDER BY created_at DESC LIMIT 12
                        """
                    ),
                    {"id": str(sid)},
                )
            ).fetchall()
            print("  msgs:")
            for m in msgs:
                print("   ", m)
            evs = (
                await s.execute(
                    text(
                        """
                        SELECT created_at, event_type,
                               left(coalesce(payload_json,''), 180)
                        FROM signal_events
                        WHERE signal_id = :id
                        ORDER BY created_at DESC LIMIT 12
                        """
                    ),
                    {"id": str(sid)},
                )
            ).fetchall()
            print("  events:")
            for e in evs:
                print("   ", e)

        stuck = (
            await s.execute(
                text(
                    """
                    SELECT id::text, left(coalesce(subject,''),40), agent_id::text,
                           active_turn_json, session_state, parent_signal_id::text
                    FROM signals
                    WHERE parent_signal_id = :host
                       OR id = :host
                       OR id = :child
                    ORDER BY updated_at DESC NULLS LAST
                    LIMIT 20
                    """
                ),
                {"host": str(HOST), "child": str(CHILD)},
            )
        ).fetchall()
        print("RELATED", stuck)


if __name__ == "__main__":
    asyncio.run(main())
