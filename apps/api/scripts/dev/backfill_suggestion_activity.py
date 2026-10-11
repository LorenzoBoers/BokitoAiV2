"""One-off: attach run tool trail onto a reply-suggestion decision card.

Usage (on VPS):
  cd /opt/bokito-dev/apps/api && set -a && . ./.env && set +a \\
    && ./.venv/bin/python scripts/dev/backfill_suggestion_activity.py \\
       --signal-id 088d8126-4509-4c90-b8cf-394b5992db6b
"""

from __future__ import annotations

import argparse
import asyncio
import json
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.agent import AgentRun, RunEvent
from app.models.signal import SignalMessage
from app.services.agent.turn_persist import attach_activity_to_message
from app.tools.registry import tool_presentation


def _activity_from_run_events(events: list[RunEvent]) -> list[dict]:
    items: list[dict] = []
    open_by_name: dict[str, dict] = {}
    for index, event in enumerate(events):
        try:
            payload = json.loads(event.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        name = (event.message or "").strip() or str(payload.get("name") or "")
        if event.event_type == "tool_call":
            shown = tool_presentation(name)
            item = {
                "id": f"backfill-{event.id}",
                "kind": "work",
                "label": shown["label"],
                "tool": name,
                "provider": shown["provider"],
                "status": "ok",
                "input": payload.get("input") if "input" in payload else payload,
            }
            items.append(item)
            if name:
                open_by_name[name] = item
        elif event.event_type == "tool_result" and name in open_by_name:
            item = open_by_name.pop(name)
            result = payload.get("result") if "result" in payload else payload
            item["result"] = result
            if isinstance(result, dict) and result.get("error"):
                item["status"] = "error"
        elif event.event_type in ("thinking", "think") and str(payload.get("text") or "").strip():
            items.append(
                {
                    "id": f"backfill-think-{index}",
                    "kind": "think",
                    "label": "",
                    "status": "ok",
                    "text": str(payload.get("text") or "")[:2000],
                    "duration_ms": int(payload.get("ms") or 0),
                }
            )
    return items


async def backfill(signal_id: UUID, *, dry_run: bool) -> None:
    async with async_session_factory() as session:
        card = (
            await session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == signal_id,
                    SignalMessage.kind == "decision_request",
                )
                .order_by(SignalMessage.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if card is None:
            print("no decision_request on signal")
            return
        meta = json.loads(card.metadata_json or "{}")
        existing = meta.get("activity") if isinstance(meta, dict) else None
        print("card", card.id, "existing_activity", len(existing) if isinstance(existing, list) else 0)

        run = (
            await session.execute(
                select(AgentRun)
                .where(AgentRun.signal_id == signal_id)
                .order_by(AgentRun.started_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if run is None:
            print("no agent run")
            return
        print("run", run.id, run.status)

        events = list(
            (
                await session.execute(
                    select(RunEvent)
                    .where(RunEvent.run_id == run.id)
                    .order_by(RunEvent.sequence, RunEvent.created_at)
                )
            ).scalars().all()
        )
        print("events", [(e.event_type, e.message[:48]) for e in events])

        # Prefer activity already on the run result when present.
        activity: list[dict] = []
        try:
            result = json.loads(run.result_json or "{}")
        except json.JSONDecodeError:
            result = {}
        if isinstance(result, dict):
            if isinstance(result.get("activity"), list) and result["activity"]:
                activity = [a for a in result["activity"] if isinstance(a, dict)]
            elif isinstance(result.get("segments"), list) and result["segments"]:
                from app.services.agent.turn_persist import activity_from_segments

                activity = activity_from_segments(result["segments"])
        if not activity:
            activity = _activity_from_run_events(events)

        print("activity_items", len(activity), [a.get("tool") or a.get("kind") for a in activity])
        if dry_run or not activity:
            return
        if attach_activity_to_message(card, activity):
            session.add(card)
            await session.commit()
            print("attached ok")
        else:
            print("nothing attached")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--signal-id", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(backfill(UUID(args.signal_id), dry_run=args.dry_run))


if __name__ == "__main__":
    main()
