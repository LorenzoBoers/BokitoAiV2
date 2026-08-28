import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_decision, publish_signal_message
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalMessage
from app.services.audit import record_audit
from app.services.platform_changes import accept_platform_change
from app.tools.policy import set_tool_override


class DecisionActionError(HTTPException):
    """Approving succeeded formally but the underlying action failed.

    The decision is put back to awaiting_human so the operator can retry;
    callers surface the 422 detail (e.g. as a toast).
    """

    def __init__(self, action_type: str, detail: str):
        super().__init__(
            status_code=422,
            detail=detail or f"Approved action '{action_type}' could not be executed",
        )


async def resolve_decision(
    session: AsyncSession,
    tenant_id: UUID,
    decision_id: UUID,
    option_id: str,
    action: str,
    *,
    user_id: UUID | None = None,
    always_auto: bool = False,
    payload_override: dict[str, Any] | None = None,
) -> DecisionRequest:
    result = await session.execute(
        select(DecisionRequest).where(
            DecisionRequest.id == decision_id, DecisionRequest.tenant_id == tenant_id
        )
    )
    decision = result.scalar_one_or_none()
    if not decision:
        raise ValueError("Decision not found")

    options = json.loads(decision.options_json or "[]")
    chosen = next((o for o in options if o.get("id") == option_id), None)

    decision.chosen_option_id = option_id
    decision.status = action
    decision.resolved_at = datetime.utcnow()

    if decision.notification_id:
        notif_result = await session.execute(
            select(Notification).where(Notification.id == decision.notification_id)
        )
        notification = notif_result.scalar_one_or_none()
        if notification:
            notification.status = "read"

    action_type = ""
    if action == "approved" and chosen:
        action_type = chosen.get("action_type", "")
        payload = chosen.get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}
        else:
            payload = dict(payload)
        if payload_override:
            for key, value in payload_override.items():
                if value is not None:
                    payload[key] = value
                    if key == "body":
                        payload.setdefault("body_text", value)
                    if key == "body_text":
                        payload.setdefault("body", value)

        if always_auto and user_id and action_type:
            await set_tool_override(session, tenant_id, action_type, "allow")

        if action_type == "enable_module":
            slug = str(payload.get("module") or "").strip()
            if slug:
                from app.modules.catalog import set_module_enabled

                try:
                    await set_module_enabled(
                        session, tenant_id, slug, True, actor_id=user_id
                    )
                except ValueError:
                    pass

        if action_type == "add_module_source":
            slug = str(payload.get("module") or "").strip()
            url = str(payload.get("url") or "").strip()
            title = str(payload.get("title") or "").strip()
            if slug and url:
                from app.services.module_sources import create_tenant_source
                from app.workers.tasks import enqueue_module_source_index

                try:
                    row = await create_tenant_source(
                        session, tenant_id, slug, title=title or url, url=url
                    )
                    await enqueue_module_source_index(str(row.id))
                except ValueError:
                    pass

        if action_type == "orchestration_continue":
            task_id_raw = payload.get("task_id")
            if task_id_raw:
                from app.services.orchestration.dispatcher import resume_agent_task

                await resume_agent_task(session, tenant_id, UUID(str(task_id_raw)))

        change_id = decision.platform_change_id
        platform_change_id = payload.get("platform_change_id") or chosen.get("platform_change_id")
        if change_id and user_id:
            await accept_platform_change(session, tenant_id, change_id, user_id)
        elif platform_change_id and user_id:
            await accept_platform_change(session, tenant_id, UUID(platform_change_id), user_id)
        elif action_type and action_type not in (
            "reject",
            "defer",
            "draft",
            "escalate",
            "setup_integration",
            "enable_module",
            "add_module_source",
            "accept_platform_change",
            "orchestration_continue",
        ):
            from app.tools import execute_tool

            if decision.signal_id and "signal_id" not in payload:
                payload["signal_id"] = str(decision.signal_id)

            tool_result = await execute_tool(
                session,
                tenant_id,
                user_id,
                action_type,
                payload,
                signal_id=decision.signal_id,
                approved=True,
            )
            failed = isinstance(tool_result, dict) and bool(tool_result.get("error"))
            await record_audit(
                session,
                tenant_id,
                action=f"decision:execute:{action_type}",
                actor_type="user",
                actor_id=str(user_id) if user_id else "",
                resource_type="decision",
                resource_id=str(decision.id),
                outcome="error" if failed else "executed",
                summary=f"Executed approved action {action_type}",
                payload=payload,
                after=tool_result if isinstance(tool_result, dict) else None,
            )
            if failed:
                # The action never happened: reopen the card so the operator
                # can retry, and tell the caller why instead of pretending
                # the reply was sent.
                decision.status = "awaiting_human"
                decision.chosen_option_id = None
                decision.resolved_at = None
                await session.commit()
                raise DecisionActionError(action_type, str(tool_result.get("error")))

    # Resolution is reflected on the decision itself (status + chosen option) and
    # via the `decision_{action}` SignalEvent written by the resolve endpoint; no
    # extra chat message is appended here to keep threads free of noise.

    # Escalate (reject + escalate option, or approved escalate): pause AI and leave a system note.
    escalate_chosen = chosen and (
        chosen.get("id") == "escalate" or chosen.get("action_type") == "escalate"
    )
    if decision.signal_id and escalate_chosen and action in ("approved", "rejected"):
        sig_result = await session.execute(
            select(Signal).where(Signal.id == decision.signal_id, Signal.tenant_id == tenant_id)
        )
        signal = sig_result.scalar_one_or_none()
        if signal:
            signal.ai_paused = True
            signal.updated_at = datetime.utcnow()
            if user_id and not signal.assigned_user_id:
                signal.assigned_user_id = user_id
            from app.models.signal import SignalEvent

            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=tenant_id,
                    event_type="escalated",
                    actor_type="user" if user_id else "system",
                    actor_id=str(user_id) if user_id else "",
                    payload_json=json.dumps(
                        {
                            "decision_id": str(decision.id),
                            "option_id": option_id,
                            "ai_paused": True,
                        }
                    ),
                )
            )
            escalate_msg = SignalMessage(
                signal_id=signal.id,
                tenant_id=tenant_id,
                kind="system_event",
                direction="internal",
                role="system",
                body_text="Escalated to a human. AI suggestions are paused on this thread.",
                body_preview="Escalated to a human",
                metadata_json=json.dumps({"decision_id": str(decision.id)}),
            )
            session.add(escalate_msg)
            signal.last_message_at = datetime.utcnow()
            await session.flush()
            await publish_signal_message(signal, escalate_msg)

    await session.commit()
    await session.refresh(decision)
    await publish_decision(
        tenant_id,
        decision_id=decision.id,
        status=decision.status,
        title=decision.title,
        signal_id=decision.signal_id,
    )
    from app.services.webhooks import decision_event_data, emit_webhook_event

    await emit_webhook_event(
        session, tenant_id, "decision.resolved", decision_event_data(decision)
    )
    return decision
