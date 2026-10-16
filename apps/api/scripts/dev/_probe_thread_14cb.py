"""One-off: inspect thread 14cb3ae9 ordering / stuck turn."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import Signal, SignalEvent, SignalMessage

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        print(
            "SIGNAL",
            getattr(sig, "id", None),
            "status",
            getattr(sig, "status", None),
            "channel",
            getattr(sig, "channel", None),
        )
        msgs = (
            await s.execute(
                select(SignalMessage)
                .where(SignalMessage.signal_id == SID)
                .order_by(SignalMessage.created_at.asc())
            )
        ).scalars().all()
        print("MESSAGES", len(msgs))
        for m in msgs[-15:]:
            try:
                meta = json.loads(m.metadata_json or "{}")
            except json.JSONDecodeError:
                meta = {}
            body = (m.body_text or "")[:140].replace("\n", " ")
            print(
                f"  MSG {m.created_at.isoformat()} role={m.role} kind={m.kind} "
                f"agent={m.author_agent_id} turn={meta.get('turn_id')} "
                f"checkpoint={meta.get('checkpoint')} len={len(m.body_text or '')} "
                f"body={body!r}"
            )
            for key in ("activity", "activity_after", "activity_before"):
                act = meta.get(key)
                if isinstance(act, list) and act:
                    print(f"    {key}: {len(act)} items")
                    for item in act[:5]:
                        if isinstance(item, dict):
                            print(
                                f"      - tool={item.get('tool')} label={item.get('label')!r} "
                                f"status={item.get('status')}"
                            )
        evs = (
            await s.execute(
                select(SignalEvent)
                .where(SignalEvent.signal_id == SID)
                .order_by(SignalEvent.created_at.asc())
            )
        ).scalars().all()
        print("EVENTS", len(evs))
        for e in evs[-25:]:
            payload = e.payload_json or ""
            if len(payload) > 200:
                payload = payload[:200] + "..."
            print(
                f"  EVT {e.created_at.isoformat()} type={e.event_type} "
                f"actor={e.actor_type}:{e.actor_id} payload={payload}"
            )


if __name__ == "__main__":
    asyncio.run(main())
