"""One Ask action: soft yes/no, floor chip, and which session to stream on.

The dashboard sends the text and who was addressed. This module decides
whether that text resolves a decision or starts a turn. Streaming stays a
separate transport call on the session id returned here.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User
from app.models.notification import DecisionRequest
from app.models.signal import Signal, is_internal_channel

_APPROVE_WORDS = frozenset(
    {"ja", "yes", "y", "ok", "okay", "goed", "ja graag", "graag"}
)
_REJECT_WORDS = frozenset(
    {"nee", "no", "n", "cancel", "annuleer", "nee dank", "nee bedankt"}
)


def _norm(text: str) -> str:
    return text.strip().lower().rstrip(".!")


def _is_reject_option(option: dict[str, Any]) -> bool:
    return option.get("id") == "reject" or option.get("action_type") == "reject"


def match_soft_decision_reply(
    text: str,
    options: list[dict[str, Any]],
) -> dict[str, str] | None:
    """Map a short Ask answer onto one classic yes/no card. None for other shapes."""
    normalized = _norm(text)
    if not normalized or not options:
        return None
    reject_opt = next((o for o in options if isinstance(o, dict) and _is_reject_option(o)), None)
    approve_opts = [
        o
        for o in options
        if isinstance(o, dict) and not _is_reject_option(o) and o.get("input_type") != "text"
    ]
    if len(approve_opts) != 1:
        return None
    approve_opt = approve_opts[0]
    approve_label = _norm(str(approve_opt.get("label") or ""))
    reject_label = _norm(str(reject_opt.get("label") or "")) if reject_opt else ""
    if normalized in _APPROVE_WORDS or (approve_label and normalized == approve_label):
        return {"action": "approve", "option_id": str(approve_opt.get("id") or "")}
    if reject_opt and (
        normalized in _REJECT_WORDS or (reject_label and normalized == reject_label)
    ):
        return {"action": "reject", "option_id": str(reject_opt.get("id") or "")}
    return None


def _parse_options(raw: str | None) -> list[dict[str, Any]]:
    try:
        value = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(value, list):
        return []
    return [row for row in value if isinstance(row, dict)]


async def _soft_decision(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    text: str,
) -> dict[str, Any] | None:
    """Resolve the only open binary card. Several matches stay button-only."""
    from app.services.signal_threads import resolve_message_decision

    rows = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.signal_id == signal_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.message_id.is_not(None),
            )
        )
    ).scalars().all()
    hits: list[tuple[DecisionRequest, dict[str, str]]] = []
    for row in rows:
        soft = match_soft_decision_reply(text, _parse_options(row.options_json))
        if soft and soft.get("option_id"):
            hits.append((row, soft))
    if len(hits) != 1:
        return None
    decision, soft = hits[0]
    await resolve_message_decision(
        session,
        tenant_id,
        user_id,
        signal_id,
        decision.message_id,  # type: ignore[arg-type]
        action=soft["action"],
        option_id=soft["option_id"],
    )
    return {
        "kind": "decision",
        "message_id": str(decision.message_id),
        "action": soft["action"],
        "option_id": soft["option_id"],
    }


async def prepare_ask(
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    signal_id: UUID,
    *,
    text: str,
    agent_id: UUID | None = None,
    addressed_agent_ids: list[UUID] | None = None,
    continue_pending: bool = False,
    has_attachments: bool = False,
    is_admin: bool = False,
) -> dict[str, Any]:
    """Decide the Ask. Returns ``decision`` or ``stream`` with a session id."""
    from fastapi import HTTPException

    from app.services.agent_sessions import resolve_session_agent, start_session
    from app.services.participant_turns import request_participant_turn

    signal = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")

    plain = text.strip()
    if not continue_pending and plain and not has_attachments:
        try:
            resolved = await _soft_decision(session, tenant_id, user.id, signal_id, plain)
        except HTTPException:
            resolved = None
        if resolved is not None:
            return resolved

    talks_direct = is_internal_channel(signal.channel) or (signal.channel or "") == "internal"
    addressed = list(dict.fromkeys(addressed_agent_ids or []))
    if talks_direct and agent_id is not None and len(addressed) < 2:
        # Floor chip only. run=true stacked a second worker turn beside the stream.
        await request_participant_turn(
            session,
            signal,
            member_kind="agent",
            member_ref_id=agent_id,
            prompt=plain[:2000],
            requested_by_kind="user",
            requested_by_id=user.id,
            run=False,
        )
        await session.commit()
        return {
            "kind": "stream",
            "session_id": str(signal.id),
            "agent_id": str(agent_id),
            "talks_direct": True,
        }

    if talks_direct:
        return {
            "kind": "stream",
            "session_id": str(signal.id),
            "agent_id": str(agent_id) if agent_id else None,
            "talks_direct": True,
        }

    agent = await resolve_session_agent(
        session, tenant_id, user, signal_id, agent_id, is_admin=is_admin
    )
    started = await start_session(session, tenant_id, user, signal_id, agent)
    return {
        "kind": "stream",
        "session_id": started["id"],
        "agent_id": started.get("agent_id"),
        "talks_direct": False,
        "session": started,
    }
