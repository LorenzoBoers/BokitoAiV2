"""Channel management API: accounts, contacts (pairing), inbound webhooks."""

import json
import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels import ingest_inbound
from app.channels import email as email_adapter
from app.channels import slack as slack_adapter
from app.channels import whatsapp as whatsapp_adapter
from app.channels.base import BlockedContactError, account_settings
from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.channel import (
    CHANNEL_ACCOUNT_CHANNELS,
    CONTACT_STATUSES,
    ChannelAccount,
    Company,
    Contact,
)
from app.models.signal import Signal
from app.services.channel_visibility import (
    account_visibility,
    is_account_visible_to,
    set_account_visibility,
)
from app.services.signal_threads import serialize_thread
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
    # Slack: fallback channel for decision notifications when the assignee
    # has no DM target (settings_json.notify_channel_id).
    notify_channel_id: str = ""


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
        "visibility": account_visibility(row),
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
    accounts = [
        a
        for a in result.scalars().all()
        if is_account_visible_to(a, user_id=auth.user.id, role=auth.role)
    ]
    return {"accounts": [_serialize_account(a) for a in accounts]}


class AccountVisibilityBody(BaseModel):
    mode: str  # everyone | selected
    user_ids: list[str] = []


@router.patch("/accounts/{account_id}/visibility")
async def update_account_visibility(
    account_id: UUID,
    body: AccountVisibilityBody,
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
    try:
        set_account_visibility(account, mode=body.mode, user_ids=body.user_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.add(account)
    await session.commit()
    await session.refresh(account)
    return _serialize_account(account)


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
    settings: dict = {"require_pairing": body.require_pairing, "inbound_secret": inbound_secret}
    if body.notify_channel_id.strip():
        settings["notify_channel_id"] = body.notify_channel_id.strip()
    account = ChannelAccount(
        tenant_id=auth.tenant.id,
        channel=body.channel,
        provider=body.provider,
        address=body.address,
        display_name=body.display_name,
        credentials_json=json.dumps(body.credentials or {}),
        settings_json=json.dumps(settings),
    )
    session.add(account)
    await session.commit()
    await session.refresh(account)
    # A real channel replaces the onboarding demo thread.
    if body.channel != "internal":
        from app.services.onboarding_demo import remove_demo_threads

        try:
            await remove_demo_threads(session, auth.tenant.id)
        except Exception:  # noqa: BLE001 — cleanup must never break connect
            pass
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
    account = await _tenant_account_or_404(session, auth.tenant.id, account_id)
    if account.channel == "widget":
        raise HTTPException(
            status_code=400,
            detail="The website chat cannot be removed. You can pause it instead.",
        )
    await _detach_and_delete(session, account)
    return {"ok": True}


# ── unified channel rows (state + capabilities + checks) ─────────────


class ChannelCheck(BaseModel):
    """One granular truth about a channel (credentials, webhook, folders...)."""

    id: str
    state: str  # ok | warn | fail | pending | na
    detail: str = ""
    action: str = ""


class ChannelVisibility(BaseModel):
    mode: str
    user_ids: list[str] = []


class ChannelRow(BaseModel):
    """A channel of any kind in one shape the whole product reads."""

    id: str
    channel: str
    kind: str
    provider: str
    address: str
    display_name: str
    label: str
    is_enabled: bool
    is_primary: bool
    state: str
    state_reason: str = ""
    capabilities: list[str]
    checks: list[ChannelCheck]
    actions: list[str]
    configure_href: str = ""
    last_event_at: str | None = None
    last_sync_at: str | None = None
    last_error: str = ""
    ai_mode: str
    visibility: ChannelVisibility
    created_at: str
    # Initial backfill window in days for sync channels; 0 = everything.
    sync_window_days: int = 30


class ChannelListResponse(BaseModel):
    channels: list[ChannelRow]


class ChannelPatchBody(BaseModel):
    label: str | None = None
    is_enabled: bool | None = None
    is_primary: bool | None = None
    sync_window_days: int | None = None


class ChannelSyncResponse(BaseModel):
    channel: ChannelRow
    synced: int = 0
    status: str = "ok"


async def _tenant_account_or_404(
    session: AsyncSession, tenant_id: UUID, account_id: UUID
) -> ChannelAccount:
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.id == account_id, ChannelAccount.tenant_id == tenant_id
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Channel not found")
    return account


async def _detach_and_delete(session: AsyncSession, account: ChannelAccount) -> None:
    """Drop a channel without losing history: threads keep their messages."""
    from sqlalchemy import delete as sa_delete, update as sa_update

    from app.models.channel import ChannelBinding
    from app.models.email_routing import EmailRoutingRule

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


async def _row(session: AsyncSession, auth: AuthContext, account: ChannelAccount) -> dict:
    from app.services.channel_registry import last_event_by_account, resolve_channel

    events = await last_event_by_account(session, auth.tenant.id)
    return resolve_channel(
        account, tenant=auth.tenant, last_event_at=events.get(account.id)
    )


@router.get("", response_model=ChannelListResponse)
async def list_channels_unified(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ChannelListResponse:
    """Every configurable channel with its state, capabilities, and checks."""
    from app.services.channel_registry import list_channels

    rows = await list_channels(
        session, auth.tenant, user_id=auth.user.id, role=auth.role
    )
    return ChannelListResponse(channels=[ChannelRow(**row) for row in rows])


@router.get("/accounts/{account_id}", response_model=ChannelRow)
async def get_channel(
    account_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ChannelRow:
    """One channel with the full check list behind its state."""
    account = await _tenant_account_or_404(session, auth.tenant.id, account_id)
    if not is_account_visible_to(account, user_id=auth.user.id, role=auth.role):
        raise HTTPException(status_code=404, detail="Channel not found")
    return ChannelRow(**await _row(session, auth, account))


@router.patch("/accounts/{account_id}", response_model=ChannelRow)
async def patch_channel(
    account_id: UUID,
    body: ChannelPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ChannelRow:
    """Rename, pause/resume, set the backfill window, or mark the primary sender."""
    auth.require_role("owner", "admin")
    account = await _tenant_account_or_404(session, auth.tenant.id, account_id)
    settings = account_settings(account)
    if body.sync_window_days is not None:
        if body.sync_window_days < 0 or body.sync_window_days > 3650:
            raise HTTPException(status_code=400, detail="Backfill window out of range")
        settings["sync_window_days"] = int(body.sync_window_days)
    if body.label is not None:
        label = body.label.strip()
        if label:
            settings["label"] = label
            account.display_name = label
        else:
            settings.pop("label", None)
    if body.is_enabled is not None:
        account.is_enabled = bool(body.is_enabled)
    if body.is_primary is not None:
        settings["is_primary"] = bool(body.is_primary)
        if body.is_primary:
            # Only one primary sender per channel kind.
            others = await session.execute(
                select(ChannelAccount).where(
                    ChannelAccount.tenant_id == auth.tenant.id,
                    ChannelAccount.channel == account.channel,
                    ChannelAccount.id != account.id,
                )
            )
            for other in others.scalars().all():
                other_settings = account_settings(other)
                if other_settings.get("is_primary"):
                    other_settings["is_primary"] = False
                    other.settings_json = json.dumps(other_settings)
                    session.add(other)
    account.settings_json = json.dumps(settings)
    session.add(account)
    await session.commit()
    await session.refresh(account)
    return ChannelRow(**await _row(session, auth, account))


@router.post("/accounts/{account_id}/sync", response_model=ChannelSyncResponse)
async def sync_channel(
    account_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ChannelSyncResponse:
    """Poll a channel that supports syncing; webhook channels have nothing to poll."""
    from app.services.channel_registry import resolve_channel
    from app.services.email_sync import sync_account

    account = await _tenant_account_or_404(session, auth.tenant.id, account_id)
    row = resolve_channel(account, tenant=auth.tenant)
    if "sync" not in row["capabilities"]:
        raise HTTPException(status_code=400, detail="This channel does not sync")
    result = await sync_account(session, account)
    await session.refresh(account)
    return ChannelSyncResponse(
        channel=ChannelRow(**await _row(session, auth, account)),
        synced=int(result.get("synced") or 0),
        status=str(result.get("status") or "ok"),
    )


# ── Bokito relay addresses ───────────────────────────────────────────


class RelayCreateBody(BaseModel):
    prefix: str
    label: str = ""


class RelayOptionsResponse(BaseModel):
    """What the "create a Bokito address" form needs: domain, slug, budget."""

    domain: str
    workspace_slug: str
    max_relays: int
    used: int
    reserved_prefixes: list[str]
    relays: list[ChannelRow]


@router.get("/email/relays", response_model=RelayOptionsResponse)
async def list_email_relays(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RelayOptionsResponse:
    """Existing relay addresses plus the rules for creating another one."""
    from app.services.channel_registry import last_event_by_account, resolve_channel
    from app.services.email_relay import (
        MAX_RELAYS,
        RESERVED_PREFIXES,
        inbound_domain,
        list_relays,
        workspace_slug,
    )

    relays = await list_relays(session, auth.tenant.id)
    events = await last_event_by_account(session, auth.tenant.id)
    return RelayOptionsResponse(
        domain=inbound_domain(),
        workspace_slug=workspace_slug(auth.tenant.slug),
        max_relays=MAX_RELAYS,
        used=len(relays),
        reserved_prefixes=sorted(RESERVED_PREFIXES),
        relays=[
            ChannelRow(
                **resolve_channel(
                    account, tenant=auth.tenant, last_event_at=events.get(account.id)
                )
            )
            for account in relays
        ],
    )


@router.post("/email/relays", response_model=ChannelRow, status_code=201)
async def create_email_relay(
    body: RelayCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ChannelRow:
    """Create a `{prefix}-{workspace}@{domain}` address to forward mail into."""
    auth.require_role("owner", "admin")
    from app.services.email_relay import RelayError, create_relay

    try:
        account = await create_relay(
            session, auth.tenant.id, prefix=body.prefix, label=body.label
        )
    except RelayError as exc:
        detail: dict = {"code": "relay_rejected", "message": exc.detail}
        if exc.suggestion:
            detail["suggestion"] = exc.suggestion
        raise HTTPException(status_code=exc.status_code, detail=detail) from exc
    # A real channel replaces the onboarding demo thread.
    from app.services.onboarding_demo import remove_demo_threads

    try:
        await remove_demo_threads(session, auth.tenant.id)
    except Exception:  # noqa: BLE001 — cleanup must never break create
        pass
    return ChannelRow(**await _row(session, auth, account))


# ── contacts (CRM + pairing / allowlist) ─────────────────────────────


class ContactUpdateBody(BaseModel):
    status: str | None = None
    display_name: str | None = None
    address: str | None = None
    company: str | None = None
    title: str | None = None
    phone: str | None = None
    notes: str | None = None


class ContactCreateBody(BaseModel):
    channel: str = "email"
    address: str
    display_name: str = ""
    company: str = ""
    title: str = ""
    phone: str = ""
    notes: str = ""


def _serialize_contact(row: Contact, *, thread_count: int | None = None) -> dict:
    data = {
        "id": str(row.id),
        "channel": row.channel,
        "address": row.address,
        "display_name": row.display_name,
        "status": row.status,
        "company": row.company,
        "company_id": str(row.company_id) if row.company_id else None,
        "title": row.title,
        "phone": row.phone,
        "notes": row.notes,
        "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
        "created_at": row.created_at.isoformat(),
    }
    if thread_count is not None:
        data["thread_count"] = thread_count
    return data


async def _contact_or_404(
    session: AsyncSession, tenant_id: UUID, contact_id: UUID
) -> Contact:
    # SQLite (and older rows) store UUID text with or without hyphens. Bind a
    # Python UUID as compact hex and hyphenated rows miss the equality check.
    hyphenated = str(contact_id)
    compact = hyphenated.replace("-", "")
    result = await session.execute(
        select(Contact).where(
            Contact.tenant_id == tenant_id,
            or_(
                Contact.id == contact_id,
                cast(Contact.id, String) == hyphenated,
                cast(Contact.id, String) == compact,
            ),
        )
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.get("/contacts")
async def list_contacts(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str | None = None,
    channel: str | None = None,
    search: str | None = None,
):
    stmt = select(Contact).where(Contact.tenant_id == auth.tenant.id)
    if status:
        stmt = stmt.where(Contact.status == status)
    if channel:
        stmt = stmt.where(Contact.channel == channel)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(
            Contact.display_name.ilike(like)
            | Contact.address.ilike(like)
            | Contact.company.ilike(like)
        )
    stmt = stmt.order_by(Contact.last_seen_at.desc()).limit(200)
    result = await session.execute(stmt)
    contacts = list(result.scalars().all())

    counts: dict[UUID, int] = {}
    if contacts:
        count_result = await session.execute(
            select(Signal.contact_id, func.count(Signal.id))
            .where(
                Signal.tenant_id == auth.tenant.id,
                Signal.contact_id.in_([c.id for c in contacts]),
            )
            .group_by(Signal.contact_id)
        )
        counts = {row[0]: row[1] for row in count_result.all()}
    return {
        "contacts": [
            _serialize_contact(c, thread_count=counts.get(c.id, 0)) for c in contacts
        ]
    }


@router.post("/contacts")
async def create_contact(
    body: ContactCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Manually add a contact (channels create them automatically on inbound)."""
    address = body.address.strip().lower()
    if not address:
        raise HTTPException(status_code=400, detail="Address is required")
    if body.channel not in CHANNEL_ACCOUNT_CHANNELS:
        raise HTTPException(status_code=400, detail=f"Invalid channel: {body.channel}")
    existing = await session.execute(
        select(Contact).where(
            Contact.tenant_id == auth.tenant.id,
            Contact.channel == body.channel,
            Contact.address == address,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Contact already exists for this channel")
    contact = Contact(
        tenant_id=auth.tenant.id,
        channel=body.channel,
        address=address,
        display_name=body.display_name.strip(),
        status="approved",
        company=body.company.strip(),
        title=body.title.strip(),
        phone=body.phone.strip(),
        notes=body.notes,
    )
    session.add(contact)
    await session.flush()
    from app.services.companies import link_contact_company

    await link_contact_company(session, contact)
    await session.commit()
    await session.refresh(contact)
    return _serialize_contact(contact, thread_count=0)


@router.delete("/contacts/{contact_id}")
async def delete_contact(
    contact_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Remove a contact; existing threads are kept but unlinked."""
    auth.require_role("owner", "admin")
    contact = await _contact_or_404(session, auth.tenant.id, contact_id)
    linked = await session.execute(
        select(Signal).where(
            Signal.tenant_id == auth.tenant.id, Signal.contact_id == contact_id
        )
    )
    for signal in linked.scalars().all():
        signal.contact_id = None
        session.add(signal)
    await session.delete(contact)
    await session.commit()
    return {"ok": True}


@router.get("/contacts/{contact_id}")
async def get_contact(
    contact_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    contact = await _contact_or_404(session, auth.tenant.id, contact_id)
    count_result = await session.execute(
        select(func.count(Signal.id)).where(
            Signal.tenant_id == auth.tenant.id, Signal.contact_id == contact_id
        )
    )
    return _serialize_contact(contact, thread_count=count_result.scalar_one())


@router.get("/contacts/{contact_id}/threads")
async def list_contact_threads(
    contact_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 20,
):
    contact = await _contact_or_404(session, auth.tenant.id, contact_id)
    conditions = [Signal.contact_id == contact_id]
    if contact.address and "@" in contact.address:
        # Older threads may predate the contact link; match denormalized email.
        conditions.append(Signal.contact_email == contact.address)
        # Cross-channel history: the same person may exist as a per-channel
        # contact row (e.g. widget visitor who also emails). Pull in threads
        # linked to any sibling contact with the same address.
        sibling_ids = select(Contact.id).where(
            Contact.tenant_id == auth.tenant.id,
            Contact.address == contact.address,
        )
        conditions.append(Signal.contact_id.in_(sibling_ids))
    result = await session.execute(
        select(Signal)
        .where(Signal.tenant_id == auth.tenant.id, or_(*conditions))
        .order_by(Signal.last_message_at.desc())
        .limit(max(1, min(limit, 100)))
    )
    threads = [serialize_thread(s) for s in result.scalars().all()]
    return {"threads": threads}


@router.patch("/contacts/{contact_id}")
async def update_contact(
    contact_id: UUID,
    body: ContactUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if body.status is not None:
        auth.require_role("owner", "admin")
        if body.status not in CONTACT_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
    contact = await _contact_or_404(session, auth.tenant.id, contact_id)
    previous_name = contact.display_name
    previous_address = contact.address
    if body.status is not None:
        contact.status = body.status
    if body.display_name is not None:
        contact.display_name = body.display_name
    if body.address is not None:
        address = body.address.strip().lower()
        if not address or "@" not in address:
            raise HTTPException(status_code=400, detail="A valid email address is required")
        existing = await session.execute(
            select(Contact).where(
                Contact.tenant_id == auth.tenant.id,
                Contact.channel == contact.channel,
                Contact.address == address,
                Contact.id != contact.id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Contact already exists for this channel")
        contact.address = address
        from app.services.companies import link_contact_company

        await link_contact_company(session, contact)
    if body.address is not None or body.display_name is not None:
        linked = await session.execute(
            select(Signal).where(
                Signal.tenant_id == auth.tenant.id, Signal.contact_id == contact.id
            )
        )
        for signal in linked.scalars().all():
            if body.address is not None and (
                not signal.contact_email or signal.contact_email == previous_address
            ):
                signal.contact_email = contact.address
            if body.display_name is not None and (
                not signal.contact_name or signal.contact_name == previous_name
            ):
                signal.contact_name = contact.display_name
            session.add(signal)
    if body.company is not None:
        contact.company = body.company
    if body.title is not None:
        contact.title = body.title
    if body.phone is not None:
        contact.phone = body.phone
    if body.notes is not None:
        contact.notes = body.notes
    session.add(contact)
    await session.commit()
    return _serialize_contact(contact)


# ── companies (CRM) ──────────────────────────────────────────────────


class CompanyUpdateBody(BaseModel):
    name: str | None = None
    website: str | None = None
    notes: str | None = None


async def _company_or_404(session: AsyncSession, tenant_id: UUID, company_id: UUID) -> Company:
    result = await session.execute(
        select(Company).where(Company.id == company_id, Company.tenant_id == tenant_id)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


@router.get("/companies")
async def list_companies(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    search: str | None = None,
):
    from app.services.companies import company_contact_counts, serialize_company

    stmt = select(Company).where(Company.tenant_id == auth.tenant.id)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(Company.name.ilike(like), Company.domain.ilike(like)))
    result = await session.execute(stmt.order_by(Company.name.asc()).limit(200))
    counts = await company_contact_counts(session, auth.tenant.id)
    return {
        "companies": [
            serialize_company(c, contact_count=counts.get(c.id, 0))
            for c in result.scalars().all()
        ]
    }


@router.post("/companies/backfill")
async def backfill_companies(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Link existing email contacts without a company to domain-matched companies."""
    auth.require_role("owner", "admin")
    from app.services.companies import backfill_company_links

    return await backfill_company_links(session, auth.tenant.id)


@router.get("/companies/{company_id}")
async def get_company(
    company_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.companies import serialize_company

    company = await _company_or_404(session, auth.tenant.id, company_id)
    contacts = await session.execute(
        select(Contact)
        .where(Contact.tenant_id == auth.tenant.id, Contact.company_id == company.id)
        .order_by(Contact.last_seen_at.desc().nullslast())
        .limit(100)
    )
    contact_rows = list(contacts.scalars().all())
    threads = await session.execute(
        select(Signal)
        .where(
            Signal.tenant_id == auth.tenant.id,
            Signal.contact_id.in_([c.id for c in contact_rows] or [None]),
        )
        .order_by(Signal.last_message_at.desc())
        .limit(20)
    )
    return {
        **serialize_company(company, contact_count=len(contact_rows)),
        "contacts": [_serialize_contact(c) for c in contact_rows],
        "threads": [serialize_thread(s) for s in threads.scalars().all()],
    }


@router.patch("/companies/{company_id}")
async def update_company(
    company_id: UUID,
    body: CompanyUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.companies import serialize_company, touch

    company = await _company_or_404(session, auth.tenant.id, company_id)
    if body.name is not None:
        company.name = body.name.strip()[:120]
    if body.website is not None:
        company.website = body.website.strip()[:200]
    if body.notes is not None:
        company.notes = body.notes
    touch(company)
    session.add(company)
    await session.commit()
    return serialize_company(company)


@router.delete("/companies/{company_id}")
async def delete_company(
    company_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Remove a company; its contacts are kept and unlinked."""
    auth.require_role("owner", "admin")
    company = await _company_or_404(session, auth.tenant.id, company_id)
    contacts = await session.execute(
        select(Contact).where(
            Contact.tenant_id == auth.tenant.id, Contact.company_id == company.id
        )
    )
    for contact in contacts.scalars().all():
        contact.company_id = None
        session.add(contact)
    await session.delete(company)
    await session.commit()
    return {"ok": True}


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


@router.get("/whatsapp/setup")
async def whatsapp_setup(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    """Setup values for the WhatsApp connect card (webhook URL + verify token).

    The verify token only gates Meta's subscription handshake; exposing it to
    tenant admins is required for the BYO-app self-serve flow.
    """
    auth.require_role("owner", "admin")
    settings = get_settings()
    return {
        "webhook_url": f"{settings.public_api_url.rstrip('/')}/api/channels/whatsapp/webhook",
        "verify_token": settings.whatsapp_verify_token,
        "configured": bool(settings.meta_app_secret and settings.whatsapp_verify_token),
    }


@router.get("/whatsapp/webhook")
async def whatsapp_verify(
    hub_mode: Annotated[str, Query(alias="hub.mode")] = "",
    hub_verify_token: Annotated[str, Query(alias="hub.verify_token")] = "",
    hub_challenge: Annotated[str, Query(alias="hub.challenge")] = "",
):
    """Meta webhook verification handshake (app-level, one URL for all tenants)."""
    settings = get_settings()
    expected = settings.whatsapp_verify_token
    if not expected or hub_mode != "subscribe" or hub_verify_token != expected:
        raise HTTPException(status_code=403, detail="Verification failed")
    return PlainTextResponse(hub_challenge)


@router.post("/whatsapp/webhook")
async def whatsapp_webhook(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    x_hub_signature_256: Annotated[str | None, Header()] = None,
):
    """WhatsApp Cloud API events (one app-level URL; account resolved per payload).

    Always returns 200 for processable payloads — Meta retries aggressively on
    non-2xx and eventually disables the webhook.
    """
    settings = get_settings()
    body = await request.body()
    if not whatsapp_adapter.verify_signature(
        app_secret=settings.meta_app_secret,
        signature=x_hub_signature_256 or "",
        body=body,
    ):
        raise HTTPException(status_code=403, detail="Invalid signature")
    try:
        payload = json.loads(body or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid payload")

    results: list[dict] = []
    for value in whatsapp_adapter.extract_message_values(payload):
        phone_number_id = str((value.get("metadata") or {}).get("phone_number_id") or "")
        if not phone_number_id:
            continue
        account_result = await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.channel == "whatsapp",
                ChannelAccount.address == phone_number_id,
                ChannelAccount.is_enabled == True,  # noqa: E712
            )
        )
        account = account_result.scalar_one_or_none()
        if not account:
            results.append({"phone_number_id": phone_number_id, "ignored": "no_account"})
            continue
        for inbound in whatsapp_adapter.normalize_inbound(value, account):
            try:
                signal, should_process = await ingest_inbound(
                    session, account.tenant_id, inbound
                )
            except BlockedContactError:
                results.append({"dropped": "blocked_contact"})
                continue
            if should_process:
                await enqueue_signal_processing(str(account.tenant_id), str(signal.id))
            results.append({"signal_id": str(signal.id)})
    return {"ok": True, "results": results}


@router.post("/slack/interactions")
async def slack_interactions(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    x_slack_request_timestamp: Annotated[str | None, Header()] = None,
    x_slack_signature: Annotated[str | None, Header()] = None,
):
    """Slack interactivity endpoint (one global URL per Slack app).

    Block-action clicks on decision cards land here as a form-encoded
    `payload`. The payload's `team.id` selects the ChannelAccount whose
    signing secret must verify the raw request body.
    """
    from urllib.parse import parse_qs

    from app.services.slack_notify import handle_interaction

    body = await request.body()
    form = parse_qs(body.decode("utf-8", errors="replace"))
    raw_payload = (form.get("payload") or [""])[0]
    try:
        payload = json.loads(raw_payload or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid interaction payload")

    team_id = str((payload.get("team") or {}).get("id") or "")
    if not team_id:
        raise HTTPException(status_code=400, detail="Missing team id")
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.channel == "slack",
            ChannelAccount.address == team_id,
            ChannelAccount.is_enabled == True,  # noqa: E712
        )
    )
    accounts = list(result.scalars().all())
    account = next(
        (
            a
            for a in accounts
            if slack_adapter.verify_signature(
                a,
                timestamp=x_slack_request_timestamp or "",
                signature=x_slack_signature or "",
                body=body,
            )
        ),
        None,
    )
    if not account:
        raise HTTPException(status_code=403, detail="Invalid Slack signature")

    return await handle_interaction(session, account, payload)
