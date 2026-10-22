"""The customer's answer on work that waits for their approval.

``apply_verdict`` runs when an agent reads a customer reply on a ticket whose
current stage waits on the customer (``waiting_on == "customer"``):

- ``approved``: the ticket moves to the next stage;
- ``changes_requested``: the ticket moves back one stage and the feedback is
  added as a section to the folder doc ``Afspraken``, so it holds next time.

Each verdict is a ``client_verdict`` event; the outcome counts a change
request as a correction on the label scorecard (services/deliveries.py).
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.signal import Signal, SignalEvent

VERDICTS = ("approved", "changes_requested")
AGREEMENTS_TITLE = "Afspraken"


async def _agreements_doc(session: AsyncSession, signal: Signal):
    from app.models.project import Project
    from app.services.workspace import list_docs, upsert_doc

    if signal.project_id is None:
        return None
    docs = await list_docs(session, signal.tenant_id, project_id=signal.project_id)
    found = next((d for d in docs if (d.title or "").strip().lower() == AGREEMENTS_TITLE.lower()), None)
    if found is not None:
        return found
    folder = await session.get(Project, signal.project_id)
    slug = (folder.slug if folder else "") or str(signal.project_id)
    return await upsert_doc(
        session,
        signal.tenant_id,
        path=f"folders/{slug}/afspraken.md",
        content=f"# {AGREEMENTS_TITLE}\n",
        title=AGREEMENTS_TITLE,
        project_id=signal.project_id,
        created_by_type="system",
        commit=False,
    )


async def record_agreement(session: AsyncSession, signal: Signal, feedback: str, *, agent_id: Any = None) -> str | None:
    doc = await _agreements_doc(session, signal)
    if doc is None or not feedback.strip():
        return None
    heading = f"## {utcnow().date().isoformat()} {signal.subject or 'Feedback'}".strip()
    doc.content = (doc.content or "").rstrip() + f"\n\n{heading}\n\n{feedback.strip()}\n"
    doc.updated_at = utcnow()
    session.add(doc)
    return str(doc.id)


async def apply_verdict(
    session: AsyncSession,
    signal: Signal,
    verdict: str,
    *,
    feedback: str = "",
    actor_type: str = "agent",
    actor_id: str = "",
) -> dict[str, Any]:
    from app.models.orchestra import Workstream
    from app.models.signal import SignalTag
    from app.services.tickets import move_ticket_stage, workstream_stages

    if verdict not in VERDICTS:
        return {"applied": False, "reason": f"verdict is one of {', '.join(VERDICTS)}"}
    if signal.ticket_tag_id is None:
        return {"applied": False, "reason": "This conversation is not a ticket."}
    tag = await session.get(SignalTag, signal.ticket_tag_id)
    ws = await session.get(Workstream, tag.workstream_id) if tag and tag.workstream_id else None
    stages = workstream_stages(ws)
    index = next((i for i, s in enumerate(stages) if s["key"] == signal.stage_key), None)
    if index is None or stages[index].get("waiting_on") != "customer":
        return {"applied": False, "reason": "The current stage does not wait on the customer."}
    step = 1 if verdict == "approved" else -1
    target_index = index + step
    if not 0 <= target_index < len(stages):
        return {"applied": False, "reason": "There is no stage to move to."}
    current, target = stages[index], stages[target_index]
    try:
        await move_ticket_stage(session, signal, stage_key=target["key"], actor_type=actor_type, actor_id=actor_id, ws=ws)
    except HTTPException as exc:
        return {"applied": False, "reason": str(exc.detail)}
    doc_id = await record_agreement(session, signal, feedback) if verdict == "changes_requested" else None
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="client_verdict",
            actor_type=actor_type,
            actor_id=actor_id,
            payload_json=json.dumps(
                {
                    "verdict": verdict,
                    "from_stage": current["key"],
                    "to_stage": target["key"],
                    "feedback": feedback[:500],
                    "agreements_doc_id": doc_id,
                }
            ),
        )
    )
    await session.flush()
    return {"applied": True, "verdict": verdict, "stage": target["key"], "agreements_doc_id": doc_id}
