"""Wire agent decisions and workforce messages into Signal threads."""

from __future__ import annotations

from app.core.time import utcnow

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_decision, publish_signal_message
from app.services.automated_mail import clip_with_ellipsis
from app.models.agent import Agent
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalEvent, SignalMessage


def decision_provenance(decision: DecisionRequest) -> dict[str, Any] | None:
    """Where this decision came from, for the card and the notification.

    One shape per source so the UI can label it ("Queue item", "Agent run") and
    link to the right surface. Returns None for a plain agent question.
    """
    if decision.platform_change_id:
        return {"type": "platform_change", "id": str(decision.platform_change_id)}
    if decision.agent_task_id:
        return {
            "type": "agent_task",
            "id": str(decision.agent_task_id),
            "project_id": str(decision.project_id) if decision.project_id else None,
        }
    if decision.project_id:
        return {"type": "project", "id": str(decision.project_id)}
    if decision.run_id:
        return {"type": "agent_run", "id": str(decision.run_id)}
    return None


def primary_action(options: list[dict[str, Any]] | None) -> str:
    """The first option that does something (not defer/reject); '' when none."""
    action, _payload = primary_option_key(options)
    return action


def primary_option_key(options: list[dict[str, Any]] | None) -> tuple[str, str]:
    """(action_type, stable payload) of the first executable option; ('','') when none."""
    for option in options or []:
        if not isinstance(option, dict):
            continue
        action = str(option.get("action_type") or "").strip().lower()
        if action and action not in ("defer", "reject", "dismiss", "later"):
            payload = option.get("payload")
            if payload is None:
                payload_key = ""
            else:
                payload_key = json.dumps(payload, sort_keys=True, default=str)
            return action, payload_key
    return "", ""


def options_ack_signature(options: list[dict[str, Any]] | None) -> str:
    """Stable id+label fingerprint for acknowledge cards (Ja/Nee without action_type)."""
    rows: list[tuple[str, str]] = []
    for option in options or []:
        if not isinstance(option, dict):
            continue
        oid = str(option.get("id") or "").strip().lower()
        label = str(option.get("label") or "").strip().lower()
        if oid or label:
            rows.append((oid, label))
    return json.dumps(rows, ensure_ascii=True)


def _options_of(decision: DecisionRequest) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(decision.options_json or "[]")
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


async def find_open_duplicate_decision(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    title: str,
    options: list[dict[str, Any]] | None,
) -> DecisionRequest | None:
    """An awaiting card with the same title and primary action, anywhere in the tenant.

    Used for cards that have no thread of their own (heartbeat and scheduled
    runs). Per-thread duplicates are superseded in the tool instead.
    """
    wanted = primary_action(options)
    ack = options_ack_signature(options) if not wanted else ""
    rows = (
        await session.execute(
            select(DecisionRequest)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.platform_change_id.is_(None),
                DecisionRequest.title == (title or "").strip(),
            )
            .order_by(DecisionRequest.created_at.desc())
        )
    ).scalars().all()
    for row in rows:
        if wanted:
            if primary_action(_options_of(row)) == wanted:
                return row
        elif ack and options_ack_signature(_options_of(row)) == ack:
            return row
    return None


async def find_open_ack_in_bundle(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_id: UUID,
    bundle_id: str,
) -> DecisionRequest | None:
    """Any awaiting acknowledge card (Ja/Nee, no action_type) in this turn.

    Same-bundle title supersede skips siblings, so a model that raises four
    near-identical Ja/Nee asks with different titles (S46/U75) used to stack
    four cards. One open ack in the bundle is enough.
    """
    if not bundle_id.strip():
        return None
    rows = (
        await session.execute(
            select(DecisionRequest)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.signal_id == signal_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.platform_change_id.is_(None),
                DecisionRequest.bundle_id == bundle_id,
            )
            .order_by(DecisionRequest.created_at.asc())
        )
    ).scalars().all()
    for row in rows:
        opts = _options_of(row)
        if primary_option_key(opts)[0]:
            continue
        if options_ack_signature(opts):
            return row
    return None


async def find_open_identical_decision(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    title: str,
    options: list[dict[str, Any]] | None,
    signal_id: UUID | None,
) -> DecisionRequest | None:
    """Awaiting card on this thread with the same title and primary option payload.

    Catches the model calling the same gated tool twice in one turn (same
    ``bundle_id``). Same-bundle cards are not superseded by title alone, so
    without this the thread stacks two identical Approve cards.

    Acknowledge cards (Ja/Nee with no ``action_type``) match on option id+label
    so the agent cannot flood identical asks in one turn.
    """
    if signal_id is None:
        return None
    wanted = primary_option_key(options)
    ack = options_ack_signature(options) if not wanted[0] else ""
    if not wanted[0] and not ack:
        return None
    rows = (
        await session.execute(
            select(DecisionRequest)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.signal_id == signal_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.platform_change_id.is_(None),
                DecisionRequest.title == (title or "").strip(),
            )
            .order_by(DecisionRequest.created_at.desc())
        )
    ).scalars().all()
    for row in rows:
        if wanted[0]:
            if primary_option_key(_options_of(row)) == wanted:
                return row
        elif ack and options_ack_signature(_options_of(row)) == ack:
            return row
    return None


async def recently_declined_decision(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    title: str,
    within_days: int = 7,
) -> DecisionRequest | None:
    """A card with this title a human rejected or deferred in the last N days.

    Proposals (module recommendations, integrations) must not come back the
    next run after someone said no or later.
    """
    from datetime import timedelta

    since = utcnow() - timedelta(days=within_days)
    return (
        await session.execute(
            select(DecisionRequest)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.title == (title or "").strip(),
                DecisionRequest.status.in_(("rejected", "deferred")),
                DecisionRequest.resolved_at.is_not(None),
                DecisionRequest.resolved_at >= since,
                DecisionRequest.chosen_option_id != "superseded",
            )
            .order_by(DecisionRequest.resolved_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


DISMISSED_OPTION_ID = "dismissed"


async def open_decision_groups(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    """Awaiting cards grouped by title: what kind of question is piling up.

    Feeds the bulk dismiss control; one tenant sat on 97 "No reply needed"
    cards and 34 module proposals nobody wanted to click one by one.
    """
    from sqlalchemy import case, func

    rows = (
        await session.execute(
            select(
                DecisionRequest.title,
                func.count(),
                func.sum(case((DecisionRequest.signal_id.is_(None), 1), else_=0)),
                func.max(DecisionRequest.created_at),
            )
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.platform_change_id.is_(None),
            )
            .group_by(DecisionRequest.title)
            .order_by(func.count().desc(), func.max(DecisionRequest.created_at).desc())
        )
    ).all()
    return [
        {
            "title": title,
            "count": int(count or 0),
            "without_thread": int(orphans or 0),
            "latest_at": latest.isoformat() if latest else None,
        }
        for title, count, orphans, latest in rows
    ]


async def dismiss_decisions(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    title: str | None = None,
    without_thread_only: bool = False,
    older_than_days: int | None = None,
    user_id: UUID | None = None,
) -> int:
    """Close every awaiting card that matches, as 'deferred' with option 'dismissed'.

    Nothing runs; a dismissed card counts as a decline for proposal cooldowns
    and the bell stops counting it. Govern (platform change) decisions are
    never touched here.
    """
    from datetime import timedelta

    conditions = [
        DecisionRequest.tenant_id == tenant_id,
        DecisionRequest.status == "awaiting_human",
        DecisionRequest.platform_change_id.is_(None),
    ]
    if title is not None:
        conditions.append(DecisionRequest.title == title.strip())
    if without_thread_only:
        conditions.append(DecisionRequest.signal_id.is_(None))
    if older_than_days is not None:
        conditions.append(
            DecisionRequest.created_at <= utcnow() - timedelta(days=older_than_days)
        )
    rows = (await session.execute(select(DecisionRequest).where(*conditions))).scalars().all()
    if not rows:
        return 0
    now = utcnow()
    notification_ids = [row.notification_id for row in rows if row.notification_id]
    for row in rows:
        row.status = "deferred"
        row.chosen_option_id = DISMISSED_OPTION_ID
        row.resolved_at = now
        row.resolved_by_user_id = user_id
        session.add(row)
    if notification_ids:
        notifs = (
            await session.execute(
                select(Notification).where(
                    Notification.id.in_(notification_ids), Notification.status == "unread"
                )
            )
        ).scalars().all()
        for notif in notifs:
            notif.status = "read"
            session.add(notif)
    await session.commit()
    for row in rows:
        await publish_decision(
            tenant_id,
            decision_id=row.id,
            status=row.status,
            title=row.title,
            signal_id=row.signal_id,
        )
    return len(rows)


async def get_or_create_internal_thread(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    project_id: UUID | None = None,
    subject: str,
    contact_name: str = "Agent",
    agent_id: UUID | None = None,
    assigned_user_id: UUID | None = None,
    existing_signal_id: UUID | None = None,
) -> Signal:
    if existing_signal_id:
        result = await session.execute(
            select(Signal).where(Signal.id == existing_signal_id, Signal.tenant_id == tenant_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            if agent_id and not existing.agent_id:
                existing.agent_id = agent_id
            # Only relabel internal threads; an external thread's contact_name
            # belongs to the customer, never the agent posting a decision.
            if (
                existing.channel == "internal"
                and contact_name
                and contact_name != "Agent"
                and existing.contact_name in ("", "Agent")
            ):
                existing.contact_name = contact_name
            return existing

    signal = Signal(
        tenant_id=tenant_id,
        channel="internal",
        source="workforce",
        subject=subject or "(No subject)",
        contact_name=contact_name,
        agent_id=agent_id,
        status="open",
        priority="normal",
        has_unread=True,
        project_id=project_id,
        assigned_user_id=assigned_user_id,
        last_message_at=utcnow(),
    )
    session.add(signal)
    await session.flush()
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="signal_created",
            actor_type="system",
            payload_json=json.dumps({"source": "internal"}),
        )
    )
    return signal


async def append_decision_to_signal(
    session: AsyncSession,
    tenant_id: UUID,
    decision: DecisionRequest,
    *,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
    project_id: UUID | None = None,
    signal_id: UUID | None = None,
    items: list[dict[str, Any]] | None = None,
    question: str | None = None,
    selection: str | None = None,
) -> SignalMessage:
    agent_name = "Agent"
    if agent_id:
        agent_row = (
            await session.execute(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if agent_row:
            agent_name = agent_row.name
    card_meta: dict[str, Any] = {}
    if items:
        card_meta["proposal_items"] = items
    if question and question.strip():
        card_meta["question"] = question.strip()[:500]
    sel = str(selection or "single").strip().lower()
    if sel in ("single", "multiple"):
        card_meta["selection"] = sel

    signal = await get_or_create_internal_thread(
        session,
        tenant_id,
        project_id=project_id or decision.project_id,
        subject=decision.title,
        contact_name=agent_name,
        agent_id=agent_id,
        assigned_user_id=user_id,
        existing_signal_id=signal_id,
    )
    if agent_id and not signal.agent_id:
        signal.agent_id = agent_id
        if agent_name != "Agent" and signal.channel == "internal":
            signal.contact_name = agent_name
    from app.tools.calendar import humanize_iso_in_text

    body = humanize_iso_in_text(decision.summary or decision.title or "")
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind="decision_request",
        direction="inbound",
        role="assistant",
        author_agent_id=agent_id,
        subject=decision.title,
        body_text=body,
        body_preview=clip_with_ellipsis(body, 200) or (decision.title or "")[:200],
        decision_id=decision.id,
        received_at=utcnow(),
        metadata_json=json.dumps(card_meta, default=str) if card_meta else "{}",
    )
    session.add(message)
    await session.flush()
    decision.message_id = message.id
    decision.signal_id = signal.id
    signal.last_message_at = utcnow()
    signal.has_unread = True
    signal.updated_at = utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="decision_created",
            actor_type="agent" if agent_id else "system",
            actor_id=str(agent_id or ""),
            payload_json=json.dumps({"decision_id": str(decision.id)}),
        )
    )
    await session.flush()
    # Pass the decision so the gateway event carries the full options payload
    # and open threads can render the decision card without a refetch.
    await publish_signal_message(signal, message, decision=decision)
    await publish_decision(
        tenant_id,
        decision_id=decision.id,
        status=decision.status,
        title=decision.title,
        signal_id=signal.id,
    )
    from app.services.webhooks import decision_event_data, emit_webhook_event

    await emit_webhook_event(session, tenant_id, "decision.created", decision_event_data(decision))
    return message


async def append_workforce_message(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    kind: str,
    subject: str,
    body: str,
    project_id: UUID | None = None,
    agent_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> SignalMessage:
    agent_name = "Agent"
    if agent_id:
        agent_row = (
            await session.execute(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if agent_row:
            agent_name = agent_row.name

    signal = await get_or_create_internal_thread(
        session,
        tenant_id,
        project_id=project_id,
        subject=subject,
        contact_name=agent_name,
        agent_id=agent_id,
    )
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind=kind,
        direction="inbound",
        role="assistant",
        author_agent_id=agent_id,
        subject=subject,
        body_text=body,
        body_preview=body[:200],
        received_at=utcnow(),
    )
    session.add(message)
    signal.last_message_at = utcnow()
    signal.has_unread = True
    session.add(signal)
    await session.flush()
    await publish_signal_message(signal, message)
    return message


_PENDING_REVEAL_KEY = "_pending_reveal"


async def create_decision(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    title: str,
    summary: str = "",
    options: list[dict[str, Any]] | None = None,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
    signal_id: UUID | None = None,
    project_id: UUID | None = None,
    platform_change_id: UUID | None = None,
    agent_task_id: UUID | None = None,
    run_id: UUID | None = None,
    source_type: str = "agent",
    source_id: str | None = None,
    notification_payload: dict[str, Any] | None = None,
    notification_title: str | None = None,
    to: dict[str, Any] | None = None,
    items: list[dict[str, Any]] | None = None,
    question: str | None = None,
    selection: str | None = None,
    bundle_id: str = "",
    reveal: bool = True,
    announce: bool = True,
    message_meta: dict[str, Any] | None = None,
) -> tuple[DecisionRequest, SignalMessage | None]:
    """The single write path for human decisions.

    Creates the DecisionRequest addressed to one person or team
    (``services/addressee.py``; ``to`` is an explicit target).
    ``announce=False`` keeps the paired bell row read and unpublished: the
    first read of an inbound message sends its own conversation notice.

    When ``reveal=True`` (default), projects into the notification surface,
    lands the card as a message in a Signal thread, and publishes gateway
    events. When ``reveal=False`` (agent turn mid-tool), only persists the
    DecisionRequest + a pending notification row — ``reveal_decision`` publishes
    after speech bubbles are saved so the client sees text then the card.
    """
    from app.services.addressee import resolve_addressee
    from app.services.notification_mail import decision_bell_status

    existing_signal = (
        await session.execute(select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id))
    ).scalar_one_or_none() if signal_id else None
    addressee = await resolve_addressee(
        session,
        tenant_id,
        agent_id=agent_id,
        signal=existing_signal,
        requested_by=user_id,
        to=to,
    )
    bell_user_id = addressee.user_id if addressee.kind == "user" else None
    bell_status = (
        await decision_bell_status(session, tenant_id, bell_user_id) if announce else "read"
    )
    from app.services.notify import from_agent, from_user

    bell_payload: dict[str, Any] = {**(notification_payload or {})}
    if not announce:
        bell_payload["announce"] = False
    if agent_id and "from" not in bell_payload:
        agent = await session.get(Agent, agent_id)
        mark = from_agent(agent)
        if mark:
            bell_payload["from"] = mark
    elif user_id and "from" not in bell_payload:
        from app.models.auth import User

        asker = await session.get(User, user_id)
        mark = from_user(asker)
        if mark:
            bell_payload["from"] = mark
    pending_reveal = {
        "items": items or [],
        "question": question,
        "selection": selection,
        "user_id": str(user_id) if user_id else None,
        "agent_id": str(agent_id) if agent_id else None,
        "project_id": str(project_id) if project_id else None,
        "bell_status": bell_status,
        "notification_payload": bell_payload,
        "message_meta": message_meta or {},
    }
    # Pending rows stay out of unread / push until reveal_decision flips them.
    notification = Notification(
        tenant_id=tenant_id,
        user_id=bell_user_id,
        signal_id=signal_id,
        tier=1,
        kind="decision_request",
        title=notification_title or title,
        body=(summary or title)[:500],
        status="pending" if not reveal else bell_status,
        payload_json=json.dumps(
            {
                **bell_payload,
                _PENDING_REVEAL_KEY: pending_reveal,
            },
            default=str,
        ),
    )
    session.add(notification)
    await session.flush()
    decision = DecisionRequest(
        tenant_id=tenant_id,
        notification_id=notification.id,
        title=title,
        summary=summary,
        options_json=json.dumps(options or []),
        status="awaiting_human",
        project_id=project_id,
        platform_change_id=platform_change_id,
        agent_task_id=agent_task_id,
        run_id=run_id,
        signal_id=signal_id,
        source_type=source_type,
        source_id=source_id,
        bundle_id=bundle_id or "",
    )
    addressee.apply(decision)
    session.add(decision)
    await session.flush()
    if not reveal:
        payload = {
            **bell_payload,
            "decision_id": str(decision.id),
            "signal_id": str(decision.signal_id) if decision.signal_id else None,
            _PENDING_REVEAL_KEY: pending_reveal,
        }
        notification.payload_json = json.dumps(payload, default=str)
        session.add(notification)
        await session.flush()
        return decision, None

    message = await append_decision_to_signal(
        session,
        tenant_id,
        decision,
        user_id=user_id,
        agent_id=agent_id,
        project_id=project_id,
        signal_id=signal_id,
        items=items,
        question=question,
        selection=selection,
    )
    await _finalize_decision_notification(
        session,
        tenant_id,
        decision,
        notification,
        message=message,
        # Keep sender mark (`from`) — do not pass the raw caller payload alone.
        notification_payload=bell_payload,
        bell_user_id=bell_user_id,
        bell_status=bell_status,
    )
    return decision, message


async def _finalize_decision_notification(
    session: AsyncSession,
    tenant_id: UUID,
    decision: DecisionRequest,
    notification: Notification,
    *,
    message: SignalMessage,
    notification_payload: dict[str, Any],
    bell_user_id: UUID | None,
    bell_status: str,
) -> None:
    from app.gateway.publish import publish_notification

    payload = {
        **notification_payload,
        "decision_id": str(decision.id),
        "signal_id": str(decision.signal_id) if decision.signal_id else None,
        "message_id": str(message.id),
    }
    payload.pop(_PENDING_REVEAL_KEY, None)
    notification.payload_json = json.dumps(payload, default=str)
    notification.signal_id = decision.signal_id
    notification.status = bell_status
    session.add(notification)
    await session.flush()
    if bell_status == "unread":
        await publish_notification(notification)
    if bell_user_id and bell_status == "unread":
        from app.services.notify import TIER_NOW, deliver_external

        await deliver_external(
            session,
            tenant_id,
            kind="decision_request",
            recipients=[bell_user_id],
            title=notification.title,
            body=notification.body or "",
            tier=TIER_NOW,
            category="decisions",
            signal_id=decision.signal_id,
            payload=payload,
            critical=True,
        )


async def reveal_decision(
    session: AsyncSession,
    tenant_id: UUID,
    decision: DecisionRequest,
) -> SignalMessage | None:
    """Publish a deferred DecisionRequest into the thread after speech is saved.

    Idempotent when ``message_id`` is already set. Used by ``place_turn_decisions``.
    """
    if decision.message_id is not None:
        existing = await session.get(SignalMessage, decision.message_id)
        return existing

    notification: Notification | None = None
    if decision.notification_id:
        notification = await session.get(Notification, decision.notification_id)

    pending: dict[str, Any] = {}
    if notification:
        try:
            raw = json.loads(notification.payload_json or "{}")
        except json.JSONDecodeError:
            raw = {}
        if isinstance(raw, dict):
            blob = raw.get(_PENDING_REVEAL_KEY)
            if isinstance(blob, dict):
                pending = blob

    def _uuid(value: Any) -> UUID | None:
        if not value:
            return None
        try:
            return UUID(str(value))
        except ValueError:
            return None

    items = pending.get("items") if isinstance(pending.get("items"), list) else None
    message = await append_decision_to_signal(
        session,
        tenant_id,
        decision,
        user_id=_uuid(pending.get("user_id")),
        agent_id=_uuid(pending.get("agent_id")) or None,
        project_id=_uuid(pending.get("project_id")) or decision.project_id,
        signal_id=decision.signal_id,
        items=items,
        question=str(pending["question"]) if pending.get("question") else None,
        selection=str(pending["selection"]) if pending.get("selection") else None,
    )
    extra = pending.get("message_meta")
    if message is not None and isinstance(extra, dict) and extra:
        try:
            meta = json.loads(message.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        meta.update(extra)
        message.metadata_json = json.dumps(meta, default=str)
        session.add(message)
    if notification is not None:
        bell_status = str(pending.get("bell_status") or "unread")
        notif_payload = pending.get("notification_payload")
        if not isinstance(notif_payload, dict):
            notif_payload = {}
        await _finalize_decision_notification(
            session,
            tenant_id,
            decision,
            notification,
            message=message,
            notification_payload=notif_payload,
            bell_user_id=notification.user_id,
            bell_status=bell_status,
        )
    from app.services.agent_calls import maybe_ring_for_decision

    await maybe_ring_for_decision(session, tenant_id, decision)
    return message
