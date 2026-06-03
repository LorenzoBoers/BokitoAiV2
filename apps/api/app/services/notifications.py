import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import Conversation, ConversationMessage
from app.models.email import EmailMessage
from app.models.notification import DecisionRequest, Notification
from app.services.policy import add_whitelist_entry


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
            await add_whitelist_entry(session, tenant_id, action_type, payload, user_id)
        if action_type == "send_email" and decision.source_id:
            email_result = await session.execute(
                select(EmailMessage).where(EmailMessage.id == UUID(decision.source_id))
            )
            email = email_result.scalar_one_or_none()
            if email:
                email.processed_by_agent = True

        # Continue thread when decision was inline in chat
        if decision.conversation_id:
            follow_up = ConversationMessage(
                conversation_id=decision.conversation_id,
                tenant_id=tenant_id,
                role="assistant",
                content=f"Decision resolved: {chosen.get('label', option_id)}. Continuing with the approved action.",
                metadata_json=json.dumps({"decision_id": str(decision.id), "option_id": option_id}),
            )
            session.add(follow_up)
            conv_result = await session.execute(
                select(Conversation).where(Conversation.id == decision.conversation_id)
            )
            conv = conv_result.scalar_one_or_none()
            if conv:
                conv.last_message_at = datetime.utcnow()
                conv.updated_at = datetime.utcnow()

    await session.commit()
    await session.refresh(decision)
    return decision
