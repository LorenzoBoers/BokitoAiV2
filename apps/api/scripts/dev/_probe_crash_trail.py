"""Inspect crash + stuck Update folder canvas trail on a thread."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import desc, select

from app.db.session import async_session_factory
from app.models.signal import Signal, SignalMessage, SignalEvent
from app.models.agent import AgentRun

SID = UUID("847c0b0e-6bd3-440b-a352-bd1c32701667")


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        if not sig:
            print("NO_SIGNAL")
            return
        print("subject", sig.subject)
        print("tenant", sig.tenant_id)
        print("agent", sig.agent_id)
        print("ACTIVE", (sig.active_turn_json or "")[:300])
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
            try:
                meta = json.loads(m.metadata_json or "{}")
            except json.JSONDecodeError:
                meta = {}
            acts = meta.get("activity") or []
            after = meta.get("activity_after") or []
            print(
                m.created_at,
                m.kind,
                (m.body_text or "")[:90],
                "in_progress",
                meta.get("in_progress"),
                "turn",
                meta.get("turn_id"),
                "act",
                [
                    (a.get("tool") or a.get("label"), a.get("status"))
                    for a in (acts + after)[-6:]
                    if isinstance(a, dict)
                ],
            )
        runs = (
            await s.execute(
                select(AgentRun)
                .where(AgentRun.signal_id == SID)
                .order_by(desc(AgentRun.created_at))
                .limit(5)
            )
        ).scalars().all()
        print("RUNS")
        for r in runs:
            print(r.created_at, r.status, r.trigger_type, r.error_message and str(r.error_message)[:160])
        evs = (
            await s.execute(
                select(SignalEvent)
                .where(SignalEvent.signal_id == SID)
                .order_by(desc(SignalEvent.created_at))
                .limit(8)
            )
        ).scalars().all()
        print("EVENTS")
        for e in evs:
            print(e.created_at, e.event_type, (e.payload_json or "")[:100])


if __name__ == "__main__":
    asyncio.run(main())
