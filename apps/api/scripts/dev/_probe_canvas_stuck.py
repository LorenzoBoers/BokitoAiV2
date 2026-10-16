"""Probe stuck canvas turn on dashboard thread."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import desc, select, text

from app.db.session import async_session_factory
from app.models.signal import Signal, SignalEvent, SignalMessage

SID = UUID("b648335d-19d3-4cfd-9fda-bc53f41fed2b")


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        if not sig:
            print("NO_SIGNAL")
            return
        print("subject", sig.subject)
        print("status", sig.status)
        print("agent", sig.agent_id)
        print("project", sig.project_id)
        print("ACTIVE", (sig.active_turn_json or "")[:500])
        print("HANDOFF", (sig.handoff_session_json or "")[:200])
        msgs = (
            await s.execute(
                select(SignalMessage)
                .where(SignalMessage.signal_id == SID)
                .order_by(desc(SignalMessage.created_at))
                .limit(8)
            )
        ).scalars().all()
        print("MSGS")
        for m in msgs:
            meta = {}
            try:
                meta = json.loads(m.metadata_json or "{}")
            except json.JSONDecodeError:
                pass
            print(
                m.created_at,
                m.kind,
                m.author_agent_id,
                (m.body_text or "")[:120],
                "in_progress",
                meta.get("in_progress"),
                "turn",
                meta.get("turn_id"),
                "tools",
                [a.get("tool") for a in (meta.get("activity") or [])[-4:]]
                if isinstance(meta.get("activity"), list)
                else None,
            )
        evs = (
            await s.execute(
                select(SignalEvent)
                .where(SignalEvent.signal_id == SID)
                .order_by(desc(SignalEvent.created_at))
                .limit(12)
            )
        ).scalars().all()
        print("EVENTS")
        for e in evs:
            print(e.created_at, e.event_type, (e.payload_json or "")[:120])
        # Folder canvases linked to this project / recent canvas tools
        rows = (
            await s.execute(
                text(
                    """
                    SELECT id::text, name, project_id::text, status, updated_at,
                           left(coalesce(payload_json::text, ''), 80)
                    FROM folder_canvases
                    WHERE tenant_id = :tid
                    ORDER BY updated_at DESC
                    LIMIT 10
                    """
                ),
                {"tid": str(sig.tenant_id)},
            )
        ).all()
        print("CANVASES", len(rows))
        for r in rows:
            print(r)


if __name__ == "__main__":
    asyncio.run(main())
