"""Turn workbench NormalizedEvents into thread messages and SignalEvents."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_signal_message
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.models.workbench import WorkJob
from app.services.workbench import NormalizedEvent
from app.services.workbench.capabilities import PROVIDER_LABELS


async def publish_events(
    session: AsyncSession,
    job: WorkJob,
    events: list[NormalizedEvent],
) -> None:
    if not job.signal_id:
        return
    signal = await session.get(Signal, job.signal_id)
    if signal is None or signal.tenant_id != job.tenant_id:
        return
    for event in events:
        await _publish_one(session, job, signal, event)


async def _publish_one(
    session: AsyncSession,
    job: WorkJob,
    signal: Signal,
    event: NormalizedEvent,
) -> None:
    label = PROVIDER_LABELS.get(job.provider, job.provider)
    now = datetime.utcnow()

    if event.kind == "progress":
        text = event.summary or f"Working in {label}…"
        if job.progress_message_id:
            msg = await session.get(SignalMessage, job.progress_message_id)
            if msg and msg.signal_id == signal.id:
                msg.body_text = text
                msg.body_preview = text[:200]
                msg.metadata_json = json.dumps(
                    {"work_job_id": str(job.id), "provider": job.provider, "kind": "progress"}
                )
                session.add(msg)
                await session.flush()
                await publish_signal_message(signal, msg)
                await _signal_event(session, signal, "workbench_progress", job, event)
                return
        msg = await _add_message(
            session,
            signal,
            kind="status_update",
            text=text,
            metadata={"work_job_id": str(job.id), "provider": job.provider, "kind": "progress"},
        )
        job.progress_message_id = msg.id
        session.add(job)
        await _signal_event(session, signal, "workbench_progress", job, event)
        return

    if event.kind == "started":
        text = event.summary or f"Started in {label}"
        url = (event.payload or {}).get("url")
        if url:
            text = f"{text} — {url}"
        await _add_message(
            session,
            signal,
            kind="status_update",
            text=text,
            metadata={"work_job_id": str(job.id), "provider": job.provider, "kind": "started"},
        )
        await _signal_event(session, signal, "workbench_started", job, event)
        return

    if event.kind == "needs_input":
        await _raise_question(session, job, signal, event)
        await _signal_event(session, signal, "workbench_needs_input", job, event)
        return

    if event.kind == "artifact":
        artifact = (event.payload or {}).get("artifact") or {}
        url = artifact.get("url") or ""
        title = artifact.get("title") or event.summary or "Artifact"
        text = f"{title}" + (f" — {url}" if url else "")
        await _add_message(
            session,
            signal,
            kind="status_update",
            text=text,
            metadata={
                "work_job_id": str(job.id),
                "provider": job.provider,
                "kind": "artifact",
                "artifact": artifact,
            },
        )
        await _signal_event(session, signal, "workbench_artifact", job, event)
        return

    if event.kind == "finished":
        summary = event.summary or f"Finished in {label}"
        cost = f" · {job.cost_cents}¢" if job.cost_cents else ""
        await _add_message(
            session,
            signal,
            kind="task_result",
            text=f"{summary}{cost}",
            metadata={
                "work_job_id": str(job.id),
                "provider": job.provider,
                "kind": "finished",
                "artifacts": json.loads(job.artifacts_json or "[]"),
            },
        )
        await _signal_event(session, signal, "workbench_finished", job, event)
        return

    if event.kind in ("failed", "cancelled"):
        text = event.summary or f"{event.kind.title()} in {label}"
        await _add_message(
            session,
            signal,
            kind="status_update",
            text=text,
            metadata={"work_job_id": str(job.id), "provider": job.provider, "kind": event.kind},
        )
        await _signal_event(session, signal, f"workbench_{event.kind}", job, event)
        return


async def _add_message(
    session: AsyncSession,
    signal: Signal,
    *,
    kind: str,
    text: str,
    metadata: dict[str, Any],
) -> SignalMessage:
    now = datetime.utcnow()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        kind=kind,
        role="assistant",
        direction="outbound",
        body_text=text,
        body_preview=text[:200],
        metadata_json=json.dumps(metadata),
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    session.add(signal)
    await session.flush()
    await publish_signal_message(signal, message)
    return message


async def _signal_event(
    session: AsyncSession,
    signal: Signal,
    event_type: str,
    job: WorkJob,
    event: NormalizedEvent,
) -> None:
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type=event_type,
            actor_type="system",
            actor_id="workbench",
            payload_json=json.dumps(
                {
                    "work_job_id": str(job.id),
                    "provider": job.provider,
                    "kind": event.kind,
                    "summary": event.summary,
                }
            ),
        )
    )


async def _raise_question(
    session: AsyncSession,
    job: WorkJob,
    signal: Signal,
    event: NormalizedEvent,
) -> None:
    from app.models.notification import DecisionRequest
    from app.services.signal_decisions import append_decision_to_signal

    question = event.summary or "The coding tool needs your input."
    options = [
        {"id": "answer", "label": "Send answer", "action_type": "reply"},
        {"id": "stop", "label": "Stop the job", "action_type": "escalate"},
    ]
    decision = DecisionRequest(
        tenant_id=job.tenant_id,
        title=f"Workbench needs input ({PROVIDER_LABELS.get(job.provider, job.provider)})",
        summary=question,
        status="awaiting_human",
        options_json=json.dumps(options),
        project_id=job.project_id,
        signal_id=signal.id,
        source_type="system",
        source_id=f"work_job:{job.id}",
        addressee_kind="user" if job.requested_by_user_id else "",
        addressee_user_id=job.requested_by_user_id,
    )
    session.add(decision)
    await session.flush()
    await append_decision_to_signal(
        session,
        job.tenant_id,
        decision,
        user_id=job.requested_by_user_id,
        agent_id=job.agent_id,
        project_id=job.project_id,
        signal_id=signal.id,
    )
