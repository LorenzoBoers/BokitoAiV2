import json
import logging
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import AppError
from app.core.time import utcnow
from app.gateway.publish import publish_decision, publish_signal_message
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalMessage
from app.services.audit import record_audit
from app.services.platform_changes import accept_platform_change

logger = logging.getLogger(__name__)


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


def _payload_fingerprint(action_type: str, payload: dict[str, Any]) -> str:
    """Stable key so two delete_tag asks for the same tag match."""
    bits = [action_type]
    for key in ("id", "name", "tag", "tag_id", "tag_name"):
        val = payload.get(key)
        if val is not None and str(val).strip():
            bits.append(f"{key}:{str(val).strip().lstrip('#').lower()}")
    return "|".join(bits)


async def _defer_duplicate_action_asks(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    action_type: str,
    payload: dict[str, Any],
    except_decision_id: UUID,
) -> None:
    """After Ja runs a tool, close leftover open asks for the same action."""
    fingerprint = _payload_fingerprint(action_type, payload)
    if fingerprint == action_type:
        return
    rows = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.signal_id == signal_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.id != except_decision_id,
            )
        )
    ).scalars().all()
    now = utcnow()
    for row in rows:
        try:
            options = json.loads(row.options_json or "[]")
        except json.JSONDecodeError:
            options = []
        for opt in options:
            if not isinstance(opt, dict):
                continue
            if str(opt.get("action_type") or "") != action_type:
                continue
            other = opt.get("payload") if isinstance(opt.get("payload"), dict) else {}
            if _payload_fingerprint(action_type, other) != fingerprint:
                continue
            row.status = "deferred"
            row.chosen_option_id = "superseded"
            row.resolved_at = now
            session.add(row)
            break


async def _count_rule_verdict(
    session: AsyncSession, tenant_id: UUID, options: list[dict[str, Any]], action: str
) -> None:
    """A card a rule asked for counts as approved or rejected on that rule."""
    learn = next(
        (o["learn"] for o in options if isinstance(o, dict) and isinstance(o.get("learn"), dict)), None
    )
    reason = str((learn or {}).get("reason") or "")
    if not reason.startswith("rule:") or action not in ("approved", "rejected"):
        return
    from app.models.agent import Agent
    from app.models.auth import Tenant
    from app.services.agent_rules import record_outcome

    tenant = await session.get(Tenant, tenant_id)
    try:
        agent = await session.get(Agent, UUID(str(learn.get("agent_id") or "")))
    except ValueError:
        agent = None
    if tenant is not None and record_outcome(tenant, agent, reason[5:], action):
        session.add(tenant)
        if agent is not None:
            session.add(agent)


async def resolve_decision(
    session: AsyncSession,
    tenant_id: UUID,
    decision_id: UUID,
    option_id: str,
    action: str,
    *,
    user_id: UUID | None = None,
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
    decision.resolved_at = utcnow()
    decision.resolved_by_user_id = user_id
    await _count_rule_verdict(session, tenant_id, options, action)
    from app.services.auto_review import record_agreement

    await record_agreement(session, decision, action, user_id=user_id)
    from app.services.ticket_work import record_proposal_outcome

    await record_proposal_outcome(session, decision, action, user_id=user_id)

    if action == "rejected" and decision.platform_change_id and user_id:
        from app.services.platform_changes import reject_platform_change

        try:
            await reject_platform_change(
                session, tenant_id, decision.platform_change_id, user_id, commit=False
            )
        except (HTTPException, AppError):
            logger.warning("reject platform change on decision failed", exc_info=True)
            pass

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

        if payload.get("session_checkout"):
            # Inline agent session checkout: end the session, or send it back
            # to work. The card is the only place a session can be closed
            # from the agent side.
            from app.services.agent_sessions import apply_checkout_choice

            await apply_checkout_choice(session, tenant_id, payload, user_id=user_id)

        from app.services.decision_actions import run_decision_action

        settled = await run_decision_action(
            session, tenant_id, decision, action_type, payload, user_id=user_id
        )

        change_id = decision.platform_change_id
        platform_change_id = payload.get("platform_change_id") or chosen.get("platform_change_id")
        if change_id and user_id:
            await accept_platform_change(session, tenant_id, change_id, user_id)
        elif platform_change_id and user_id:
            await accept_platform_change(session, tenant_id, UUID(platform_change_id), user_id)
        elif action_type and not settled:
            from app.tools import execute_tool
            from app.tools.registry import get_tool_spec

            # Soft choices omit action_type. Invented labels like "remove_tag"
            # used to resolve as success while nothing ran — reopen with error.
            if get_tool_spec(action_type) is None:
                decision.status = "awaiting_human"
                decision.chosen_option_id = None
                decision.resolved_at = None
                await session.commit()
                raise DecisionActionError(
                    action_type,
                    (
                        f"Unknown action '{action_type}'. The agent must propose a "
                        "real platform tool (e.g. delete_tag) so Approve can run it."
                    ),
                )

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
                actor_type="user" if user_id else "system",
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
            if decision.signal_id:
                await _defer_duplicate_action_asks(
                    session,
                    tenant_id,
                    decision.signal_id,
                    action_type=action_type,
                    payload=payload if isinstance(payload, dict) else {},
                    except_decision_id=decision.id,
                )

    # Resolution is reflected on the decision itself (status + chosen option) and
    # via the `decision_{action}` SignalEvent written by the resolve endpoint; no
    # extra chat message is appended here to keep threads free of noise.

    # Escalate / human-owned choice: pause AI and leave a system note.
    escalate_chosen = chosen and (
        chosen.get("id") == "escalate"
        or chosen.get("action_type")
        in ("escalate", "acknowledge", "human_takeover", "assign_me", "take_over")
    )
    if decision.signal_id and escalate_chosen and action in ("approved", "rejected"):
        sig_result = await session.execute(
            select(Signal).where(Signal.id == decision.signal_id, Signal.tenant_id == tenant_id)
        )
        signal = sig_result.scalar_one_or_none()
        if signal:
            from app.models.signal import SignalEvent
            from app.services.ai_handling import REASON_ESCALATED
            from app.services.handover import escalate_to_human

            # The person who chose to escalate takes it; otherwise the agent's
            # escalation chain picks the owner.
            target = {"kind": "user", "id": str(user_id)} if user_id and signal.assignee_kind != "user" else None
            await escalate_to_human(
                session,
                signal,
                via="decision_escalate",
                actor_type="user" if user_id else "system",
                actor_id=str(user_id) if user_id else "",
                to=target,
                hold_reason=REASON_ESCALATED,
            )

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
                            "ai_handling": "manual",
                        }
                    ),
                )
            )
            from app.models.auth import Tenant
            from app.services.language import resolve_workspace_language

            tenant = (
                await session.execute(select(Tenant).where(Tenant.id == tenant_id))
            ).scalar_one_or_none()
            locale = resolve_workspace_language(tenant)
            if locale == "nl":
                body_text = (
                    "Doorgestuurd naar een medewerker. "
                    "AI-suggesties zijn gepauzeerd op dit gesprek."
                )
                body_preview = "Doorgestuurd naar een medewerker"
            else:
                body_text = (
                    "Escalated to a human. AI suggestions are paused on this thread."
                )
                body_preview = "Escalated to a human"
            escalate_msg = SignalMessage(
                signal_id=signal.id,
                tenant_id=tenant_id,
                kind="system_event",
                direction="internal",
                role="system",
                body_text=body_text,
                body_preview=body_preview,
                metadata_json=json.dumps({"decision_id": str(decision.id)}),
            )
            session.add(escalate_msg)
            signal.last_message_at = utcnow()
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
    if user_id is not None and action in ("approved", "rejected"):
        from app.services.routing_learning import learn_from_answer

        await learn_from_answer(session, decision)
    return decision
