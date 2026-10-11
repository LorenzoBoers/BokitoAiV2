"""One-off: attach run tool trail onto the open reply-suggestion card."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.agent import AgentRun, RunEvent
from app.models.signal import SignalMessage
from app.tools.registry import tool_presentation

SIGNAL = UUID("088d8126-4509-4c90-b8cf-394b5992db6b")


def activity_from_run_events(events: list[RunEvent]) -> list[dict]:
    """Rebuild a lean trail from persisted tool_call RunEvents."""
    items: list[dict] = []
    for index, event in enumerate(events):
        if event.event_type != "tool_call":
            continue
        payload = json.loads(event.payload_json or "{}")
        if not isinstance(payload, dict):
            payload = {}
        name = (event.message or "").strip()
        shown = tool_presentation(name) if name else {"label": name or "tool", "provider": ""}
        # Historical failures: models passed an email where a UUID was required.
        status = "ok"
        err = None
        if name == "get_contact":
            cid = str(payload.get("contact_id") or payload.get("id") or "")
            if "@" in cid:
                err = "Contact not found"
                status = "error"
        elif name == "record_thread_read":
            sid = str(payload.get("signal_id") or "")
            if sid and "@" in sid:
                # Old handler raised on invalid UUID; now falls back to the thread.
                err = "Invalid signal_id"
                status = "error"
        items.append(
            {
                "id": f"backfill-{index}",
                "kind": "work",
                "label": shown["label"],
                "tool": name,
                "provider": shown.get("provider") or "",
                "status": status,
                "input": payload,
                **({"result": {"error": err}} if err else {}),
            }
        )
    return items


async def main() -> None:
    async with async_session_factory() as session:
        card = (
            await session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == SIGNAL,
                    SignalMessage.kind == "decision_request",
                )
                .order_by(SignalMessage.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if card is None:
            print("no decision_request")
            return
        # Clear a previous backfill so this script can be re-run cleanly.
        try:
            meta = json.loads(card.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if isinstance(meta, dict) and meta.get("activity"):
            meta.pop("activity", None)
            card.metadata_json = json.dumps(meta, default=str)
            session.add(card)
            await session.flush()
        print("card", card.id)

        run = (
            await session.execute(
                select(AgentRun)
                .where(AgentRun.signal_id == SIGNAL)
                .order_by(AgentRun.started_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if run is None:
            print("no run")
            return
        print("run", run.id, run.status, run.started_at)

        events = (
            await session.execute(
                select(RunEvent).where(RunEvent.run_id == run.id).order_by(RunEvent.sequence)
            )
        ).scalars().all()
        print("events", [(e.sequence, e.event_type, e.message) for e in events])

        activity = activity_from_run_events(list(events))
        # Drop the suggest_thread_reply call itself from the trail above the card
        # (it is the card); keep earlier research tools.
        activity = [a for a in activity if a.get("tool") != "suggest_thread_reply"]
        print("activity", [(a.get("tool"), a.get("status")) for a in activity])

        try:
            meta = json.loads(card.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        meta["activity"] = activity
        card.metadata_json = json.dumps(meta, default=str)
        session.add(card)
        await session.commit()
        print("attached", len(activity), [(a.get("tool"), a.get("status")) for a in activity])


if __name__ == "__main__":
    asyncio.run(main())
