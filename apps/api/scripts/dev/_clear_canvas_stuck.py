"""Clear stuck Orchestrator canvas turn and list related canvases."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import desc, select

from app.db.session import async_session_factory
from app.models.project_canvas import ProjectCanvas
from app.models.signal import Signal, SignalMessage
from app.services.project_canvas import is_empty_tree, serialize_canvas

SID = UUID("b648335d-19d3-4cfd-9fda-bc53f41fed2b")


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        if not sig:
            print("NO_SIGNAL")
            return
        print("ACTIVE_BEFORE", (sig.active_turn_json or "")[:160])
        canvases = (
            await s.execute(
                select(ProjectCanvas)
                .where(
                    ProjectCanvas.tenant_id == sig.tenant_id,
                    ProjectCanvas.deleted_at.is_(None),
                )
                .order_by(desc(ProjectCanvas.updated_at))
                .limit(12)
            )
        ).scalars().all()
        print("CANVASES", len(canvases))
        for c in canvases:
            payload = serialize_canvas(c)
            print(
                payload["id"],
                payload["title"],
                "empty",
                payload["empty"],
                "signal",
                payload.get("signal_id"),
                "rev",
                payload["revision"],
            )

        sig.active_turn_json = "{}"
        s.add(sig)
        msgs = (
            await s.execute(
                select(SignalMessage)
                .where(SignalMessage.signal_id == SID)
                .order_by(desc(SignalMessage.created_at))
                .limit(6)
            )
        ).scalars().all()
        for m in msgs:
            try:
                meta = json.loads(m.metadata_json or "{}")
            except json.JSONDecodeError:
                meta = {}
            if not isinstance(meta, dict):
                meta = {}
            if meta.get("in_progress"):
                meta["in_progress"] = False
                # Seal running activity so the trail stops looking live.
                for key in ("activity", "activity_after"):
                    items = meta.get(key)
                    if isinstance(items, list):
                        for item in items:
                            if isinstance(item, dict) and item.get("status") == "running":
                                item["status"] = "error"
                                item["ended_at"] = item.get("ended_at") or item.get("started_at")
                m.metadata_json = json.dumps(meta)
                s.add(m)
                print("sealed", m.id, (m.body_text or "")[:50])
        await s.commit()
        print("cleared")


if __name__ == "__main__":
    asyncio.run(main())
