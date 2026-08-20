"""Email channel API backed by ChannelAccount + the unified Signal model."""

import json
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels import deliver_outbound
from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth, require_verified_email
from app.middleware.rate_limit import rate_limit
from app.models.auth import user_numeric_id
from app.models.channel import ChannelAccount
from app.models.email_routing import ROUTING_CONDITION_TYPES, EmailRoutingRule
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.integrations_platform import ensure_email_account, mock_authorize_url
from app.services.oauth_flow import start_real_oauth
from app.services.signals import create_inbound_signal
from app.workers.tasks import enqueue_signal_processing

router = APIRouter(prefix="/email", tags=["email"])


class SendEmailRequest(BaseModel):
    """Compose payload from the dashboard.

    Supports replying to an existing thread (`thread_id`) or starting a new
    outbound email thread (`to_addresses` + `connection_id`).
    """

    body_text: str
    thread_id: UUID | None = None
    connection_id: int | None = None
    to_addresses: str | None = None
    cc: str | None = None
    bcc: str | None = None
    subject: str | None = None
    body_html: str | None = None
    in_reply_to: str | None = None
    attachments: list[Any] | None = None


class MockInboundEmail(BaseModel):
    from_address: str
    subject: str
    body_text: str


def _load_settings(account: ChannelAccount) -> dict[str, Any]:
    try:
        data = json.loads(account.settings_json or "{}")
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _sync_window_days(settings: dict[str, Any]) -> int:
    from app.services.email_sync import account_sync_window_days

    return account_sync_window_days(settings)


def _has_access_token(account: ChannelAccount) -> bool:
    try:
        creds = json.loads(account.credentials_json or "{}")
    except (json.JSONDecodeError, TypeError):
        return False
    return bool(isinstance(creds, dict) and creds.get("access_token"))


def _connection_status(account: ChannelAccount) -> str:
    """Derive UI status from enablement + real credentials (not is_enabled alone)."""
    settings = _load_settings(account)
    if settings.get("last_error") and _has_access_token(account) and account.is_enabled:
        return "error"
    if not account.is_enabled:
        return "paused"
    if not _has_access_token(account):
        return "needs_auth"
    return "connected"


def _serialize_connection(account: ChannelAccount, *, is_primary: bool) -> dict[str, Any]:
    settings = _load_settings(account)
    # Never coerce mock/unknown to gmail — only real OAuth providers are listed.
    provider = account.provider if account.provider in ("gmail", "outlook") else account.provider
    return {
        # Numeric id matches the `email_connection_id` filter on /api/signals.
        "id": user_numeric_id(account.id),
        "uuid": str(account.id),
        "email_address": account.address,
        "mailbox_email": account.address,
        "display_name": account.display_name or account.address,
        "provider": provider,
        "is_enabled": account.is_enabled,
        "is_primary": bool(settings.get("is_primary", is_primary)),
        "signature_html": settings.get("signature_html"),
        "last_sync_at": settings.get("last_sync_at"),
        "last_error": settings.get("last_error"),
        "sync_window_days": _sync_window_days(settings),
        "status": _connection_status(account),
        # Backward-compatible alias used by older clients that only know active/revoked.
        "legacy_status": "active" if account.is_enabled and _has_access_token(account) else "revoked",
    }


async def _list_email_accounts(session: AsyncSession, tenant_id: UUID) -> list[ChannelAccount]:
    result = await session.execute(
        select(ChannelAccount)
        .where(ChannelAccount.tenant_id == tenant_id, ChannelAccount.channel == "email")
        .order_by(ChannelAccount.created_at)
    )
    # Hide phantom seed/mock rows — settings only show connectable providers.
    return [
        a
        for a in result.scalars().all()
        if a.provider in ("gmail", "outlook")
    ]


async def _get_account_by_numeric(
    session: AsyncSession, tenant_id: UUID, connection_id: int
) -> ChannelAccount | None:
    for account in await _list_email_accounts(session, tenant_id):
        if user_numeric_id(account.id) == connection_id:
            return account
    return None


@router.get("/accounts")
async def list_accounts(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    accounts = await _list_email_accounts(session, auth.tenant.id)
    explicit_primary = any(_load_settings(a).get("is_primary") for a in accounts)
    return [
        _serialize_connection(a, is_primary=(not explicit_primary and index == 0))
        for index, a in enumerate(accounts)
    ]


def _parse_addresses(raw: str | None) -> list[str]:
    if not raw:
        return []
    parts = [p.strip() for chunk in raw.split(",") for p in chunk.split(";")]
    return [p for p in parts if p]


async def _resolve_email_account(
    session: AsyncSession, tenant_id: UUID, connection_id: int | None
) -> ChannelAccount | None:
    """Resolve a ChannelAccount from the numeric id the dashboard exposes."""
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.tenant_id == tenant_id, ChannelAccount.channel == "email"
        )
    )
    accounts = list(result.scalars().all())
    if connection_id is not None:
        for account in accounts:
            if user_numeric_id(account.id) == connection_id:
                return account
    # Fall back to the first enabled account so replies still work without a
    # connection hint.
    for account in accounts:
        if account.is_enabled:
            return account
    return accounts[0] if accounts else None


@router.post("/send")
async def send_email(
    body: SendEmailRequest,
    # Outbound mail requires a verified sender (soft gate).
    auth: Annotated[AuthContext, Depends(require_verified_email)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    now = datetime.utcnow()
    to_addresses = _parse_addresses(body.to_addresses)

    if body.thread_id is not None:
        thread_result = await session.execute(
            select(Signal).where(
                Signal.id == body.thread_id,
                Signal.tenant_id == auth.tenant.id,
                Signal.channel == "email",
            )
        )
        signal = thread_result.scalar_one_or_none()
        if not signal:
            raise HTTPException(status_code=404, detail="Thread not found")
        account = None
        if signal.channel_account_id:
            account_result = await session.execute(
                select(ChannelAccount).where(
                    ChannelAccount.id == signal.channel_account_id,
                    ChannelAccount.tenant_id == auth.tenant.id,
                )
            )
            account = account_result.scalar_one_or_none()
        if account is None and body.connection_id is not None:
            # Deliberate mailbox choice: rebind the orphaned thread so this
            # and future replies go out via the selected mailbox.
            candidate = await _resolve_email_account(session, auth.tenant.id, body.connection_id)
            if candidate is not None and user_numeric_id(candidate.id) == body.connection_id:
                account = candidate
                signal.channel_account_id = account.id
                session.add(signal)
        if account is None:
            # The thread's mailbox was disconnected; never fall back to a
            # random other mailbox or pretend the message was sent.
            raise HTTPException(
                status_code=409,
                detail="The mailbox for this conversation is disconnected. Reconnect it under Settings > Channels to reply.",
            )
        if not account.is_enabled:
            raise HTTPException(
                status_code=409,
                detail="The mailbox for this conversation is disabled. Enable it under Settings > Channels to reply.",
            )
        recipients = to_addresses or ([signal.contact_email] if signal.contact_email else [])
    else:
        if not to_addresses:
            raise HTTPException(status_code=400, detail="Recipient required for a new email")
        account = await _resolve_email_account(session, auth.tenant.id, body.connection_id)
        if account is None:
            raise HTTPException(status_code=400, detail="No email account configured")
        signal = Signal(
            tenant_id=auth.tenant.id,
            channel="email",
            source=account.provider,
            subject=body.subject or "(No subject)",
            contact_email=to_addresses[0],
            contact_name="",
            channel_account_id=account.id,
            status="open",
            priority="normal",
            has_unread=False,
            last_message_at=now,
        )
        session.add(signal)
        await session.flush()
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=auth.tenant.id,
                event_type="signal_created",
                actor_type="user",
            )
        )
        recipients = to_addresses

    attachments = [a for a in (body.attachments or []) if isinstance(a, dict)]
    send_status = await deliver_outbound(
        session,
        signal,
        body_text=body.body_text,
        subject=body.subject or signal.subject,
        body_html=body.body_html,
        # All requested recipients, not just the thread contact.
        to_address=", ".join(recipients) if recipients else None,
        cc=body.cc,
        bcc=body.bcc,
        attachments=attachments,
    )
    if send_status == "skipped":
        # Mock/dev accounts skip actual delivery; record as sent for dev UX.
        send_status = "sent"
    if send_status.startswith("failed"):
        # Do not store a message that pretends to be sent: surface the error.
        await session.rollback()
        reason = send_status.removeprefix("failed:").replace("_", " ").strip() or "provider error"
        raise HTTPException(status_code=502, detail=f"Sending failed: {reason}")
    message_meta: dict[str, Any] = {}
    if body.cc:
        message_meta["cc"] = body.cc
    if body.bcc:
        message_meta["bcc"] = body.bcc
    msg = SignalMessage(
        signal_id=signal.id,
        tenant_id=auth.tenant.id,
        kind="user_message",
        direction="outbound",
        role="user",
        author_user_id=auth.user.id,
        from_address=account.address if account else "noreply@bokito.ai",
        to_addresses=json.dumps(recipients),
        subject=body.subject or signal.subject,
        body_text=body.body_text,
        body_html=body.body_html or "",
        body_preview=body.body_text[:200],
        attachments_json=json.dumps(attachments),
        metadata_json=json.dumps(message_meta) if message_meta else "{}",
        send_status=send_status,
        received_at=now,
    )
    session.add(msg)
    signal.last_message_at = now
    signal.updated_at = now
    await session.commit()
    await session.refresh(msg)
    return {
        "ok": True,
        "id": str(msg.id),
        "message_id": user_numeric_id(msg.id),
        "thread_id": str(signal.id),
        "status": "sent",
    }


@router.post("/mock/inbound")
async def mock_inbound_email(
    body: MockInboundEmail,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Dev-only: simulate inbound email and trigger AI proposal flow."""
    if get_settings().is_production:
        raise HTTPException(status_code=404, detail="Not available in production")
    account_result = await session.execute(
        select(ChannelAccount)
        .where(
            ChannelAccount.tenant_id == auth.tenant.id,
            ChannelAccount.channel == "email",
        )
        .limit(1)
    )
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=400, detail="No email account configured")
    signal = await create_inbound_signal(
        session,
        auth.tenant.id,
        channel="email",
        source=account.provider,
        subject=body.subject,
        body_text=body.body_text,
        contact_email=body.from_address,
    )
    await enqueue_signal_processing(str(auth.tenant.id), str(signal.id))
    return {"thread_id": str(signal.id), "message_id": str(signal.id), "status": "queued_for_ai"}


# --- Connection management (persisted on ChannelAccount.settings_json) ---


async def _require_account(
    session: AsyncSession, tenant_id: UUID, connection_id: int
) -> ChannelAccount:
    account = await _get_account_by_numeric(session, tenant_id, connection_id)
    if not account:
        raise HTTPException(status_code=404, detail="Email connection not found")
    return account


async def _save_account_settings(
    session: AsyncSession, account: ChannelAccount, updates: dict[str, Any]
) -> dict[str, Any]:
    settings = _load_settings(account)
    settings.update(updates)
    account.settings_json = json.dumps(settings)
    session.add(account)
    await session.commit()
    await session.refresh(account)
    return settings


@router.put("/connections/{connection_id}/mailbox-settings")
async def update_mailbox_settings(
    connection_id: int,
    body: dict,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    account = await _require_account(session, auth.tenant.id, connection_id)
    updates: dict[str, Any] = {}
    if "is_enabled" in body:
        account.is_enabled = bool(body["is_enabled"])
    if "sync_window_days" in body:
        try:
            days = int(body["sync_window_days"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="sync_window_days must be a number")
        if days < 0 or days > 3650:
            raise HTTPException(status_code=400, detail="sync_window_days must be 0-3650")
        updates["sync_window_days"] = days
    if "is_primary" in body:
        is_primary = bool(body.get("is_primary"))
        # Only one primary mailbox per tenant.
        if is_primary:
            for other in await _list_email_accounts(session, auth.tenant.id):
                if other.id != account.id and _load_settings(other).get("is_primary"):
                    await _save_account_settings(session, other, {"is_primary": False})
        updates["is_primary"] = is_primary
    settings = await _save_account_settings(session, account, updates)
    return {
        "ok": True,
        "is_enabled": account.is_enabled,
        "is_primary": bool(settings.get("is_primary")),
        "sync_window_days": _sync_window_days(settings),
    }


@router.put("/connections/{connection_id}/signature")
async def save_signature(
    connection_id: int,
    body: dict,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    account = await _require_account(session, auth.tenant.id, connection_id)
    signature_html = str(body.get("signature_html", ""))
    await _save_account_settings(session, account, {"signature_html": signature_html})
    return {"ok": True, "signature_html": signature_html}


@router.get("/connections/{connection_id}/signature")
async def get_signature(
    connection_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    account = await _require_account(session, auth.tenant.id, connection_id)
    return {"signature_html": _load_settings(account).get("signature_html") or ""}


class FolderSelection(BaseModel):
    id: str
    display_name: str = ""
    is_selected: bool = True


class UpdateFoldersRequest(BaseModel):
    folders: list[FolderSelection]


@router.get("/connections/{connection_id}/folders")
async def list_connection_folders(
    connection_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.email_sync import account_sync_folders

    account = await _require_account(session, auth.tenant.id, connection_id)
    settings = _load_settings(account)
    last_sync_at = settings.get("last_sync_at")
    folders = []
    for folder in account_sync_folders(settings):
        selected = bool(folder.get("is_selected"))
        folders.append(
            {
                "id": str(folder.get("id") or ""),
                "display_name": str(folder.get("display_name") or folder.get("id") or ""),
                "is_selected": selected,
                "last_sync_at": last_sync_at if selected and folder.get("id") == "inbox" else None,
            }
        )
    return {"folders": folders}


@router.put("/connections/{connection_id}/folders")
async def update_connection_folders(
    connection_id: int,
    body: UpdateFoldersRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    account = await _require_account(session, auth.tenant.id, connection_id)
    if not body.folders:
        raise HTTPException(status_code=400, detail="Provide at least one folder")
    if not any(f.is_selected for f in body.folders):
        raise HTTPException(status_code=400, detail="Select at least one folder to sync")
    selection = [
        {"id": f.id, "display_name": f.display_name or f.id, "is_selected": f.is_selected}
        for f in body.folders
        if f.id
    ]
    await _save_account_settings(session, account, {"sync_folders": selection})
    return {"ok": True, "folders": selection}


@router.delete("/connections/{connection_id}")
async def disconnect_email_connection(
    connection_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    account = await _require_account(session, auth.tenant.id, connection_id)
    address = account.address
    provider = account.provider
    # Postgres enforces the FK constraints on channel_accounts.id, so first
    # detach threads (conversation history stays) and remove per-mailbox
    # config rows that hard-reference this account.
    from sqlalchemy import delete as sa_delete, update as sa_update

    from app.models.channel import ChannelBinding

    await session.execute(
        sa_update(Signal)
        .where(Signal.channel_account_id == account.id)
        .values(channel_account_id=None)
    )
    await session.execute(
        sa_delete(EmailRoutingRule).where(EmailRoutingRule.channel_account_id == account.id)
    )
    await session.execute(
        sa_delete(ChannelBinding).where(ChannelBinding.channel_account_id == account.id)
    )
    await session.delete(account)
    await session.commit()
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="email:mailbox_disconnected",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="channel_account",
        resource_id=connection_id,
        payload={"address": address, "provider": provider},
    )
    return {"ok": True}


@router.get("/connections/{connection_id}/ai-config")
async def get_ai_config(
    connection_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    account = await _require_account(session, auth.tenant.id, connection_id)
    settings = _load_settings(account)
    ai_config = settings.get("ai_config") if isinstance(settings.get("ai_config"), dict) else {}
    return {"ai_config": ai_config}


@router.put("/connections/{connection_id}/ai-config")
async def save_ai_config(
    connection_id: int,
    body: dict,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    account = await _require_account(session, auth.tenant.id, connection_id)
    ai_config = body.get("ai_config")
    if not isinstance(ai_config, dict):
        raise HTTPException(status_code=400, detail="ai_config object required")
    reply_language = ai_config.get("reply_language")
    if reply_language is not None:
        from app.services.language import REPLY_LANGUAGE_CHOICES

        # Empty string means "use the tenant default" — drop the override.
        if reply_language == "":
            ai_config.pop("reply_language", None)
        elif reply_language not in REPLY_LANGUAGE_CHOICES:
            raise HTTPException(status_code=400, detail="Invalid reply_language")
    await _save_account_settings(session, account, {"ai_config": ai_config})
    return {"ok": True, "ai_config": ai_config}


# --- Routing rules (deterministic inbound assignment/labeling) ---


class RoutingRuleBody(BaseModel):
    mailbox_id: int | None = None
    priority: int = 100
    condition_type: str = "sender_domain"
    condition_value: str = ""
    assign_to_user_id: int | None = None
    labels: list[str] | None = None
    is_active: bool = True


class RoutingRulePatch(BaseModel):
    priority: int | None = None
    condition_type: str | None = None
    condition_value: str | None = None
    assign_to_user_id: int | None = None
    labels: list[str] | None = None
    is_active: bool | None = None


def _serialize_rule(rule: EmailRoutingRule, mailbox_id: int) -> dict[str, Any]:
    try:
        labels = json.loads(rule.labels_json or "[]")
    except (json.JSONDecodeError, TypeError):
        labels = []
    return {
        "id": user_numeric_id(rule.id),
        "mailbox_id": mailbox_id,
        "priority": rule.priority,
        "condition_type": rule.condition_type,
        "condition_value": rule.condition_value,
        "assign_to_user_id": rule.assign_to_user_id,
        "labels": labels if isinstance(labels, list) else [],
        "is_active": rule.is_active,
        "created_at": rule.created_at.isoformat(),
        "updated_at": rule.updated_at.isoformat(),
    }


async def _get_rule_by_numeric(
    session: AsyncSession, tenant_id: UUID, rule_id: int
) -> EmailRoutingRule | None:
    result = await session.execute(
        select(EmailRoutingRule).where(EmailRoutingRule.tenant_id == tenant_id)
    )
    for rule in result.scalars().all():
        if user_numeric_id(rule.id) == rule_id:
            return rule
    return None


@router.get("/routing-rules")
async def list_routing_rules(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    mailbox_id: int | None = None,
):
    account = None
    if mailbox_id is not None:
        account = await _get_account_by_numeric(session, auth.tenant.id, mailbox_id)
        if not account:
            return {"items": []}
    stmt = select(EmailRoutingRule).where(EmailRoutingRule.tenant_id == auth.tenant.id)
    if account is not None:
        stmt = stmt.where(EmailRoutingRule.channel_account_id == account.id)
    stmt = stmt.order_by(EmailRoutingRule.priority)
    result = await session.execute(stmt)
    rules = list(result.scalars().all())
    numeric_cache: dict[UUID, int] = {}
    items = []
    for rule in rules:
        if rule.channel_account_id not in numeric_cache:
            numeric_cache[rule.channel_account_id] = user_numeric_id(rule.channel_account_id)
        items.append(_serialize_rule(rule, numeric_cache[rule.channel_account_id]))
    return {"items": items}


@router.post("/routing-rules")
async def create_routing_rule(
    body: RoutingRuleBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if body.mailbox_id is None:
        raise HTTPException(status_code=400, detail="mailbox_id required")
    account = await _get_account_by_numeric(session, auth.tenant.id, body.mailbox_id)
    if not account:
        raise HTTPException(status_code=404, detail="Mailbox not found")
    if body.condition_type not in ROUTING_CONDITION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid condition_type")
    rule = EmailRoutingRule(
        tenant_id=auth.tenant.id,
        channel_account_id=account.id,
        priority=body.priority,
        condition_type=body.condition_type,
        condition_value=body.condition_value.strip(),
        assign_to_user_id=body.assign_to_user_id,
        labels_json=json.dumps(body.labels or []),
        is_active=body.is_active,
    )
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return _serialize_rule(rule, body.mailbox_id)


@router.patch("/routing-rules/{rule_id}")
async def update_routing_rule(
    rule_id: int,
    body: RoutingRulePatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    rule = await _get_rule_by_numeric(session, auth.tenant.id, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Routing rule not found")
    if body.priority is not None:
        rule.priority = body.priority
    if body.condition_type is not None:
        if body.condition_type not in ROUTING_CONDITION_TYPES:
            raise HTTPException(status_code=400, detail="Invalid condition_type")
        rule.condition_type = body.condition_type
    if body.condition_value is not None:
        rule.condition_value = body.condition_value.strip()
    if body.assign_to_user_id is not None:
        rule.assign_to_user_id = body.assign_to_user_id
    if body.labels is not None:
        rule.labels_json = json.dumps(body.labels)
    if body.is_active is not None:
        rule.is_active = body.is_active
    rule.updated_at = datetime.utcnow()
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return _serialize_rule(rule, user_numeric_id(rule.channel_account_id))


@router.delete("/routing-rules/{rule_id}")
async def delete_routing_rule(
    rule_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    rule = await _get_rule_by_numeric(session, auth.tenant.id, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Routing rule not found")
    await session.delete(rule)
    await session.commit()
    return {"ok": True}


# --- Inbound sync (poll connected Gmail/Outlook mailboxes) ---


@router.post("/sync", dependencies=[Depends(rate_limit("email-sync", limit=6))])
async def sync_all_mailboxes(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Poll all connected mailboxes for this tenant and ingest new messages."""
    from app.services.email_sync import sync_tenant

    results = await sync_tenant(session, auth.tenant.id)
    return {"results": results, "synced": sum(r.get("synced", 0) for r in results)}


# --- Email OAuth (mock redirect back to dashboard; served at /api/email/*) ---


async def _email_oauth_response(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    provider: str,
    return_url: str,
    email: str,
) -> dict[str, str]:
    # Real provider OAuth when configured; otherwise the dev mock flow that
    # creates a local mailbox and redirects straight back with success params.
    real_url = await start_real_oauth(
        session,
        tenant_id=tenant_id,
        user_id=user_id,
        provider=provider,
        flow="email",
        return_url=return_url,
    )
    if real_url:
        return {"authorize_url": real_url}
    if get_settings().is_production:
        raise HTTPException(
            status_code=503,
            detail=f"OAuth for {provider} is not configured on this server.",
        )
    # Dev-only mock connect: seed placeholder credentials so the mailbox shows
    # as connected in the UI (sync/send recognize the mock flag and skip the
    # real provider APIs).
    await ensure_email_account(
        session, tenant_id, provider, email, seed_mock_credentials=True
    )
    return {
        "authorize_url": mock_authorize_url(
            return_url, {"oauth_provider": provider, "oauth_status": "connected"}
        )
    }


@router.get("/oauth/start")
async def email_oauth_start(
    # Connecting a mailbox requires a verified account (soft gate).
    auth: Annotated[AuthContext, Depends(require_verified_email)],
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: str,
    return_url: str,
):
    if provider not in ("outlook", "gmail"):
        raise HTTPException(status_code=400, detail="Unsupported email provider")
    email = auth.user.email or f"{provider}@bokito.local"
    return await _email_oauth_response(
        session, auth.tenant.id, auth.user.id, provider, return_url, email
    )


@router.get("/outlook/oauth/start")
async def outlook_oauth_start(
    auth: Annotated[AuthContext, Depends(require_verified_email)],
    session: Annotated[AsyncSession, Depends(get_session)],
    return_url: str,
):
    email = auth.user.email or "outlook@bokito.local"
    return await _email_oauth_response(
        session, auth.tenant.id, auth.user.id, "outlook", return_url, email
    )


@router.get("/google/oauth/start")
async def google_oauth_start(
    auth: Annotated[AuthContext, Depends(require_verified_email)],
    session: Annotated[AsyncSession, Depends(get_session)],
    return_url: str,
):
    email = auth.user.email or "gmail@bokito.local"
    return await _email_oauth_response(
        session, auth.tenant.id, auth.user.id, "gmail", return_url, email
    )
