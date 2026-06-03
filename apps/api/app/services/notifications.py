import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email import EmailMessage
from app.models.notification import DecisionRequest, Notification
from app.services.agent.loop import AgentLoop
from app.models.agent import Agent


async def resolve_decision(
    session: AsyncSession,
    tenant_id: UUID,
    decision_id: UUID,
    option_id: str,
    action: str,
) -> DecisionRequest:
    result = await session.execute(
        select(DecisionRequest).where(
            DecisionRequest.id == decision_id, DecisionRequest.tenant_id == tenant_id
        )
    )
    decision = result.scalar_one_or_none()
    if not decision:
        raise ValueError("Decision not found")

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

    # Execute light operational actions on approval
    if action == "approved":
        options = json.loads(decision.options_json or "[]")
        chosen = next((o for o in options if o.get("id") == option_id), None)
        if chosen and chosen.get("action_type") == "send_email" and decision.source_id:
            email_result = await session.execute(
                select(EmailMessage).where(EmailMessage.id == UUID(decision.source_id))
            )
            email = email_result.scalar_one_or_none()
            if email:
                email.processed_by_agent = True

    await session.commit()
    await session.refresh(decision)
    return decision
