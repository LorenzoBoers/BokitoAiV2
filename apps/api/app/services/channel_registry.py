"""Unified channel registry: one lifecycle model for every channel kind.

Every tenant surface that carries conversations is a `ChannelAccount` row, so
mailboxes, Bokito relay addresses, the website widget, WhatsApp numbers, and
Slack workspaces get the same three layers instead of a bespoke status per
type:

- **state** — one enum that means the same thing everywhere:
  ``setup_required`` (platform side not configured), ``connecting`` (credentials
  in place, first sync pending), ``active``, ``degraded`` (works with a warning),
  ``action_required`` (a human must reconnect or fill something in), ``paused``
  (switched off), ``error`` (hard failure), ``archived`` (stopped for good;
  conversations and access stay, see ``channel_lifecycle``).
- **capabilities** — ``receive`` / ``send`` / ``sync``. A channel without
  ``sync`` simply has no sync detail to show, which is why the old
  "Sync status" panel could sit there empty.
- **checks** — the granular per-channel truth (credentials, webhook, folders,
  office hours). Each check states ``ok`` / ``warn`` / ``fail`` / ``pending`` /
  ``na`` and, when it fails, which state that implies.

Adding a channel type means writing one resolver and registering it in
`_RESOLVERS`; the API, the settings list, and the hub read the same rows.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable
from uuid import UUID

from app.models.auth import Tenant
from app.models.channel import ChannelAccount

CHANNEL_STATES = (
    "setup_required",
    "connecting",
    "active",
    "degraded",
    "action_required",
    "paused",
    "error",
    "archived",
)
CHECK_STATES = ("ok", "warn", "fail", "pending", "na")
CHANNEL_CAPABILITIES = ("receive", "send", "sync")

# Which state wins when several checks fail at once.
_FAIL_PRIORITY = ("error", "setup_required", "action_required")

# Channel kinds shown as configurable rows. `internal` team threads and mock
# seed rows are conversations, not a surface anyone connects.
HIDDEN_CHANNELS = ("internal",)
HIDDEN_EMAIL_PROVIDERS = ("mock",)

# A mailbox that has not synced for this long is degraded, not active.
STALE_SYNC_AFTER = timedelta(hours=24)
# Repeated sync failures stop being a warning and become an error.
SYNC_ERROR_LIMIT = 5


def _loads(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    text = str(value or "").strip()
    return text or None


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def channel_kind(account: ChannelAccount) -> str:
    """UI-level kind: email splits into OAuth mailbox vs Bokito relay."""
    if account.channel == "email":
        return "email_relay" if account.provider == "bokito" else "email_mailbox"
    return account.channel


def is_parked_channel(channel: str) -> bool:
    """Channel kinds parked from the product surface (PARKED_CHANNELS env)."""
    from app.config import get_settings

    return (channel or "").strip().lower() in get_settings().parked_channel_set()


def is_configurable_channel(account: ChannelAccount) -> bool:
    if account.channel in HIDDEN_CHANNELS:
        return False
    if is_parked_channel(account.channel):
        return False
    if account.channel == "email" and account.provider in HIDDEN_EMAIL_PROVIDERS:
        return False
    return True


def _check(
    check_id: str,
    state: str,
    *,
    detail: str = "",
    action: str = "",
    fail_state: str = "action_required",
) -> dict[str, Any]:
    return {
        "id": check_id,
        "state": state,
        "detail": detail,
        "action": action,
        "fail_state": fail_state,
    }


@dataclass
class ChannelContext:
    account: ChannelAccount
    settings: dict[str, Any]
    credentials: dict[str, Any]
    tenant: Tenant | None
    last_event_at: datetime | None
    now: datetime

    @property
    def has_token(self) -> bool:
        from app.services.crypto import credentials_ready_from_settings

        flagged = credentials_ready_from_settings(self.settings)
        if flagged is not None:
            return flagged
        if self.account.provider == "smtp_imap":
            from app.services.smtp_imap import is_connected

            return is_connected(self.credentials)
        return bool(self.credentials.get("access_token"))

    @property
    def last_error(self) -> str:
        return str(self.settings.get("last_error") or "")


@dataclass
class ChannelFacts:
    capabilities: tuple[str, ...]
    checks: list[dict[str, Any]] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    configure_href: str = ""


# ── resolvers per kind ───────────────────────────────────────────────


def _resolve_email_relay(ctx: ChannelContext) -> ChannelFacts:
    """Bokito relay address: webhook-driven, so it receives and sends but never syncs."""
    from app.config import get_settings

    platform = get_settings()
    checks = [
        _check(
            "inbound_webhook",
            "ok" if platform.resend_webhook_secret else "fail",
            fail_state="setup_required",
        ),
        _check(
            "outbound_key",
            "ok" if platform.resend_api_key else "warn",
        ),
        _check(
            "forwarding",
            "ok" if ctx.last_event_at else "pending",
            detail=_iso(ctx.last_event_at) or "",
        ),
    ]
    return ChannelFacts(
        capabilities=("receive", "send"),
        checks=checks,
        actions=["copy_address", "pause", "archive"],
    )


def _resolve_email_mailbox(ctx: ChannelContext) -> ChannelFacts:
    """Connected Gmail/Outlook/SMTP-IMAP mailbox: receives, sends, and polls folders."""
    from app.services.email_sync import account_sync_folders

    # SMTP/IMAP V1 only syncs INBOX — account_sync_folders narrows to it.
    selected = [
        f
        for f in account_sync_folders(ctx.settings, provider=ctx.account.provider)
        if f.get("is_selected")
    ]
    last_sync = _parse_dt(ctx.settings.get("last_sync_at"))
    try:
        error_count = int(ctx.settings.get("sync_error_count") or 0)
    except (TypeError, ValueError):
        error_count = 0

    # The `mock` provider is the explicit Dev mailbox stand-in when OAuth env is
    # missing (dev only). Production refuses mock seed; UI hides mock rows.
    # smtp_imap is connected when username+password+verified_at are present.
    connected = ctx.has_token or ctx.account.provider == "mock"

    last_error_lower = ctx.last_error.lower()
    network_fail = "network" in last_error_lower or "unreachable" in last_error_lower

    checks = [
        _check(
            "credentials",
            "ok" if connected else "fail",
            action="reconnect",
            detail=(
                "Could not reach the mail server. Check host, port, and firewall."
                if network_fail and connected
                else ""
            ),
            fail_state="action_required" if network_fail else "action_required",
        ),
        _check(
            "folders",
            "ok" if selected else "warn",
            detail=", ".join(str(f.get("display_name") or f.get("id")) for f in selected),
        ),
    ]
    if not connected:
        sync_state, sync_detail = "na", ""
    elif last_sync is None:
        sync_state, sync_detail = "pending", ""
    elif ctx.now - last_sync > STALE_SYNC_AFTER:
        sync_state, sync_detail = "warn", _iso(last_sync) or ""
    else:
        sync_state, sync_detail = "ok", _iso(last_sync) or ""
    checks.append(_check("last_sync", sync_state, detail=sync_detail, action="retry_sync"))

    if ctx.last_error:
        checks.append(
            _check(
                "sync_errors",
                "fail" if error_count >= SYNC_ERROR_LIMIT or network_fail else "warn",
                detail=str(ctx.settings.get("auto_paused_reason") or ctx.last_error),
                action="retry_sync" if not network_fail else "reconnect",
                fail_state="action_required" if network_fail else "error",
            )
        )
    else:
        checks.append(_check("sync_errors", "ok"))

    # Manual sync is not a day-to-day control — only offer retry when broken.
    sync_broken = bool(ctx.last_error) or sync_state in ("pending", "warn", "fail")
    actions = ["reconnect", "pause", "archive"]
    if sync_broken and connected:
        actions.insert(0, "retry_sync")

    return ChannelFacts(
        capabilities=("receive", "send", "sync"),
        checks=checks,
        actions=actions,
    )


def _resolve_widget(ctx: ChannelContext) -> ChannelFacts:
    """Website chat: always reachable once embedded, no credentials to expire."""
    checks = [
        _check(
            "installed",
            "ok" if ctx.last_event_at else "pending",
            detail=_iso(ctx.last_event_at) or "",
        )
    ]
    return ChannelFacts(
        capabilities=("receive", "send"),
        checks=checks,
        actions=["pause", "configure"],
        configure_href="",
    )


def _resolve_whatsapp(ctx: ChannelContext) -> ChannelFacts:
    checks = [
        _check("credentials", "ok" if ctx.has_token else "fail", action="reconnect"),
        _check(
            "phone_number",
            "ok" if str(ctx.account.address or "").strip() else "fail",
            fail_state="setup_required",
        ),
        _check(
            "webhook",
            "ok" if ctx.last_event_at else "pending",
            detail=_iso(ctx.last_event_at) or "",
        ),
    ]
    return ChannelFacts(
        capabilities=("receive", "send"),
        checks=checks,
        actions=["reconnect", "pause", "archive"],
    )


def _resolve_slack(ctx: ChannelContext) -> ChannelFacts:
    checks = [
        _check(
            "bot_token",
            "ok" if ctx.credentials.get("bot_token") else "fail",
            action="reconnect",
        ),
        _check(
            "signing_secret",
            "ok" if ctx.credentials.get("signing_secret") else "warn",
        ),
        _check(
            "events",
            "ok" if ctx.last_event_at else "pending",
            detail=_iso(ctx.last_event_at) or "",
        ),
    ]
    return ChannelFacts(
        capabilities=("receive", "send"),
        checks=checks,
        actions=["reconnect", "pause", "archive"],
    )


_RESOLVERS: dict[str, Callable[[ChannelContext], ChannelFacts]] = {
    "email_relay": _resolve_email_relay,
    "email_mailbox": _resolve_email_mailbox,
    "widget": _resolve_widget,
    "whatsapp": _resolve_whatsapp,
    "slack": _resolve_slack,
}


def _fallback_facts(ctx: ChannelContext) -> ChannelFacts:
    return ChannelFacts(capabilities=("receive",), checks=[], actions=["pause", "archive"])


def _derive_state(ctx: ChannelContext, facts: ChannelFacts) -> tuple[str, str]:
    """State + the check id that explains it."""
    if ctx.account.archived_at is not None:
        return "archived", ""
    if not ctx.account.is_enabled:
        # Paused by the platform after repeated sync failures, not by a person.
        return "paused", "sync_errors" if ctx.settings.get("auto_paused_at") else ""
    failed = [c for c in facts.checks if c["state"] == "fail"]
    if failed:
        for state in _FAIL_PRIORITY:
            match = next((c for c in failed if c["fail_state"] == state), None)
            if match:
                return state, match["id"]
        return "action_required", failed[0]["id"]
    warned = [c for c in facts.checks if c["state"] == "warn"]
    if warned:
        return "degraded", warned[0]["id"]
    if "sync" in facts.capabilities:
        pending_sync = next(
            (c for c in facts.checks if c["id"] == "last_sync" and c["state"] == "pending"),
            None,
        )
        if pending_sync:
            return "connecting", pending_sync["id"]
    return "active", ""


def resolve_channel(
    account: ChannelAccount,
    *,
    tenant: Tenant | None = None,
    last_event_at: datetime | None = None,
    now: datetime | None = None,
    widget_count: int | None = None,
) -> dict[str, Any]:
    """One uniform row for any channel kind: state, capabilities, checks, actions."""
    from app.services.ai_handling import breaker_tripped_at, resolve_ai_handling
    from app.services.channel_access import account_access, is_default_access
    from app.services.crypto import credentials_ready_from_settings, get_connection_credentials
    from app.services.email_sync import account_archives_automated_mail, account_sync_window_days

    settings = _loads(account.settings_json)
    # Skip decrypt on list paths when settings already stamp connected readiness.
    ready = credentials_ready_from_settings(settings)
    credentials = {} if ready is not None else get_connection_credentials(account)
    ctx = ChannelContext(
        account=account,
        settings=settings,
        credentials=credentials,
        tenant=tenant,
        last_event_at=last_event_at,
        now=now or datetime.utcnow(),
    )
    kind = channel_kind(account)
    facts = _RESOLVERS.get(kind, _fallback_facts)(ctx)
    state, reason = _derive_state(ctx, facts)
    archived = account.archived_at is not None
    if archived:
        # Nothing runs on an archived channel; its checks would only alarm.
        facts.checks = []
        actions = ["restore", "delete"]
    else:
        actions = list(facts.actions)
        if not account.is_enabled:
            actions = ["resume" if a == "pause" else a for a in actions]
        if kind == "widget" and widget_count is not None and widget_count > 1 and "archive" not in actions:
            actions.append("archive")

    # The widget's address is the internal tenant key, not something an
    # operator shares or copies, so the row keeps it out of the UI.
    address = "" if kind == "widget" else account.address

    return {
        "id": str(account.id),
        "channel": account.channel,
        "kind": kind,
        "provider": account.provider,
        "address": address,
        "display_name": account.display_name or account.address,
        "label": str(settings.get("label") or "") or account.display_name or account.address,
        "is_enabled": account.is_enabled,
        "is_primary": bool(settings.get("is_primary")),
        "state": state,
        "state_reason": reason,
        "capabilities": list(facts.capabilities),
        "checks": [
            {k: v for k, v in check.items() if k != "fail_state"} for check in facts.checks
        ],
        "actions": actions,
        "configure_href": facts.configure_href or f"/settings/channels/{account.id}",
        "last_event_at": _iso(last_event_at),
        "last_sync_at": _iso(settings.get("last_sync_at")),
        "last_error": ctx.last_error,
        "ai_handling": {
            **resolve_ai_handling(tenant, account, scope="channel").to_payload(),
            "breaker_tripped_at": breaker_tripped_at(account),
        },
        "default_agent_id": str(account.default_agent_id) if account.default_agent_id else None,
        "default_team_id": (settings.get("routing") or {}).get("team_id")
        if isinstance(settings.get("routing"), dict)
        else None,
        "access": account_access(account),
        "access_is_default": is_default_access(account),
        "created_at": account.created_at.isoformat(),
        "sync_window_days": account_sync_window_days(settings),
        "archive_automated_mail": account_archives_automated_mail(settings),
        "archived_at": _iso(account.archived_at),
    }


def can_send(row: dict[str, Any]) -> bool:
    """Whether a resolved row may deliver outbound messages right now."""
    return "send" in row.get("capabilities", []) and row.get("state") in (
        "active",
        "degraded",
        "connecting",
    )


def can_receive(row: dict[str, Any]) -> bool:
    """Whether a resolved row may accept inbound messages right now."""
    state = row.get("state")
    if state in ("paused", "error", "setup_required", "action_required", "archived"):
        return False
    return "receive" in row.get("capabilities", [])


def channel_summary(row: dict[str, Any]) -> str:
    """Operator-facing bucket shared by Setup, Connections, Kanalen, composer."""
    state = row.get("state") or ""
    if can_send(row) or (can_receive(row) and state in ("active", "degraded", "connecting")):
        return "ready"
    if state == "paused":
        return "paused"
    if state == "error":
        return "broken"
    if state in ("action_required", "degraded"):
        return "action"
    return "setup"


def to_channel_status(row: dict[str, Any]) -> dict[str, Any]:
    """Thin DTO every product surface reads for channel truth."""
    return {
        "id": row.get("id"),
        "kind": row.get("kind") or "",
        "channel": row.get("channel") or "",
        "provider": row.get("provider") or "",
        "address": row.get("address") or "",
        "display_name": row.get("display_name") or row.get("address") or "",
        "is_enabled": bool(row.get("is_enabled")),
        "state": row.get("state") or "setup_required",
        "state_reason": row.get("state_reason") or "",
        "can_send": can_send(row),
        "can_receive": can_receive(row),
        "summary": channel_summary(row),
    }


def account_can_send(
    account: ChannelAccount | None,
    *,
    tenant: Tenant | None = None,
) -> bool:
    """Whether this ChannelAccount may deliver outbound messages right now.

    Same rule the dashboard composer uses via ``can_send`` on a resolved row.
    Missing or disabled accounts cannot send.
    """
    if account is None or not account.is_enabled:
        return False
    return can_send(resolve_channel(account, tenant=tenant))


def legacy_status_from_row(row: dict[str, Any]) -> str:
    """Map registry state to the old email status vocabulary for older clients."""
    state = row.get("state") or ""
    if state == "paused":
        return "paused"
    if state == "error":
        return "error"
    if state in ("action_required", "setup_required"):
        return "needs_auth"
    if can_send(row) or state in ("active", "degraded", "connecting"):
        return "connected"
    return "needs_auth"


async def last_event_by_account(
    session: Any, tenant_id: UUID
) -> dict[UUID, datetime]:
    """Newest thread activity per channel account (batched for the list view)."""
    from sqlalchemy import func, select

    from app.models.signal import Signal

    result = await session.execute(
        select(Signal.channel_account_id, func.max(Signal.last_message_at))
        .where(
            Signal.tenant_id == tenant_id,
            Signal.channel_account_id.is_not(None),
        )
        .group_by(Signal.channel_account_id)
    )
    out: dict[UUID, datetime] = {}
    for account_id, last_at in result.all():
        parsed = _parse_dt(last_at)
        if account_id and parsed:
            out[account_id] = parsed
    return out


async def list_channels(
    session: Any,
    tenant: Tenant,
    *,
    user_id: UUID,
    role: str,
) -> list[dict[str, Any]]:
    """Every configurable channel of a tenant as uniform rows."""
    from sqlalchemy import select

    from app.services.channel_access import visible_channel_account_ids

    result = await session.execute(
        select(ChannelAccount)
        .where(ChannelAccount.tenant_id == tenant.id)
        .order_by(ChannelAccount.channel, ChannelAccount.created_at)
    )
    visible = await visible_channel_account_ids(session, tenant.id, user_id=user_id, role=role)
    accounts = [
        a
        for a in result.scalars().all()
        if is_configurable_channel(a) and (visible is None or a.id in visible)
    ]
    events = await last_event_by_account(session, tenant.id)
    now = datetime.utcnow()
    widget_count = sum(1 for account in accounts if account.channel == "widget")
    return [
        resolve_channel(
            account,
            tenant=tenant,
            last_event_at=events.get(account.id),
            now=now,
            widget_count=widget_count,
        )
        for account in accounts
    ]
