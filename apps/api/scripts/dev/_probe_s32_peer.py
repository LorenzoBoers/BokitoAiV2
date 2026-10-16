"""Look for S32 peer chat after start_conversation."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = UUID("72fbd32a-fb2c-4f12-8d7c-eb13ed87de58")
BOKITO = UUID("8d4dede2-751e-4475-b614-206a8415c577")
ORCH = UUID("cc965b16-aff8-44a2-a0ea-29ebd4e5bccf")


async def main() -> None:
    async with async_session_factory() as s:
        host = (
            await s.execute(
                text(
                    """
                    select created_at, author_agent_id::text,
                           left(coalesce(body_text,''), 160), metadata_json
                    from signal_messages
                    where signal_id = :sid
                      and created_at > now() - interval '10 minutes'
                    order by created_at desc
                    limit 12
                    """
                ),
                {"sid": HOST},
            )
        ).fetchall()
        print("HOST_RECENT")
        for r in host:
            meta = {}
            try:
                meta = json.loads(r[3] or "{}")
            except Exception:
                pass
            print(" ", r[0], (r[1] or "")[:8], "ip=", meta.get("in_progress"), "|", (r[2] or "")[:140])

        peers = (
            await s.execute(
                text(
                    """
                    select s.id::text, s.channel, s.source, s.status, s.created_at,
                           left(coalesce(s.subject,''), 80),
                           (
                             select left(coalesce(m.body_text,''), 100)
                             from signal_messages m
                             where m.signal_id = s.id
                             order by m.created_at desc limit 1
                           ) as last_body
                    from signals s
                    where s.created_at > now() - interval '15 minutes'
                      and s.id <> :host
                      and (s.source = 'agent_peer' or s.channel = 'internal')
                    order by s.created_at desc
                    limit 10
                    """
                ),
                {"host": HOST},
            )
        ).fetchall()
        print("RECENT_INTERNAL")
        for r in peers:
            print(" ", r)

        both = (
            await s.execute(
                text(
                    """
                    select s.id::text, s.created_at, s.channel, s.source, s.subject,
                           array_agg(sp.kind || ':' || sp.ref_id::text) as refs
                    from signals s
                    join signal_participants sp on sp.signal_id = s.id
                    where s.created_at > now() - interval '15 minutes'
                      and s.id <> :host
                    group by s.id, s.created_at, s.channel, s.source, s.subject
                    having
                      bool_or(sp.kind = 'agent' and sp.ref_id = :bokito)
                      and bool_or(sp.kind = 'agent' and sp.ref_id = :orch)
                    order by s.created_at desc
                    limit 10
                    """
                ),
                {"host": HOST, "bokito": BOKITO, "orch": ORCH},
            )
        ).fetchall()
        print("BOTH_AGENTS")
        for r in both:
            print(" ", r)


if __name__ == "__main__":
    asyncio.run(main())
