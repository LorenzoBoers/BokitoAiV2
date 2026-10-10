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
from datetime import datetime, timedelta
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

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
    return {"tiers": tiers, "categories": categories, "sound": sound, "version": PREFS_VERSION}


def serialize_prefs(prefs: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": int(prefs.get("version") or PREFS_VERSION),
        "tiers": {str(tier): prefs["tiers"][tier] for tier in TIERS},
        "rows": [
            {"id": key, "channels": value} for key, value in prefs["categories"].items()
        ],
        "sound": bool(prefs.get("sound", True)),
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
    if isinstance(patch.get("version"), int) and patch["version"] >= 1:
        current["version"] = patch["version"]
    else:
        current["version"] = PREFS_VERSION
    row.prefs_json = json.dumps(serialize_prefs(current))
    row.updated_at = datetime.utcnow()
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
    created = n.created_at or datetime.utcnow()
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
    now = datetime.utcnow()
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
) -> list[Notification]:
    """Record and deliver one event to its recipients. Commits.

    Returns the rows created (one per person with the in-app channel on).
    ``cooldown_minutes`` drops a repeat of the same title within the window.
    """
    from app.gateway.publish import publish_notification
    from app.services.notification_mail import send_notification_mail, thread_link
    from app.services.presence import user_status

    if cooldown_minutes > 0:
        since = datetime.utcnow() - timedelta(minutes=cooldown_minutes)
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
    now = datetime.utcnow()
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
            row = Notification(
                tenant_id=tenant_id,
                user_id=user.id,
                kind=kind,
                title=title[:200],
                body=body[:500],
                tier=tier,
                signal_id=signal_id,
                payload_json=json.dumps(data, default=str),
            )
            session.add(row)
            created.append(row)
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


async def notify_new_inbound(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Any,
    *,
    sender: str = "",
    subject: str = "",
    exclude: UUID | None = None,
) -> list[Notification]:
    """Tell the conversation's people that a new customer message arrived.

    Honours the ``new-message`` pref row (on by default for in-app + push). A
    user owner is told alone; a team owner tells that team's people. An
    agent-owned conversation stays quiet. The sender is skipped when they are
    a workspace member.
    """
    from app.models.auth import Tenant
    from app.models.team import Team
    from app.services.language import resolve_workspace_language
    from app.services.teams import team_user_ids

    if getattr(signal, "channel", "") in ("internal", "assistant"):
        return []
    if getattr(signal, "status", "") == "spam":
        return []
    kind = getattr(signal, "assignee_kind", "") or ""
    recipients: list[UUID] = []
    if kind == "user" and signal.assigned_user_id:
        recipients = [signal.assigned_user_id]
    elif kind == "team" and signal.assignee_team_id:
        team = await session.get(Team, signal.assignee_team_id)
        if team is not None and team.tenant_id == tenant_id:
            recipients = await team_user_ids(session, team)
    if not recipients:
        return []
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    lang = resolve_workspace_language(tenant)
    who = (sender or "").strip() or ("Iemand" if lang == "nl" else "Someone")
    title = f"Nieuw bericht van {who}" if lang == "nl" else f"New message from {who}"
    return await notify(
        session,
        tenant_id,
        kind="new_message",
        recipients=recipients,
        title=title,
        body=(subject or "")[:500],
        tier=TIER_NOW,
        category="new-message",
        signal_id=signal.id,
        payload={"channel": getattr(signal, "channel", "")},
        exclude=exclude,
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
