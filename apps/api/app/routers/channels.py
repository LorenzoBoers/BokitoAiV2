"""Channel management API: accounts, contacts (pairing), inbound webhooks."""

import json
import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels import ingest_inbound
from app.channels import email as email_adapter
from app.channels import slack as slack_adapter
from app.channels.base import BlockedContactError, account_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.channel import CHANNEL_ACCOUNT_CHANNELS, CONTACT_STATUSES, ChannelAccount, Contact
from app.workers.tasks import enqueue_signal_processing

router = APIRouter(prefix="/channels", tags=["channels"])


# ── accounts ─────────────────────────────────────────────────────────


class AccountCreateBody(BaseModel):
    channel: str
    provider: str = "mock"
    address: str = ""
    display_name: str = ""
    credentials: dict = {}
    require_pairing: bool = False


def _serialize_account(row: ChannelAccount) -> dict:
    settings = account_settings(row)
    return {
        "id": str(row.id),
        "channel": row.channel,
        "provider": row.provider,
        "address": row.address,
        "display_name": row.display_name,
        "is_enabled": row.is_enabled,
        "require_pairing": bool(settings.get("require_pairing")),
        "has_inbound_secret": bool(settings.get("inbound_secret")),
        "created_at": row.created_at.isoformat(),
    }


@router.get("/accounts")
async def list_accounts(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(ChannelAccount)
        .where(ChannelAccount.tenant_id == auth.tenant.id)
        .order_by(ChannelAccount.channel, ChannelAccount.created_at)
    )
    return {"accounts": [_serialize_account(a) for a in result.scalars().all()]}


@router.post("/accounts")
async def create_account(
    body: AccountCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if body.channel not in CHANNEL_ACCOUNT_CHANNELS:
        raise HTTPException(status_code=400, detail=f"Invalid channel: {body.channel}")
    inbound_secret = secrets.token_urlsafe(24)
    account = ChannelAccount(
        tenant_id=auth.tenant.id,
        channel=body.channel,
        provider=body.provider,
        address=body.address,
        display_name=body.display_name,
        credentials_json=json.dumps(body.credentials or {}),
        settings_json=json.dumps(
            {"require_pairing": body.require_pairing, "inbound_secret": inbound_secret}
        ),
    )
    session.add(account)
    await session.commit()
    await session.refresh(account)
    data = _serialize_account(account)
    # Revealed once so the caller can configure the provider webhook.
    data["inbound_secret"] = inbound_secret
    return data


@router.delete("/accounts/{account_id}")
async def delete_account(
    account_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.id == account_id, ChannelAccount.tenant_id == auth.tenant.id
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    await session.delete(account)
    await session.commit()
    return {"ok": True}


# ── contacts (pairing / allowlist) ───────────────────────────────────


class ContactUpdateBody(BaseModel):
    status: str


def _serialize_contact(row: Contact) -> dict:
    return {
        "id": str(row.id),
        "channel": row.channel,
        "address": row.address,
        "display_name": row.display_name,
        "status": row.status,
        "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
        "created_at": row.created_at.isoformat(),
    }


@router.get("/contacts")
async def list_contacts(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str | None = None,
    channel: str | None = None,
):
    stmt = select(Contact).where(Contact.tenant_id == auth.tenant.id)
    if status:
        stmt = stmt.where(Contact.status == status)
    if channel:
        stmt = stmt.where(Contact.channel == channel)
    stmt = stmt.order_by(Contact.last_seen_at.desc()).limit(200)
    result = await session.execute(stmt)
    return {"contacts": [_serialize_contact(c) for c in result.scalars().all()]}


@router.patch("/contacts/{contact_id}")
async def update_contact(
    contact_id: UUID,
    body: ContactUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if body.status not in CONTACT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
    result = await session.execute(
        select(Contact).where(Contact.id == contact_id, Contact.tenant_id == auth.tenant.id)
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    contact.status = body.status
    session.add(contact)
    await session.commit()
    return _serialize_contact(contact)


# ── inbound webhooks (public, secret-authenticated) ──────────────────


async def _account_or_404(session: AsyncSession, account_id: UUID) -> ChannelAccount:
    result = await session.execute(select(ChannelAccount).where(ChannelAccount.id == account_id))
    account = result.scalar_one_or_none()
    if not account or not account.is_enabled:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.post("/email/inbound/{account_id}")
async def email_inbound(
    account_id: UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    x_bokito_secret: Annotated[str | None, Header()] = None,
):
    """Provider-agnostic inbound email webhook (Gmail/Outlook push relays)."""
    account = await _account_or_404(session, account_id)
    secret = account_settings(account).get("inbound_secret", "")
    if not secret or (x_bokito_secret or "") != secret:
        raise HTTPException(status_code=403, detail="Invalid secret")
    payload = await request.json()
    inbound = email_adapter.normalize_inbound(payload, account)
    if not inbound.sender_address or not inbound.body_text:
        return {"ok": False, "reason": "missing sender or body"}
    try:
        signal, should_process = await ingest_inbound(session, account.tenant_id, inbound)
    except BlockedContactError:
        return {"ok": True, "dropped": "blocked_contact"}
    if should_process:
        await enqueue_signal_processing(str(account.tenant_id), str(signal.id))
    return {"ok": True, "signal_id": str(signal.id), "processing": should_process}


@router.post("/slack/events/{account_id}")
async def slack_events(
    account_id: UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    x_slack_request_timestamp: Annotated[str | None, Header()] = None,
    x_slack_signature: Annotated[str | None, Header()] = None,
):
    """Slack Events API endpoint (per channel account)."""
    body = await request.body()
    payload = json.loads(body or "{}")

    # URL verification handshake happens before signing can be configured-checked.
    if payload.get("type") == "url_verification":
        return {"challenge": payload.get("challenge", "")}

    account = await _account_or_404(session, account_id)
    if not slack_adapter.verify_signature(
        account,
        timestamp=x_slack_request_timestamp or "",
        signature=x_slack_signature or "",
        body=body,
    ):
        raise HTTPException(status_code=403, detail="Invalid Slack signature")

    event = payload.get("event") or {}
    inbound = slack_adapter.normalize_inbound(event, account)
    if not inbound:
        return {"ok": True, "ignored": True}
    try:
        signal, should_process = await ingest_inbound(session, account.tenant_id, inbound)
    except BlockedContactError:
        return {"ok": True, "dropped": "blocked_contact"}
    if should_process:
        await enqueue_signal_processing(str(account.tenant_id), str(signal.id))
    return {"ok": True, "signal_id": str(signal.id)}
