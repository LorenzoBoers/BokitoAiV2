"""One path for notifications: who, which tier, which channel.

Tiers:

1. Interrupt now: you became owner or picked up, a question or decision for
   you, a direct mention, a customer waiting for a person, a critical system
   notice. Push when you are not in the app.
2. Later: system notices (run failed, Govern proposals, invitations, results
   of work you gave). In the app and the bell, no push.
3. Digest: team activity and finished runs. Daily email when enabled; folded
   in the bell.

Conversation items (``signal_id`` set) are For you work: they get one
Notification row per person for a shared read state (opening the
conversation reads them) and never a second badge in the bell.

Availability steers delivery: while you are away only critical tier 1
notices reach you outside the app. Push still fires when you are available
so a laptop or phone can show an OS notification even with the dashboard open.
"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.auth import User
from app.models.notification import Notification, UserNotificationPreference

TIER_NOW, TIER_LATER, TIER_DIGEST = 1, 2, 3
TIERS = (TIER_NOW, TIER_LATER, TIER_DIGEST)
CHANNELS = ("inapp", "push", "email")

DEFAULT_TIER_CHANNELS: dict[int, dict[str, bool]] = {
    TIER_NOW: {"inapp": True, "push": True, "email": False},
    TIER_LATER: {"inapp": True, "push": False, "email": False},
    # Tier 3 email is the daily digest (opt-in).
    TIER_DIGEST: {"inapp": True, "push": False, "email": False},
}
# Channels a tier can use at all; tier 2 and 3 never push.
TIER_ALLOWED: dict[int, tuple[str, ...]] = {
    TIER_NOW: ("inapp", "push", "email"),
    TIER_LATER: ("inapp", "email"),
    TIER_DIGEST: ("inapp", "email"),
}

# Finer per-event switches. A notice is delivered only when both its tier
# and its category allow the channel. New mail on a conversation you or your
# team own defaults on (in-app + push) so For you stays the attention path.
# Workspace rows default email on so the Later email switch still reaches them.
CATEGORY_DEFAULTS: dict[str, dict[str, bool]] = {
    "assigned-to-me": {"inapp": True, "push": True, "email": False},
    "mentions": {"inapp": True, "push": True, "email": False},
    "decisions": {"inapp": True, "push": True, "email": False},
    "handoff": {"inapp": True, "push": True, "email": False},
    "new-message": {"inapp": True, "push": True, "email": False},
    "ops-run-failed": {"inapp": True, "push": False, "email": True},
    "ops-channel-disconnect": {"inapp": True, "push": False, "email": True},
    "billing-alerts": {"inapp": True, "push": True, "email": True},
    "digest-weekly": {"inapp": False, "push": False, "email": False},
}

# Which tier a category rides when a caller only has the category id.
CATEGORY_TIER: dict[str, int] = {
    "assigned-to-me": TIER_NOW,
    "mentions": TIER_NOW,
    "decisions": TIER_NOW,
    "handoff": TIER_NOW,
    "new-message": TIER_NOW,
    "ops-run-failed": TIER_LATER,
    "ops-channel-disconnect": TIER_LATER,
    "billing-alerts": TIER_NOW,
    "digest-weekly": TIER_DIGEST,
}


def _bool_map(raw: Any, fallback: dict[str, bool]) -> dict[str, bool]:
    raw = raw if isinstance(raw, dict) else {}
    out = dict(fallback)
    for channel in CHANNELS:
        # Older rows call the in-app channel "desktop".
        value = raw.get(channel, raw.get("desktop") if channel == "inapp" else None)
        if isinstance(value, bool):
            out[channel] = value
    return out


# Bump when a default category matrix change should override stored rows once.
PREFS_VERSION = 2


def parse_prefs(prefs_json: str | None) -> dict[str, Any]:
    """``{"version": int, "tiers": {...}, "categories": {id: {...}}, "sound": bool}``."""
    try:
        raw = json.loads(prefs_json or "")
    except (json.JSONDecodeError, TypeError):
        raw = None
    tiers_raw: dict[str, Any] = {}
    rows: list[Any] = []
    sound = True
    version = 1
    if isinstance(raw, dict):
        tiers_raw = raw.get("tiers") if isinstance(raw.get("tiers"), dict) else {}
        rows = raw.get("rows") if isinstance(raw.get("rows"), list) else []
        if isinstance(raw.get("sound"), bool):
            sound = raw["sound"]
        if isinstance(raw.get("version"), int):
            version = raw["version"]
    elif isinstance(raw, list):
        rows = raw
    tiers = {
        tier: _bool_map(tiers_raw.get(str(tier)), DEFAULT_TIER_CHANNELS[tier]) for tier in TIERS
    }
    categories = {key: dict(value) for key, value in CATEGORY_DEFAULTS.items()}
    for row in rows:
        if isinstance(row, dict) and row.get("id") in CATEGORY_DEFAULTS:
            categories[row["id"]] = _bool_map(row.get("channels"), CATEGORY_DEFAULTS[row["id"]])
    # The old "digest-daily" row is the tier 3 email switch now.
    for row in rows:
        if isinstance(row, dict) and row.get("id") == "digest-daily" and "3" not in tiers_raw:
            tiers[TIER_DIGEST]["email"] = bool((row.get("channels") or {}).get("email"))
    # v2: new-message defaults on for owned conversations (For you attention path).
    if version < 2:
        categories["new-message"] = dict(CATEGORY_DEFAULTS["new-message"])
    from app.services.reach import parse_reach

    reach = parse_reach(raw.get("reach") if isinstance(raw, dict) else None)
    return {"tiers": tiers, "categories": categories, "sound": sound, "version": PREFS_VERSION, "reach": reach}


def serialize_prefs(prefs: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": int(prefs.get("version") or PREFS_VERSION),
        "tiers": {str(tier): prefs["tiers"][tier] for tier in TIERS},
        "rows": [
            {"id": key, "channels": value} for key, value in prefs["categories"].items()
        ],
        "sound": bool(prefs.get("sound", True)),
        "reach": prefs.get("reach") or {},
    }


async def load_prefs(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> dict[str, Any]:
    row = (
        await session.execute(
            select(UserNotificationPreference).where(
                UserNotificationPreference.tenant_id == tenant_id,
                UserNotificationPreference.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return parse_prefs(row.prefs_json if row else None)


async def save_prefs(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, patch: dict[str, Any]
) -> dict[str, Any]:
    """Merge ``{"version", "tiers", "rows", "sound"}`` into the stored preferences."""
    row = (
        await session.execute(
            select(UserNotificationPreference).where(
                UserNotificationPreference.tenant_id == tenant_id,
                UserNotificationPreference.user_id == user_id,
            )
        )
    ).scalar_one_or_none() or UserNotificationPreference(tenant_id=tenant_id, user_id=user_id)
    current = parse_prefs(row.prefs_json)
    tiers_patch = patch.get("tiers") if isinstance(patch.get("tiers"), dict) else {}
    for key, value in tiers_patch.items():
        try:
            tier = int(key)
        except (TypeError, ValueError):
            continue
        if tier in TIERS:
            current["tiers"][tier] = _bool_map(value, current["tiers"][tier])
    for entry in patch.get("rows") if isinstance(patch.get("rows"), list) else []:
        if isinstance(entry, dict) and entry.get("id") in CATEGORY_DEFAULTS:
            key = entry["id"]
            current["categories"][key] = _bool_map(entry.get("channels"), current["categories"][key])
    if isinstance(patch.get("sound"), bool):
        current["sound"] = patch["sound"]
    if isinstance(patch.get("reach"), dict):
        from app.services.reach import parse_reach

        current["reach"] = parse_reach({**(current.get("reach") or {}), **patch["reach"]})
    if isinstance(patch.get("version"), int) and patch["version"] >= 1:
        current["version"] = patch["version"]
    else:
        current["version"] = PREFS_VERSION
    row.prefs_json = json.dumps(serialize_prefs(current))
    row.updated_at = utcnow()
    session.add(row)
    await session.commit()
    return current


def channels_for(
    prefs: dict[str, Any], *, tier: int, category: str | None, status: str, critical: bool = False
) -> set[str]:
    """Channels for one notice: tier switch, then category switch, then availability.

    ``inapp`` means an unread row exists (For you, shared read state); push and
    email interrupt. Away lets only critical tier 1 notices interrupt outside
    the app. Available users still get push when that channel is on.
    """
    from app.services.presence import AWAY

    tier = tier if tier in TIERS else TIER_LATER
    enabled = {
        channel
        for channel in TIER_ALLOWED[tier]
        if prefs["tiers"][tier].get(channel)
    }
    if category and category.startswith("ops-"):
        # Ops alerts are not user-toggleable: owners/admins always get the
        # in-app row so a broken run or channel cannot be muted.
        enabled.add("inapp")
    elif category and category in prefs["categories"]:
        enabled &= {c for c, on in prefs["categories"][category].items() if on}
    if critical:
        enabled.add("inapp")
    if tier == TIER_DIGEST:
        # Digest email goes out in the daily mail, not per event.
        enabled.discard("email")
    if status == AWAY and not (critical and tier == TIER_NOW):
        enabled -= {"push", "email"}
    return enabled


def serialize_notification(n: Notification) -> dict[str, Any]:
    """One bell row: the list endpoint and the ``notification`` gateway event share it."""
    created = n.created_at or utcnow()
    return {
        "id": str(n.id),
        "kind": n.kind,
        "title": n.title,
        "body": n.body,
        "status": n.status,
        "tier": n.tier or 2,
        "payload": json.loads(n.payload_json or "{}"),
        "created_at": created.isoformat(),
        "user_id": str(n.user_id) if n.user_id else None,
        "signal_id": str(n.signal_id) if n.signal_id else None,
    }


def from_user(user: User | None) -> dict[str, Any] | None:
    """Sender mark for a workspace member (toast + bell avatar)."""
    if user is None:
        return None
    name = (user.display_name or user.email or "").strip()
    if not name:
        return None
    return {
        "kind": "user",
        "id": str(user.id),
        "name": name,
        "email": user.email or "",
        "avatar_url": user.avatar_url,
    }


def from_agent(agent: Any | None) -> dict[str, Any] | None:
    """Sender mark for an AI agent."""
    if agent is None:
        return None
    from app.services.agent_avatar import avatar_payload

    name = (getattr(agent, "name", None) or "").strip()
    if not name:
        return None
    av = avatar_payload(agent)
    return {
        "kind": "agent",
        "id": str(agent.id),
        "name": name,
        "avatar_kind": av.get("avatar_kind"),
        "avatar_icon": av.get("avatar_icon"),
        "avatar_color": av.get("avatar_color"),
        "avatar_shape": av.get("avatar_shape"),
        "avatar_image_url": av.get("avatar_image_url"),
    }


def from_contact(
    *,
    name: str = "",
    email: str = "",
    contact_id: UUID | str | None = None,
    host: str | None = None,
) -> dict[str, Any] | None:
    """Sender mark for an external contact / visitor."""
    label = (name or email or "").strip()
    if not label:
        return None
    row: dict[str, Any] = {
        "kind": "contact",
        "name": label,
        "email": (email or "").strip(),
    }
    if contact_id:
        row["id"] = str(contact_id)
    if host:
        row["host"] = host
    return row


def from_signal_contact(signal: Any) -> dict[str, Any] | None:
    """Contact mark from a conversation row."""
    return from_contact(
        name=getattr(signal, "contact_name", "") or "",
        email=getattr(signal, "contact_email", "") or "",
        contact_id=getattr(signal, "contact_id", None),
    )


async def resolve_from_actor(
    session: AsyncSession,
    *,
    actor_type: str = "",
    actor_id: str = "",
    signal: Any | None = None,
) -> dict[str, Any] | None:
    """Pick a toast/bell sender: agent, user, or the conversation contact."""
    kind = (actor_type or "").strip().lower()
    raw_id = (actor_id or "").strip()
    if kind == "agent" and raw_id:
        from app.models.agent import Agent

        try:
            agent = await session.get(Agent, UUID(raw_id))
        except (TypeError, ValueError):
            agent = None
        mark = from_agent(agent)
        if mark:
            return mark
    if kind == "user" and raw_id:
        try:
            user = await session.get(User, UUID(raw_id))
        except (TypeError, ValueError):
            user = None
        mark = from_user(user)
        if mark:
            return mark
    if signal is not None:
        return from_signal_contact(signal)
    return None


async def _users(session: AsyncSession, ids: Iterable[UUID]) -> list[User]:
    unique = list(dict.fromkeys(uid for uid in ids if uid))
    if not unique:
        return []
    rows = (await session.execute(select(User).where(User.id.in_(unique)))).scalars().all()
    by_id = {row.id: row for row in rows}
    return [by_id[uid] for uid in unique if uid in by_id and by_id[uid].is_active]


async def deliver_external(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    kind: str,
    recipients: Iterable[UUID],
    title: str,
    body: str = "",
    tier: int = TIER_LATER,
    category: str | None = None,
    signal_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
    critical: bool = False,
) -> None:
    """Push/email only for an existing in-app notice. No Notification rows, no commit.

    Use when the caller already wrote the Notification (e.g. decisions link
    ``decision.notification_id``) and still wants tier/category/presence rules.
    """
    from app.services.notification_mail import send_notification_mail, thread_link
    from app.services.presence import user_status

    data = {**(payload or {})}
    if signal_id:
        data.setdefault("signal_id", str(signal_id))
    if category:
        data.setdefault("category", category)
    now = utcnow()
    push_targets: list[UUID] = []
    mail_targets: list[UUID] = []
    for user in await _users(session, recipients):
        prefs = await load_prefs(session, tenant_id, user.id)
        channels = channels_for(
            prefs, tier=tier, category=category, status=user_status(user, now=now), critical=critical
        )
        if "push" in channels:
            push_targets.append(user.id)
        if "email" in channels:
            mail_targets.append(user.id)
    if push_targets:
        from app.services.push import send_push_to_user

        for user_id in push_targets:
            await send_push_to_user(
                session, tenant_id, user_id, title[:200], body[:200], {"kind": kind, **data}
            )
    for user_id in mail_targets:
        text = f"{title}\n\n{body}".strip()
        if signal_id:
            text += f"\n\nOpen the conversation:\n{thread_link(signal_id)}"
        await send_notification_mail(session, user_id, subject=title[:200], text=text, tenant_id=tenant_id)


async def notify(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    kind: str,
    recipients: Iterable[UUID],
    title: str,
    body: str = "",
    tier: int = TIER_LATER,
    category: str | None = None,
    signal_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
    critical: bool = False,
    exclude: UUID | None = None,
    cooldown_minutes: int = 0,
    collapse_key: str | None = None,
    announce: bool = True,
) -> list[Notification]:
    """Record and deliver one event to its recipients. Commits.

    Returns the rows created or updated (one per person with the in-app
    channel on). ``cooldown_minutes`` drops a repeat of the same title within
    the window. ``collapse_key`` with a ``signal_id`` rewrites that person's
    unread row for the same conversation and key instead of adding one.
    ``announce=False`` keeps the row quiet: no toast, sound or push.
    """
    from app.gateway.publish import publish_notification
    from app.services.notification_mail import send_notification_mail, thread_link
    from app.services.presence import user_status

    if cooldown_minutes > 0:
        since = utcnow() - timedelta(minutes=cooldown_minutes)
        recent = await session.execute(
            select(Notification.id)
            .where(
                Notification.tenant_id == tenant_id,
                Notification.kind == kind,
                Notification.title == title[:200],
                Notification.created_at >= since,
            )
            .limit(1)
        )
        if recent.first():
            return []

    data = {**(payload or {})}
    if signal_id:
        data.setdefault("signal_id", str(signal_id))
    if category:
        data.setdefault("category", category)
    if collapse_key and signal_id:
        data["collapse"] = collapse_key
    if not announce:
        data["announce"] = False
    now = utcnow()
    created: list[Notification] = []
    push_targets: list[UUID] = []
    mail_targets: list[UUID] = []
    for user in await _users(session, recipients):
        if exclude is not None and user.id == exclude:
            continue
        prefs = await load_prefs(session, tenant_id, user.id)
        channels = channels_for(
            prefs, tier=tier, category=category, status=user_status(user, now=now), critical=critical
        )
        if "inapp" in channels:
            row = (
                await _collapsible_row(session, tenant_id, user.id, signal_id, collapse_key)
                if collapse_key and signal_id
                else None
            )
            if row is None:
                row = Notification(
                    tenant_id=tenant_id,
                    user_id=user.id,
                    kind=kind,
                    signal_id=signal_id,
                )
            row.kind = kind
            row.title = title[:200]
            row.body = body[:500]
            row.tier = tier
            row.payload_json = json.dumps(data, default=str)
            row.created_at = now
            session.add(row)
            created.append(row)
        if not announce:
            continue
        if "push" in channels:
            push_targets.append(user.id)
        if "email" in channels:
            mail_targets.append(user.id)
    if created:
        await session.commit()
        for row in created:
            await publish_notification(row)
    if push_targets:
        from app.services.push import send_push_to_user

        for user_id in push_targets:
            await send_push_to_user(session, tenant_id, user_id, title[:200], body[:200], {"kind": kind, **data})
    for user_id in mail_targets:
        text = f"{title}\n\n{body}".strip()
        if signal_id:
            text += f"\n\nOpen the conversation:\n{thread_link(signal_id)}"
        await send_notification_mail(session, user_id, subject=title[:200], text=text, tenant_id=tenant_id)
    return created


async def _collapsible_row(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    collapse_key: str,
) -> Notification | None:
    rows = (
        await session.execute(
            select(Notification)
            .where(
                Notification.tenant_id == tenant_id,
                Notification.user_id == user_id,
                Notification.signal_id == signal_id,
                Notification.status == "unread",
            )
            .order_by(Notification.created_at.desc())
            .limit(10)
        )
    ).scalars().all()
    for row in rows:
        try:
            data = json.loads(row.payload_json or "{}")
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("collapse") == collapse_key:
            return row
    return None


async def conversation_recipients(session: AsyncSession, tenant_id: UUID, signal: Any) -> list[UUID]:
    """The people a conversation notice goes to.

    A user owner alone; a team owner's people; nobody for an agent-owned or
    unowned conversation.
    """
    from app.models.team import Team
    from app.services.teams import team_user_ids

    kind = getattr(signal, "assignee_kind", "") or ""
    if kind == "user" and signal.assigned_user_id:
        return [signal.assigned_user_id]
    if kind == "department" and signal.assignee_team_id:
        team = await session.get(Team, signal.assignee_team_id)
        if team is not None and team.tenant_id == tenant_id:
            return list(await team_user_ids(session, team))
    return []


INBOUND_COLLAPSE_KEY = "inbound"
NOTICE_META_KEY = "notice"
NOTICE_PENDING = "pending"
NOTICE_SENT = "sent"

_FIRST_READ_COPY: dict[str, dict[str, str]] = {
    "nl": {
        "new": "Nieuw bericht van {who}",
        "someone": "Iemand",
        "draft": "Concept klaar: {text}",
        "decision": "Vraagt een keuze: {text}",
        "no_reply": "Geen antwoord nodig: {text}",
        "answered": "Beantwoord door {agent}: {text}",
        "the_ai": "de AI",
    },
    "en": {
        "new": "New message from {who}",
        "someone": "Someone",
        "draft": "Draft ready: {text}",
        "decision": "Needs a choice: {text}",
        "no_reply": "No reply needed: {text}",
        "answered": "Answered by {agent}: {text}",
        "the_ai": "the AI",
    },
}

# Outcomes that need nobody: the thread is closed or a newer message is read.
_SILENT_OUTCOMES = frozenset({"auto_closed", "archived", "closed", "skipped_stale"})
_NO_REPLY_OUTCOMES = frozenset({"no_reply_needed", "no_reply_noted"})


def first_read_kind(delivery: dict[str, Any] | None) -> str:
    """What the first read of an inbound message came to, for its notice.

    ``silent`` | ``no_reply`` | ``draft`` | ``decision`` | ``answered`` | ``new``.
    """
    delivery = delivery if isinstance(delivery, dict) else {}
    status = str(delivery.get("delivery") or "")
    tools = delivery.get("tools") if isinstance(delivery.get("tools"), list) else []
    if status in _SILENT_OUTCOMES:
        return "silent"
    if status in _NO_REPLY_OUTCOMES:
        return "no_reply"
    if status == "pending_approval":
        return "draft"
    if status == "pending_decision":
        return "draft" if "suggest_thread_reply" in tools else "decision"
    if delivery.get("delivered_to_customer") or status.startswith("sent"):
        return "answered"
    return "new"


def _notice_state(message: Any) -> str:
    try:
        meta = json.loads(getattr(message, "metadata_json", None) or "{}")
    except json.JSONDecodeError:
        return ""
    return str(meta.get(NOTICE_META_KEY) or "") if isinstance(meta, dict) else ""


def _with_notice(raw: str | None, value: str) -> str:
    try:
        meta = json.loads(raw or "{}")
    except json.JSONDecodeError:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    meta[NOTICE_META_KEY] = value
    return json.dumps(meta)


def mark_notice_pending(message: Any) -> None:
    """The first read of this message will send its notice (see ``notify_first_read``)."""
    message.metadata_json = _with_notice(message.metadata_json, NOTICE_PENDING)


async def _claim_notice(session: AsyncSession, message: Any) -> bool:
    """Flip one message from pending to sent; False when someone else did."""
    from app.models.signal import SignalMessage

    await session.refresh(message)
    if _notice_state(message) != NOTICE_PENDING:
        return False
    before = message.metadata_json
    result = await session.execute(
        update(SignalMessage)
        .where(SignalMessage.id == message.id, SignalMessage.metadata_json == before)
        .values(metadata_json=_with_notice(before, NOTICE_SENT))
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    if not result.rowcount:
        return False
    await session.refresh(message)
    return True


async def _settle_earlier_notices(session: AsyncSession, message: Any) -> None:
    """Older pending messages on the thread are covered by this notice."""
    from app.models.signal import SignalMessage

    rows = (
        await session.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == message.signal_id,
                SignalMessage.direction == "inbound",
                SignalMessage.kind == "user_message",
                SignalMessage.created_at <= message.created_at,
                SignalMessage.id != message.id,
                SignalMessage.metadata_json.like(f'%"{NOTICE_META_KEY}": "{NOTICE_PENDING}"%'),
            )
        )
    ).scalars().all()
    for row in rows:
        row.metadata_json = _with_notice(row.metadata_json, NOTICE_SENT)
        session.add(row)
    if rows:
        await session.commit()


async def _newest_inbound(session: AsyncSession, signal_id: UUID) -> Any:
    from app.models.signal import SignalMessage

    return (
        await session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == signal_id,
                SignalMessage.direction == "inbound",
                SignalMessage.kind == "user_message",
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def notify_new_inbound(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Any,
    *,
    sender: str = "",
    subject: str = "",
    exclude: UUID | None = None,
    outcome: str = "new",
    summary: str = "",
    agent_name: str = "",
) -> list[Notification]:
    """Tell the conversation's people about a customer message. One row per thread.

    Honours the ``new-message`` pref row (on by default for in-app + push).
    Recipients come from ``conversation_recipients``. ``outcome`` is the first
    read (``first_read_kind``): a draft or a choice interrupts; no reply needed
    or an answer already sent lands quietly. Later messages on the same thread
    rewrite that person's unread row instead of stacking a second one.
    """
    from app.models.auth import Tenant
    from app.services.language import resolve_workspace_language

    if getattr(signal, "channel", "") in ("internal", "assistant"):
        return []
    if getattr(signal, "status", "") in ("spam", "closed"):
        return []
    if outcome == "silent":
        return []
    recipients = await conversation_recipients(session, tenant_id, signal)
    if not recipients:
        return []
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    lang = resolve_workspace_language(tenant)
    copy = _FIRST_READ_COPY["nl" if lang == "nl" else "en"]
    who = (sender or "").strip() or copy["someone"]
    text = (summary or subject or "").strip()
    if outcome in ("draft", "decision", "no_reply", "answered"):
        title = who
        body = copy[outcome].format(text=text, agent=agent_name or copy["the_ai"]).strip()
    else:
        title = copy["new"].format(who=who)
        body = subject or ""
    quiet = outcome in ("no_reply", "answered")
    contact_mark = from_signal_contact(signal) or from_contact(name=who)
    payload: dict[str, Any] = {"channel": getattr(signal, "channel", ""), "outcome": outcome}
    if contact_mark:
        payload["from"] = contact_mark
    return await notify(
        session,
        tenant_id,
        kind="new_message",
        recipients=recipients,
        title=title,
        body=body[:500],
        tier=TIER_LATER if quiet else TIER_NOW,
        category="new-message",
        signal_id=signal.id,
        payload=payload,
        exclude=exclude,
        collapse_key=INBOUND_COLLAPSE_KEY,
        announce=not quiet,
    )


async def notify_first_read(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Any,
    message: Any,
    delivery: dict[str, Any] | None,
) -> list[Notification]:
    """The one notice for an inbound message, sent once its first read is done.

    Runs after every inbound job. Only a message ingest marked pending gets a
    notice here, and only once: the 20s fallback and this call race on the
    same claim.
    """
    message = message or await _newest_inbound(session, signal.id)
    if message is None:
        return []
    kind = first_read_kind(delivery)
    if kind == "silent" and str((delivery or {}).get("delivery")) == "skipped_stale":
        # A newer message has its own read; its notice covers this one.
        return []
    if not await _claim_notice(session, message):
        return []
    await _settle_earlier_notices(session, message)
    await session.refresh(signal)
    agent_name = ""
    if signal.agent_id:
        from app.models.agent import Agent

        agent = await session.get(Agent, signal.agent_id)
        agent_name = getattr(agent, "name", "") or ""
    return await notify_new_inbound(
        session,
        tenant_id,
        signal,
        sender=signal.contact_name or message.from_address or "",
        subject=signal.subject or message.subject or "",
        outcome=kind,
        summary=str((delivery or {}).get("summary") or ""),
        agent_name=agent_name,
    )


async def notify_inbound_fallback(
    session: AsyncSession, tenant_id: UUID, signal: Any, message: Any
) -> list[Notification]:
    """The first read never reported back: send the plain new-message notice.

    Skips when the notice already went out, or when a newer message on the
    thread is pending (its own read or fallback covers both).
    """
    newest = await _newest_inbound(session, signal.id)
    if newest is not None and newest.id != message.id and _notice_state(newest) == NOTICE_PENDING:
        return []
    if not await _claim_notice(session, message):
        return []
    await _settle_earlier_notices(session, message)
    await session.refresh(signal)
    return await notify_new_inbound(
        session,
        tenant_id,
        signal,
        sender=signal.contact_name or message.from_address or "",
        subject=signal.subject or message.subject or "",
    )


async def mark_conversation_read(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, signal_id: UUID
) -> int:
    """Opening a conversation reads its notifications for that person on every device."""
    result = await session.execute(
        update(Notification)
        .where(
            Notification.tenant_id == tenant_id,
            Notification.user_id == user_id,
            Notification.signal_id == signal_id,
            Notification.status == "unread",
        )
        .values(status="read")
    )
    return int(result.rowcount or 0)
