"""Self-learning inbox rules (LEARNING layer, applied at SENSING time).

When an operator resolves a "No reply needed" card the choice is recorded
against the sender. After ``PROMOTION_THRESHOLD`` consistent choices the rule
becomes a promotion candidate: under the ``autonomous`` posture it activates
automatically, otherwise the operator confirms it inline ("Always do this")
or from the Automation rules section in Inbox Settings.

Active rules short-circuit ``process_inbound_signal``: matching threads are
closed, converted to a task, or left for humans without AI involvement —
always with a SignalEvent + AuditEvent trail so the timeline explains itself.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import InboxRule
from app.services.audit import record_audit

# Consistent operator choices required before a suggested rule may activate.
PROMOTION_THRESHOLD = 3

RULE_ACTIONS = ("auto_close", "auto_task", "mute_ai")

# Decision-card option id -> learned rule action. "keep_open" is deliberately
# absent: keeping a thread open is the default behavior, not an automation.
OPTION_ACTION_MAP = {"close": "auto_close", "create_task": "auto_task"}

ACTION_LABELS = {
    "auto_close": "Auto-close",
    "auto_task": "Create task",
    "mute_ai": "Skip AI",
}

_LIST_ID_RE = re.compile(r"<([^>]+)>")


def normalize_address(address: str) -> str:
    addr = (address or "").strip().lower()
    return addr if "@" in addr else ""


def address_domain(address: str) -> str:
    addr = normalize_address(address)
    return addr.split("@", 1)[1] if addr else ""


def normalize_list_id(raw: str) -> str:
    """Extract the canonical list id from an RFC 2919 ``List-Id`` header."""
    value = (raw or "").strip()
    if not value:
        return ""
    match = _LIST_ID_RE.search(value)
    return (match.group(1) if match else value).strip().lower()


def sender_keys(from_address: str, headers: dict | None = None) -> list[tuple[str, str]]:
    """Match keys for a message, most specific first: sender, list_id, domain."""
    keys: list[tuple[str, str]] = []
    sender = normalize_address(from_address)
    if sender:
        keys.append(("sender", sender))
    hdrs = {str(k).lower(): str(v or "") for k, v in (headers or {}).items()}
    list_id = normalize_list_id(hdrs.get("list-id", ""))
    if list_id:
        keys.append(("list_id", list_id))
    domain = address_domain(from_address)
    if domain:
        keys.append(("domain", domain))
    return keys


def serialize_rule(rule: InboxRule) -> dict[str, Any]:
    return {
        "id": str(rule.id),
        "match_type": rule.match_type,
        "match_value": rule.match_value,
        "label": rule.label,
        "action": rule.action,
        "action_label": ACTION_LABELS.get(rule.action, rule.action),
        "status": rule.status,
        "source": rule.source,
        "observations": rule.observations,
        "promotion_threshold": PROMOTION_THRESHOLD,
        "hit_count": rule.hit_count,
        "last_hit_at": rule.last_hit_at.isoformat() if rule.last_hit_at else None,
        "created_at": rule.created_at.isoformat(),
        "updated_at": rule.updated_at.isoformat(),
    }


async def _rule_by_key(
    session: AsyncSession, tenant_id: UUID, match_type: str, match_value: str
) -> InboxRule | None:
    result = await session.execute(
        select(InboxRule).where(
            InboxRule.tenant_id == tenant_id,
            InboxRule.match_type == match_type,
            InboxRule.match_value == match_value,
        )
    )
    return result.scalars().first()


async def find_matching_rule(
    session: AsyncSession,
    tenant_id: UUID,
    from_address: str,
    headers: dict | None = None,
) -> InboxRule | None:
    """First active rule matching the message, most specific key wins."""
    keys = sender_keys(from_address, headers)
    if not keys:
        return None
    for match_type, match_value in keys:
        result = await session.execute(
            select(InboxRule).where(
                InboxRule.tenant_id == tenant_id,
                InboxRule.match_type == match_type,
                InboxRule.match_value == match_value,
                InboxRule.status == "active",
            )
        )
        rule = result.scalars().first()
        if rule:
            return rule
    return None


async def record_rule_hit(session: AsyncSession, rule: InboxRule) -> None:
    rule.hit_count += 1
    rule.last_hit_at = datetime.utcnow()
    rule.updated_at = datetime.utcnow()
    session.add(rule)


async def record_outcome(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    from_address: str,
    headers: dict | None = None,
    option_id: str,
    sender_label: str = "",
    user_id: UUID | None = None,
    auto_promote: bool = False,
) -> dict[str, Any] | None:
    """Count an operator choice on a "No reply needed" card towards a rule.

    Returns a ``rule_suggestion`` payload for the UI (or ``None`` when the
    choice teaches nothing: keep_open, unknown sender, or already automated).
    Under ``auto_promote`` (autonomous posture) the rule activates itself
    once the threshold is reached.
    """
    action = OPTION_ACTION_MAP.get(option_id or "")
    sender = normalize_address(from_address)
    if not action or not sender:
        return None

    # Already automated at any level (sender/list/domain): nothing to learn.
    active = await find_matching_rule(session, tenant_id, from_address, headers)
    if active:
        return None

    rule = await _rule_by_key(session, tenant_id, "sender", sender)
    if rule is None:
        rule = InboxRule(
            tenant_id=tenant_id,
            match_type="sender",
            match_value=sender,
            label=(sender_label or sender)[:120],
            action=action,
            status="suggested",
            source="learned",
            observations=1,
            created_by_user_id=user_id,
        )
        session.add(rule)
        await session.flush()
    elif rule.status == "paused":
        # An explicitly paused rule stays paused; do not re-suggest it.
        return None
    elif rule.action == action:
        rule.observations += 1
        rule.updated_at = datetime.utcnow()
        session.add(rule)
    else:
        # Inconsistent choice: restart learning towards the new action.
        rule.action = action
        rule.observations = 1
        rule.updated_at = datetime.utcnow()
        session.add(rule)

    promoted = False
    if rule.observations >= PROMOTION_THRESHOLD and auto_promote:
        await activate_rule_row(session, tenant_id, rule, actor_type="system", user_id=None)
        promoted = True

    payload = serialize_rule(rule)
    payload["ready_to_activate"] = (
        rule.status == "suggested" and rule.observations >= PROMOTION_THRESHOLD
    )
    payload["auto_promoted"] = promoted
    return payload


async def suggest_rule(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    match_type: str,
    match_value: str,
    action: str,
    label: str = "",
    source: str = "learned",
    reason: str = "",
    observations: int = 1,
) -> dict[str, Any] | None:
    """Create or reinforce a *suggested* rule without activating it.

    Used by the correction-chat agent tool and the feedback clustering in the
    learning cycle: the rule shows up in Inbox settings (and inline cards)
    where a human activates it. Paused rules are respected; already-active
    rules teach nothing. Returns the serialized rule or None when skipped.
    """
    if match_type not in ("sender", "domain", "list_id") or action not in RULE_ACTIONS:
        return None
    value = (
        normalize_address(match_value)
        if match_type == "sender"
        else (match_value or "").strip().lower()
    )
    if not value:
        return None

    rule = await _rule_by_key(session, tenant_id, match_type, value)
    if rule is None:
        rule = InboxRule(
            tenant_id=tenant_id,
            match_type=match_type,
            match_value=value,
            label=(label or value)[:120],
            action=action,
            status="suggested",
            source=source,
            observations=max(1, observations),
        )
        session.add(rule)
        await session.flush()
    elif rule.status in ("active", "paused"):
        return None
    elif rule.action == action:
        rule.observations = max(rule.observations + 1, observations)
        rule.updated_at = datetime.utcnow()
        session.add(rule)
    else:
        rule.action = action
        rule.observations = max(1, observations)
        rule.updated_at = datetime.utcnow()
        session.add(rule)

    await record_audit(
        session,
        tenant_id,
        action="inbox_rule:suggest",
        actor_type="system" if source != "agent" else "agent",
        resource_type="inbox_rule",
        resource_id=str(rule.id),
        outcome="proposed",
        summary=(
            f"Suggested {ACTION_LABELS.get(action, action)} for {match_type} {value}"
            + (f" — {reason[:160]}" if reason else "")
        ),
        payload={"observations": rule.observations, "source": source, "reason": reason[:500]},
        commit=False,
    )
    payload = serialize_rule(rule)
    payload["ready_to_activate"] = rule.observations >= PROMOTION_THRESHOLD
    return payload


async def activate_rule_row(
    session: AsyncSession,
    tenant_id: UUID,
    rule: InboxRule,
    *,
    actor_type: str = "user",
    user_id: UUID | None = None,
) -> InboxRule:
    rule.status = "active"
    rule.updated_at = datetime.utcnow()
    session.add(rule)
    await record_audit(
        session,
        tenant_id,
        action="inbox_rule:activate",
        actor_type=actor_type,
        actor_id=str(user_id) if user_id else "",
        resource_type="inbox_rule",
        resource_id=str(rule.id),
        outcome="executed",
        summary=(
            f"{ACTION_LABELS.get(rule.action, rule.action)} for "
            f"{rule.match_type} {rule.match_value}"
        ),
        payload={"observations": rule.observations, "source": rule.source},
        commit=False,
    )
    return rule


async def list_rules(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(InboxRule)
        .where(InboxRule.tenant_id == tenant_id)
        .order_by(InboxRule.status, InboxRule.updated_at.desc())
        .limit(500)
    )
    return [serialize_rule(r) for r in result.scalars().all()]


async def create_rule(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    match_type: str,
    match_value: str,
    action: str,
    label: str = "",
    user_id: UUID | None = None,
) -> dict[str, Any]:
    """Manual rule creation (or explicit activation of a learned suggestion)."""
    if match_type not in ("sender", "domain", "list_id"):
        raise ValueError("Invalid match_type")
    if action not in RULE_ACTIONS:
        raise ValueError("Invalid action")
    value = (
        normalize_address(match_value)
        if match_type == "sender"
        else (match_value or "").strip().lower()
    )
    if not value:
        raise ValueError("match_value required")

    rule = await _rule_by_key(session, tenant_id, match_type, value)
    if rule is None:
        rule = InboxRule(
            tenant_id=tenant_id,
            match_type=match_type,
            match_value=value,
            label=(label or value)[:120],
            action=action,
            status="suggested",
            source="manual",
            created_by_user_id=user_id,
        )
        session.add(rule)
        await session.flush()
    else:
        rule.action = action
        if label:
            rule.label = label[:120]
    await activate_rule_row(session, tenant_id, rule, actor_type="user", user_id=user_id)
    await session.commit()
    await session.refresh(rule)
    return serialize_rule(rule)


async def update_rule(
    session: AsyncSession,
    tenant_id: UUID,
    rule_id: UUID,
    *,
    action: str | None = None,
    status: str | None = None,
    label: str | None = None,
    user_id: UUID | None = None,
) -> dict[str, Any] | None:
    result = await session.execute(
        select(InboxRule).where(InboxRule.id == rule_id, InboxRule.tenant_id == tenant_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        return None
    if action is not None:
        if action not in RULE_ACTIONS:
            raise ValueError("Invalid action")
        rule.action = action
    if label is not None:
        rule.label = label[:120]
    if status is not None:
        if status not in ("active", "paused"):
            raise ValueError("Invalid status")
        if status == "active" and rule.status != "active":
            await activate_rule_row(session, tenant_id, rule, actor_type="user", user_id=user_id)
        else:
            rule.status = status
    rule.updated_at = datetime.utcnow()
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return serialize_rule(rule)


async def delete_rule(session: AsyncSession, tenant_id: UUID, rule_id: UUID) -> bool:
    result = await session.execute(
        select(InboxRule).where(InboxRule.id == rule_id, InboxRule.tenant_id == tenant_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        return False
    await session.delete(rule)
    await session.commit()
    return True


def rule_event_payload(rule: InboxRule) -> dict[str, Any]:
    """Compact payload for SignalEvents written when a rule handles a thread."""
    return {
        "rule_id": str(rule.id),
        "action": rule.action,
        "match_type": rule.match_type,
        "match_value": rule.match_value,
        "label": rule.label,
    }


async def apply_rule_to_signal(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Any,
    message: Any,
    rule: InboxRule,
) -> dict[str, Any]:
    """Execute an active rule on a fresh inbound thread (instead of the AI loop).

    Every application leaves a ``rule_applied`` SignalEvent (rendered as a
    timeline divider) and an AuditEvent, and bumps the rule's hit counters.
    """
    from app.gateway.publish import publish_thread_update
    from app.models.signal import SignalEvent

    now = datetime.utcnow()
    payload = rule_event_payload(rule)
    result: dict[str, Any] = {"rule_applied": True, **payload}

    if rule.action == "auto_close":
        signal.status = "closed"
        signal.has_unread = False
        signal.snoozed_until = None
        signal.updated_at = now
        session.add(signal)
        result["delivery"] = "auto_closed"
    elif rule.action == "auto_task":
        from app.services.orchestration.dispatcher import create_agent_task

        subject = signal.subject or "Automated message"
        preview = (message.body_preview or message.body_text or "").strip()[:500]
        task = await create_agent_task(
            session,
            tenant_id,
            title=f"Follow up: {subject}"[:120],
            description=preview,
            signal_id=signal.id,
            trigger_type="inbox_rule",
            trigger_id=str(rule.id),
            auto_start=False,
        )
        result["task_id"] = str(task.id)
        result["delivery"] = "task_created"
    else:  # mute_ai: leave the thread for humans, spend no tokens.
        result["delivery"] = "ai_skipped"

    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="rule_applied",
            actor_type="system",
            actor_id="",
            payload_json=json.dumps({**payload, "delivery": result["delivery"]}),
        )
    )
    await record_rule_hit(session, rule)
    await record_audit(
        session,
        tenant_id,
        action=f"inbox_rule:apply:{rule.action}",
        actor_type="system",
        resource_type="signal",
        resource_id=str(signal.id),
        outcome="executed",
        summary=(
            f"{ACTION_LABELS.get(rule.action, rule.action)} applied to "
            f"'{signal.subject or '(no subject)'}' ({rule.match_type} {rule.match_value})"
        ),
        payload=payload,
        commit=False,
    )
    await session.commit()
    if rule.action in ("auto_close", "auto_task"):
        await publish_thread_update(signal)
    if rule.action == "auto_close":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    return result
