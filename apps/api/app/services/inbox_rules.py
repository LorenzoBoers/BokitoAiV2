"""Self-learning inbox rules (LEARNING layer, applied at SENSING time).

When an operator resolves a "No reply needed" card the choice is recorded
against the sender. After ``PROMOTION_THRESHOLD`` consistent choices the rule
becomes a promotion candidate: under the ``autonomous`` posture it activates
automatically, otherwise the operator confirms it inline ("Always do this")
or from the Automation rules section in Inbox Settings.

Active rules short-circuit ``process_inbound_signal``: matching threads are
closed, given a next task, or left for humans without AI involvement —
always with a SignalEvent + AuditEvent trail so the timeline explains itself.
``tag`` rules only add their tags and leave the normal flow running; tags on
the other actions are added too.
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

RULE_ACTIONS = ("auto_close", "auto_task", "mute_ai", "tag", "route")
# Actions that never short-circuit the inbound flow.
_PASS_THROUGH_ACTIONS = ("tag", "route")

# Decision-card option id -> learned rule action. "keep_open" is deliberately
# absent: keeping a thread open is the default behavior, not an automation.
OPTION_ACTION_MAP = {"close": "auto_close", "create_task": "auto_task", "look_at": "auto_task"}

ACTION_LABELS = {
    "auto_close": "Auto-close",
    "auto_task": "Plan task",
    "mute_ai": "Skip AI",
    "tag": "Add tags",
    "route": "Assign / tag",
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


def normalize_match_value(match_type: str, raw: str) -> str:
    """Canonical match value per type; '' when the value cannot match anything.

    Agents used to hand in values like ``"<news.example.com>"`` for a list id
    or a bare name for a sender; the rule then sat in Inbox settings forever
    without ever matching a message.
    """
    value = (raw or "").strip()
    if match_type == "sender":
        return normalize_address(value)
    if match_type == "domain":
        domain = value.lower().lstrip("@")
        if "@" in domain:
            domain = domain.split("@", 1)[1]
        return domain if "." in domain and " " not in domain else ""
    if match_type == "list_id":
        return normalize_list_id(value)
    return ""


def rule_tags(rule: InboxRule) -> list[str]:
    try:
        labels = json.loads(rule.labels_json or "[]")
    except (json.JSONDecodeError, TypeError):
        return []
    return [label for label in labels if isinstance(label, str)] if isinstance(labels, list) else []


async def _set_rule_tags(
    session: AsyncSession, tenant_id: UUID, rule: InboxRule, tags: list[str], user_id: UUID | None
) -> None:
    from app.services.signal_tags import ensure_tags

    rows = await ensure_tags(session, tenant_id, tags, user_id=user_id)
    rule.labels_json = json.dumps(list(rows))


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
        "channel_account_id": str(rule.channel_account_id) if rule.channel_account_id else None,
        "priority": rule.priority,
        "assign_to_user_id": rule.assign_to_user_id,
        "labels": rule_tags(rule),
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
            InboxRule.deleted_at.is_(None),
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
                InboxRule.action.notin_(_PASS_THROUGH_ACTIONS),
                InboxRule.deleted_at.is_(None),
            )
        )
        rule = result.scalars().first()
        if rule:
            return rule
    return None


async def find_tag_rules(
    session: AsyncSession,
    tenant_id: UUID,
    from_address: str,
    headers: dict | None = None,
) -> list[InboxRule]:
    """Active ``tag`` rules matching the message on any key."""
    keys = sender_keys(from_address, headers)
    if not keys:
        return []
    rules: list[InboxRule] = []
    for match_type, match_value in keys:
        result = await session.execute(
            select(InboxRule).where(
                InboxRule.tenant_id == tenant_id,
                InboxRule.match_type == match_type,
                InboxRule.match_value == match_value,
                InboxRule.status == "active",
                InboxRule.action == "tag",
                InboxRule.deleted_at.is_(None),
            )
        )
        rules.extend(result.scalars().all())
    return rules


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
    value = normalize_match_value(match_type, match_value)
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


ACTIVATE_RULE_ACTION = "activate_inbox_rule"

# Distinct threads from one automated sender before Bokito proposes a rule.
BULK_SENDER_THRESHOLD = 3


def rule_decision_title(rule_payload: dict[str, Any]) -> str:
    action_label = ACTION_LABELS.get(str(rule_payload.get("action")), str(rule_payload.get("action")))
    return f"{action_label} mail from {rule_payload.get('label') or rule_payload.get('match_value')}?"


async def raise_rule_decision(
    session: AsyncSession,
    tenant_id: UUID,
    rule_payload: dict[str, Any],
    *,
    signal_id: UUID | None,
    agent_id: UUID | None = None,
    summary: str = "",
) -> dict[str, Any] | None:
    """Ask inline whether a suggested rule may go live.

    Approving runs ``activate_inbox_rule``; a decline (or dismiss) is a
    decline for a week, so the same sender is not proposed every message.
    Returns the created decision id, or None when the question is already
    on the table or was declined recently.
    """
    from app.services.signal_decisions import (
        create_decision,
        find_open_duplicate_decision,
        recently_declined_decision,
    )

    title = rule_decision_title(rule_payload)
    options = [
        {
            "id": "activate",
            "label": "Yes, always",
            "action_type": ACTIVATE_RULE_ACTION,
            "payload": {"rule_id": rule_payload["id"]},
        },
        {"id": "later", "label": "Not now", "action_type": "defer"},
    ]
    if await recently_declined_decision(session, tenant_id, title=title):
        return None
    if await find_open_duplicate_decision(session, tenant_id, title=title, options=options):
        return None
    if signal_id is not None:
        # Same thread, same question: the newer card replaces the stale one.
        from app.models.notification import DecisionRequest

        stale_rows = (
            await session.execute(
                select(DecisionRequest).where(
                    DecisionRequest.tenant_id == tenant_id,
                    DecisionRequest.signal_id == signal_id,
                    DecisionRequest.status == "awaiting_human",
                    DecisionRequest.title == title,
                )
            )
        ).scalars().all()
        for stale in stale_rows:
            stale.status = "deferred"
            stale.resolved_at = datetime.utcnow()
            stale.chosen_option_id = "superseded"
            session.add(stale)
    decision, _ = await create_decision(
        session,
        tenant_id,
        title=title,
        summary=summary
        or (
            f"{rule_payload.get('observations', 1)} messages from this sender needed no reply. "
            "Approve to handle the next ones automatically; the rule stays editable under "
            "Settings > Email & messages > Automation rules."
        ),
        options=options,
        agent_id=agent_id,
        signal_id=signal_id,
        notification_payload={"rule": rule_payload},
    )
    return {"decision_request_id": str(decision.id), "title": title}


async def maybe_suggest_bulk_sender_rule(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Any,
    *,
    agent_id: UUID | None = None,
    threshold: int = BULK_SENDER_THRESHOLD,
) -> dict[str, Any] | None:
    """After N automated threads from one sender, propose auto-close inline.

    Called when automated mail is acknowledged. Counts distinct email threads
    from the sender in this workspace; at the threshold a *suggested*
    ``auto_close`` rule is written and a decision card lands on the current
    thread. Nothing is activated without a human.
    """
    from sqlalchemy import func

    from app.models.signal import Signal, SignalEvent

    sender = normalize_address(getattr(signal, "contact_email", "") or "")
    if not sender:
        return None
    if await find_matching_rule(session, tenant_id, sender):
        return None
    existing = await _rule_by_key(session, tenant_id, "sender", sender)
    if existing is not None and existing.status in ("active", "paused"):
        return None
    # Threads from this sender that were noted as automated (including the
    # current one); plain conversations with the same address do not count.
    count = (
        await session.execute(
            select(func.count(func.distinct(Signal.id)))
            .select_from(Signal)
            .join(SignalEvent, SignalEvent.signal_id == Signal.id)
            .where(
                Signal.tenant_id == tenant_id,
                Signal.channel == "email",
                Signal.deleted_at.is_(None),
                func.lower(Signal.contact_email) == sender,
                SignalEvent.event_type == "no_reply_noted",
            )
        )
    ).scalar_one()
    if int(count or 0) < threshold:
        return None
    payload = await suggest_rule(
        session,
        tenant_id,
        match_type="sender",
        match_value=sender,
        action="auto_close",
        label=(getattr(signal, "contact_name", "") or sender)[:120],
        source="learned",
        reason=f"{count} automated threads from this sender needed no reply",
        observations=int(count),
    )
    if payload is None:
        return None
    raised = await raise_rule_decision(
        session, tenant_id, payload, signal_id=signal.id, agent_id=agent_id
    )
    return {"rule": payload, "decision": raised}


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
        .where(InboxRule.tenant_id == tenant_id, InboxRule.deleted_at.is_(None))
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
    tags: list[str] | None = None,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    """Manual rule creation (or explicit activation of a learned suggestion)."""
    if match_type not in ("sender", "domain", "list_id"):
        raise ValueError("Invalid match_type")
    if action not in RULE_ACTIONS:
        raise ValueError("Invalid action")
    if action == "tag" and not tags:
        raise ValueError("A tag rule needs at least one tag")
    value = normalize_match_value(match_type, match_value)
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
    if tags is not None:
        await _set_rule_tags(session, tenant_id, rule, tags, user_id)
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
    tags: list[str] | None = None,
    user_id: UUID | None = None,
) -> dict[str, Any] | None:
    result = await session.execute(
        select(InboxRule).where(
            InboxRule.id == rule_id,
            InboxRule.tenant_id == tenant_id,
            InboxRule.deleted_at.is_(None),
        )
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
    if tags is not None:
        await _set_rule_tags(session, tenant_id, rule, tags, user_id)
    if rule.action == "tag" and not rule_tags(rule):
        raise ValueError("A tag rule needs at least one tag")
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
        select(InboxRule).where(
            InboxRule.id == rule_id,
            InboxRule.tenant_id == tenant_id,
            InboxRule.deleted_at.is_(None),
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        return False
    from app.services.trash import load_tenant, move_to_bin

    tenant = await load_tenant(session, tenant_id)
    await move_to_bin(
        session,
        tenant,
        resource_type="inbox_rule",
        row=rule,
        user_id=None,
        title=rule.label or rule.match_value,
        commit=True,
    )
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
        from app.services.ai_handling import on_status_change

        signal.status = "closed"
        signal.has_unread = False
        signal.snoozed_until = None
        on_status_change(session, signal)
        signal.updated_at = now
        session.add(signal)
        result["delivery"] = "auto_closed"
    elif rule.action == "auto_task":
        from datetime import timedelta

        from app.services.orchestration.dispatcher import create_agent_task

        subject = signal.subject or "Automated message"
        assignee = signal.assigned_user_id
        task = await create_agent_task(
            session,
            tenant_id,
            title=f"Follow up: {subject}"[:120],
            signal_id=signal.id,
            kind="task",
            origin="conversation",
            assignee_kind="human",
            assignee_user_id=assignee,
            scheduled_for=datetime.utcnow() + timedelta(hours=4),
            auto_start=False,
        )
        result["task_id"] = str(task.id)
        result["delivery"] = "task_created"
    else:  # mute_ai: leave the thread for humans, spend no tokens.
        result["delivery"] = "ai_skipped"
    added = await _add_rule_tags(session, tenant_id, signal, rule)
    if added:
        result["tags_added"] = added

    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="rule_applied",
            actor_type="system",
            actor_id="",
            payload_json=json.dumps(
                {**payload, "delivery": result["delivery"], "tags_added": added}
            ),
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
    if rule.action in ("auto_close", "auto_task") or added:
        await publish_thread_update(signal)
    if rule.action == "auto_close":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    return result


async def _add_rule_tags(
    session: AsyncSession, tenant_id: UUID, signal: Any, rule: InboxRule
) -> list[str]:
    from app.services.signal_tags import add_signal_tags

    tags = rule_tags(rule)
    if not tags:
        return []
    _, added = await add_signal_tags(session, tenant_id, signal.id, tags, registered_only=True)
    return added


async def apply_tag_rules(
    session: AsyncSession, tenant_id: UUID, signal: Any, rules: list[InboxRule]
) -> list[str]:
    """Add the tags of matching ``tag`` rules; the inbound flow continues as usual."""
    from app.gateway.publish import publish_thread_update
    from app.models.signal import SignalEvent

    added_all: list[str] = []
    for rule in rules:
        added = await _add_rule_tags(session, tenant_id, signal, rule)
        await record_rule_hit(session, rule)
        if not added:
            continue
        added_all.extend(added)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="rule_applied",
                actor_type="system",
                actor_id="",
                payload_json=json.dumps(
                    {**rule_event_payload(rule), "delivery": "tagged", "tags_added": added}
                ),
            )
        )
    if rules:
        await session.commit()
    if added_all:
        await publish_thread_update(signal)
    return added_all
