"""Count outbound / S17 messages on host thread after Ask S17."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        out = (
            await s.execute(
                text(
                    """
                    SELECT created_at, role, direction, channel,
                           left(coalesce(body_text,''), 120)
                    FROM signal_messages
                    WHERE signal_id = :id
                      AND (
                        body_text ILIKE '%S17%'
                        OR body_text ILIKE '%outbound test%'
                        OR direction = 'outbound'
                        OR role = 'agent'
                      )
                    ORDER BY created_at DESC
                    LIMIT 25
                    """
                ),
                {"id": str(HOST)},
            )
        ).fetchall()
        print("HOST_MATCHES", len(out))
        for r in out:
            print(r)

        # Any session messages with S17
        sess = (
            await s.execute(
                text(
                    """
                    SELECT m.created_at, m.signal_id::text, m.role,
                           left(coalesce(m.body_text,''), 160),
                           s.session_state, s.agent_id::text
                    FROM signal_messages m
                    JOIN signals s ON s.id = m.signal_id
                    WHERE m.body_text ILIKE '%S17%'
                    ORDER BY m.created_at DESC
                    LIMIT 20
                    """
                )
            )
        ).fetchall()
        print("S17_ANY", len(sess))
        for r in sess:
            print(r)

        # Outbound count on host in last hour
        cnt = (
            await s.execute(
                text(
                    """
                    SELECT count(*) FROM signal_messages
                    WHERE signal_id = :id
                      AND created_at > now() - interval '2 hours'
                      AND (
                        direction = 'outbound'
                        OR (role IN ('agent','assistant') AND channel IN ('email','smtp'))
                      )
                    """
                ),
                {"id": str(HOST)},
            )
        ).scalar()
        print("RECENT_OUTBOUNDish", cnt)


if __name__ == "__main__":
    asyncio.run(main())
