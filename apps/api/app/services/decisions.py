"""Unified decision serialization for workforce messages API (DecisionRequest-backed)."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import DecisionRequest
from app.services.notifications import resolve_decision


def _status_to_message_status(status: str) -> str:
    if status == "awaiting_human":
        return "awaiting_human"
    if status == "approved":
        return "done"
    if status == "deferred":
        return "deferred"
    if status == "rejected":
        return "rejected"
    return status


def serialize_decision_as_message(row: DecisionRequest) -> dict[str, Any]:
    options = json.loads(row.options_json or "[]")
    payload: dict[str, Any] = {"options": options}
    if row.platform_change_id:
        payload["platform_change_id"] = str(row.platform_change_id)
    for opt in options:
        opt_payload = opt.get("payload")
        if isinstance(opt_payload, dict):
            payload.update({k: v for k, v in opt_payload.items() if k not in payload})
    return {
        "id": str(row.id),
        "thread_id": str(row.conversation_id or row.id),
        "project_id": str(row.project_id) if row.project_id else payload.get("project_id"),
        "subject": row.title,
        "body": row.summary or row.title,
        "message_type": "decision_request",
        "channel": "workforce",
        "status": _status_to_message_status(row.status),
        "payload": payload,
        "created_at": row.created_at.isoformat(),
    }


async def list_decision_messages(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    status: str | None = None,
    message_type: str | None = None,
    channel: str | None = None,
    thread_id: str | None = None,
    project_id: str | None = None,
) -> list[dict[str, Any]]:
    del channel  # decisions are unified; channel filter ignored
    query = select(DecisionRequest).where(DecisionRequest.tenant_id == tenant_id)
    if message_type and message_type != "decision_request":
        return []
    if status:
        if status == "awaiting_human":
            query = query.where(DecisionRequest.status == "awaiting_human")
        elif status == "done":
            query = query.where(DecisionRequest.status == "approved")
        else:
            query = query.where(DecisionRequest.status == status)
    if thread_id:
        try:
            conv_id = UUID(thread_id)
            query = query.where(DecisionRequest.conversation_id == conv_id)
        except ValueError:
            pass
    if project_id:
        try:
            query = query.where(DecisionRequest.project_id == UUID(project_id))
        except ValueError:
            return []
    query = query.order_by(DecisionRequest.created_at.desc()).limit(200)
    result = await session.execute(query)
    return [serialize_decision_as_message(d) for d in result.scalars().all()]


async def resolve_decision_message(
    session: AsyncSession,
    tenant_id: UUID,
    decision_id: UUID,
    *,
    action: str,
    user_id: UUID | None = None,
) -> None:
    result = await session.execute(
        select(DecisionRequest).where(
            DecisionRequest.id == decision_id,
            DecisionRequest.tenant_id == tenant_id,
        )
    )
    decision = result.scalar_one_or_none()
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    options = json.loads(decision.options_json or "[]")
    if action == "approved":
        option_id = next(
            (o.get("id") for o in options if o.get("id") in ("approve", "connect", "always_auto")),
            options[0].get("id") if options else "approve",
        )
        resolved_action = "approved"
    elif action == "rejected":
        option_id = next((o.get("id") for o in options if o.get("id") == "reject"), "reject")
        resolved_action = "rejected"
    else:
        option_id = next((o.get("id") for o in options if o.get("id") == "later"), "later")
        resolved_action = "deferred"

    await resolve_decision(
        session,
        tenant_id,
        decision_id,
        option_id,
        resolved_action,
        user_id=user_id,
    )
