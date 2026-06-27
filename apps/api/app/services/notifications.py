import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_decision, publish_signal_message
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalMessage
from app.services.audit import record_audit
from app.services.platform_changes import accept_platform_change
from app.tools.policy import set_tool_override


async def resolve_decision(
    session: AsyncSession,
    tenant_id: UUID,
    decision_id: UUID,
    option_id: str,
    action: str,
    *,
    user_id: UUID | None = None,
    always_auto: bool = False,
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

    if action == "approved" and chosen:
        action_type = chosen.get("action_type", "")
        payload = chosen.get("payload") or {}
        if always_auto and user_id and action_type:
            await set_tool_override(session, tenant_id, action_type, "allow")

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
            "setup_integration",
            "accept_platform_change",
            "orchestration_continue",
        ):
            from app.tools import execute_tool

            tool_result = await execute_tool(
                session,
                tenant_id,
                user_id,
                action_type,
                payload if isinstance(payload, dict) else {},
                signal_id=decision.signal_id,
                approved=True,
            )
            await record_audit(
                session,
                tenant_id,
                action=f"decision:execute:{action_type}",
                actor_type="user",
                actor_id=str(user_id) if user_id else "",
                resource_type="decision",
                resource_id=str(decision.id),
                outcome="executed" if not tool_result.get("error") else "error",
                summary=f"Executed approved action {action_type}",
                payload=payload,
                after=tool_result if isinstance(tool_result, dict) else None,
            )

        # Continue thread when decision was inline in a signal thread
        if decision.signal_id:
            follow_up = SignalMessage(
                signal_id=decision.signal_id,
                tenant_id=tenant_id,
                kind="agent_message",
                direction="outbound",
                role="assistant",
                body_text=f"Decision resolved: {chosen.get('label', option_id)}. Continuing with the approved action.",
                body_preview=f"Decision resolved: {chosen.get('label', option_id)}"[:200],
                metadata_json=json.dumps({"decision_id": str(decision.id), "option_id": option_id}),
            )
            session.add(follow_up)
            sig_result = await session.execute(
                select(Signal).where(Signal.id == decision.signal_id)
            )
            signal = sig_result.scalar_one_or_none()
            if signal:
                signal.last_message_at = datetime.utcnow()
                signal.updated_at = datetime.utcnow()
                await session.flush()
                await publish_signal_message(signal, follow_up)

    await session.commit()
    await session.refresh(decision)
    await publish_decision(
        tenant_id,
        decision_id=decision.id,
        status=decision.status,
        title=decision.title,
        signal_id=decision.signal_id,
    )
    return decision
