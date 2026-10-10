"""Unified SENSING endpoints (Signal model) with inbox-parity for Messages hub."""

import json
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth, require_verified_email
from app.middleware.rate_limit import rate_limit
from app.models.auth import user_numeric_id
from app.routers.signal_chat import router as chat_router
from app.services import signal_threads as svc
from app.services.channel_access import handled_channel_account_ids, visible_channel_account_ids
from app.services.signals import create_inbound_signal, serialize_signal

router = APIRouter(prefix="/signals", tags=["signals"])

# Assistant conversation facade (/signals/conversations, /signals/chat/targets).
# Must register before the /{signal_id} routes below or Starlette would match
# "conversations" as a signal_id and fail UUID validation.
router.include_router(chat_router)


class StartThreadBody(BaseModel):
    """Start a conversation that is not a mailbox draft.

    ``whatsapp`` sends the first message on the configured number (one thread
    per customer number). ``ticket`` opens an internal thread already filed
    on an action tag, with an optional project.
    """

    kind: Literal["whatsapp", "ticket"]
    channel_account_id: UUID | None = None
    to: str = ""
    body_text: str = ""
    tag_id: UUID | None = None
    project_id: UUID | None = None
    subject: str = ""
    note: str = ""
    fields: dict[str, str] | None = None


@router.post("/start")
async def start_thread(
    body: StartThreadBody,
    auth: Annotated[AuthContext, Depends(require_verified_email)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a WhatsApp thread or an internal ticket thread."""
    if body.kind == "whatsapp":
        return await _start_whatsapp(session, auth, body)
    return await _start_ticket(session, auth, body)


async def _start_whatsapp(session: AsyncSession, auth: AuthContext, body: StartThreadBody) -> dict:
    from app.channels import deliver_outbound
    from app.channels.whatsapp import digits as whatsapp_digits
    from app.models.channel import ChannelAccount
    from app.models.signal import Signal, SignalEvent, SignalMessage
    from app.services.channel_registry import account_can_send
    from app.services.ownership import set_owner
    from app.services.signals import get_or_create_contact

    phone = whatsapp_digits(body.to)
    text = (body.body_text or "").strip()
    if len(phone) < 8:
        raise HTTPException(status_code=400, detail="A WhatsApp number is required")
    if not text:
        raise HTTPException(status_code=400, detail="A message is required")

    visible = await visible_channel_account_ids(
        session, auth.tenant.id, user_id=auth.user.id, role=auth.role
    )
    query = select(ChannelAccount).where(
        ChannelAccount.tenant_id == auth.tenant.id,
        ChannelAccount.channel == "whatsapp",
        ChannelAccount.is_enabled.is_(True),
        ChannelAccount.archived_at.is_(None),
    )
    if body.channel_account_id is not None:
        query = query.where(ChannelAccount.id == body.channel_account_id)
    accounts = [
        row
        for row in (await session.execute(query)).scalars().all()
        if (visible is None or row.id in visible) and account_can_send(row, tenant=auth.tenant)
    ]
    account = accounts[0] if accounts else None
    if account is None:
        raise HTTPException(status_code=400, detail="No WhatsApp account can send")

    now = datetime.utcnow()
    existing = (
        await session.execute(
            select(Signal)
            .where(
                Signal.tenant_id == auth.tenant.id,
                Signal.channel == "whatsapp",
                Signal.channel_account_id == account.id,
                Signal.external_id == phone,
                Signal.deleted_at.is_(None),
            )
            .order_by(Signal.last_message_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        signal = existing
        if signal.status in ("closed", "pending"):
            signal.status = "open"
    else:
        contact = await get_or_create_contact(
            session, auth.tenant.id, channel="whatsapp", address=phone
        )
        signal = Signal(
            tenant_id=auth.tenant.id,
            channel="whatsapp",
            source=account.provider or "whatsapp",
            external_id=phone,
            subject=f"WhatsApp {phone}",
            contact_id=contact.id if contact else None,
            contact_phone=phone,
            contact_name=(contact.display_name if contact else "") or "",
            channel_account_id=account.id,
            status="open",
            priority="normal",
            has_unread=False,
            last_message_at=now,
        )
        set_owner(signal, "user", auth.user.id, by_user_id=auth.user.id)
        session.add(signal)
        await session.flush()
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=auth.tenant.id,
                event_type="signal_created",
                actor_type="user",
                actor_id=str(auth.user.id),
                payload_json=json.dumps({"source": "whatsapp"}),
            )
        )

    delivery = await deliver_outbound(session, signal, body_text=text, to_address=phone)
    if delivery.status == "skipped" or delivery.status.startswith("failed"):
        await session.rollback()
        reason = delivery.status.removeprefix("failed:").replace("_", " ").strip() or "provider error"
        raise HTTPException(status_code=502, detail=f"Sending failed: {reason}")

    msg = SignalMessage(
        signal_id=signal.id,
        tenant_id=auth.tenant.id,
        kind="user_message",
        direction="outbound",
        role="user",
        author_user_id=auth.user.id,
        to_addresses=json.dumps([phone]),
        body_text=text,
        body_preview=text[:200],
        send_status="sent",
        received_at=now,
    )
    session.add(msg)
    signal.last_message_at = now
    signal.updated_at = now
    signal.has_unread = False
    session.add(signal)
    await session.commit()
    await session.refresh(msg)
    from app.gateway.publish import publish_signal_message, publish_thread_update

    await publish_signal_message(signal, msg)
    await publish_thread_update(signal)
    return {"ok": True, "thread_id": str(signal.id), "channel": "whatsapp"}


async def _start_ticket(session: AsyncSession, auth: AuthContext, body: StartThreadBody) -> dict:
    from app.models.signal import Signal, SignalEvent, SignalMessage
    from app.services import tickets as ticket_svc
    from app.services.ownership import set_owner

    subject = (body.subject or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="A subject is required")
    if body.tag_id is None:
        raise HTTPException(status_code=400, detail="An action tag is required")

    now = datetime.utcnow()
    signal = Signal(
        tenant_id=auth.tenant.id,
        channel="internal",
        source="operator",
        subject=subject[:300],
        status="open",
        priority="normal",
        has_unread=False,
        last_message_at=now,
    )
    set_owner(signal, "user", auth.user.id, by_user_id=auth.user.id)
    session.add(signal)
    await session.flush()
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=auth.tenant.id,
            event_type="signal_created",
            actor_type="user",
            actor_id=str(auth.user.id),
            payload_json=json.dumps({"source": "ticket"}),
        )
    )
    note = (body.note or "").strip()
    if note:
        session.add(
            SignalMessage(
                signal_id=signal.id,
                tenant_id=auth.tenant.id,
                kind="internal_note",
                direction="internal",
                role="user",
                author_user_id=auth.user.id,
                body_text=note,
                body_preview=note[:200],
                received_at=now,
            )
        )
    await ticket_svc.file_ticket(
        session,
        auth.tenant.id,
        signal_id=signal.id,
        tag_id=body.tag_id,
        project_id=body.project_id,
        project_chosen=True,
        fields=body.fields,
        actor="operator",
        created_by_type="user",
        created_by_id=str(auth.user.id),
        user_id=auth.user.id,
    )
    await session.refresh(signal)
    from app.gateway.publish import publish_thread_update

    await publish_thread_update(signal)
    return {"ok": True, "thread_id": str(signal.id), "channel": "internal"}


class InboundSignalBody(BaseModel):
    channel: str = "email"
    source: str = "mock"
    subject: str = ""
    body_text: str
    contact_email: str = ""
    contact_name: str = ""
    external_id: str = ""


class AssigneeRef(BaseModel):
    """New owner: a person (numeric inbox id or UUID), an agent or a team.

    A team without an id means the channel's owner team (Unassigned).
    """

    kind: str  # user | agent | team
    id: str | int | None = None
    # Optional handover note for the new owner (agent or team).
    message: str | None = None


class ThreadPatch(BaseModel):
    status: str | None = None
    assigned_to_user_id: int | None = None
    assignee: AssigneeRef | None = None
    tags: list[str] | None = None
    priority: str | None = None
    project_id: UUID | None = None
    # Set a wake time to snooze (status flips to pending); null clears it.
    snoozed_until: datetime | None = None
    # Next look-at while the conversation stays open (not snooze, not AgentTask).
    follow_up_at: datetime | None = None
    follow_up_title: str | None = None
    # Email-only: bind the thread to this mailbox (From + channel folder).
    channel_account_id: UUID | None = None


class BulkBody(BaseModel):
    signal_ids: list[UUID]
    action: str  # close | reopen | spam | read | unread | assign | snooze | trash
    assignee_id: int | None = None
    snoozed_until: datetime | None = None


class ReplyBody(BaseModel):
    body_text: str
    body_html: str | None = None
    action: str = "send"
    attachments: list[dict] | None = None
    # For action=send_and_pending: optional snooze duration (wake time).
    snooze_minutes: int | None = None
    # Email-only: comma-separated extra recipients.
    cc: str | None = None
    bcc: str | None = None
    # Soft undo: delay delivery by this many seconds (0/None = send now).
    # Capped server-side; the scheduler tick delivers once the delay passes.
    send_after_seconds: int | None = None
    # Email-only: send from this mailbox and rebind the thread to it.
    channel_account_id: UUID | None = None
    # Email-only, mail-native composer: explicit To override (comma-separated).
    to: str | None = None
    # reply | reply_all | forward — forward skips In-Reply-To threading.
    mode: str = "reply"
    # The bubble this reply/forward was started from (for the timeline).
    source_message_id: UUID | None = None
    # Subject override (e.g. "Fwd: …" on forwards).
    subject: str | None = None
    # Quoted prior-conversation HTML; the server appends it below the
    # signature so the wire format matches normal mail clients.
    quoted_html: str | None = None


class NoteBody(BaseModel):
    body_text: str
    attachments: list[dict] | None = None


class DraftBody(BaseModel):
    """Optional operator guidance for the AI draft (e.g. 'decline politely')."""

    instruction: str = ""


class NotePatchBody(BaseModel):
    body_text: str


class ResolveBody(BaseModel):
    action: str
    option_id: str | None = None
    # Multi-select proposals: all chosen option ids (option_id stays the primary).
    option_ids: list[str] | None = None
    body: str | None = None
    body_text: str | None = None
    body_html: str | None = None
    subject: str | None = None
    response_text: str | None = None
    # Sender identity for approved reply suggestions: "user" (default) or "agent".
    send_as: str | None = None
    # Chat-mode reply drafts: the edited bubbles, sent in order.
    messages: list[str] | None = None


class SessionStartBody(BaseModel):
    """Inline agent session: which agent to bring into the thread."""

    agent_id: UUID | None = None


class ExampleBody(BaseModel):
    use_as_example: bool = True


def _num(auth: AuthContext) -> int:
    return user_numeric_id(auth.user.id)


@router.post("/inbound")
async def ingest_inbound_signal(
    body: InboundSignalBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    signal = await create_inbound_signal(
        session,
        auth.tenant.id,
        channel=body.channel,
        source=body.source,
        subject=body.subject,
        body_text=body.body_text,
        contact_email=body.contact_email,
        contact_name=body.contact_name,
        external_id=body.external_id,
    )
    from app.workers.tasks import enqueue_signal_processing

    await enqueue_signal_processing(str(auth.tenant.id), str(signal.id))
    return serialize_signal(signal)


@router.get("/pins")
async def list_pins(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_pins(session, auth.tenant.id, auth.user.id)


@router.get("/members")
async def list_members(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_members(session, auth.tenant.id)


class SavedReplyBody(BaseModel):
    title: str
    body_text: str


class RuleCreateBody(BaseModel):
    match_type: str = "sender"  # sender | domain | list_id
    match_value: str
    action: str = "auto_close"  # auto_close | auto_task | mute_ai | tag
    label: str = ""
    tags: list[str] | None = None


class RulePatchBody(BaseModel):
    action: str | None = None
    status: str | None = None  # active | paused
    label: str | None = None
    tags: list[str] | None = None


@router.get("/rules")
async def list_inbox_rules(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import inbox_rules

    return await inbox_rules.list_rules(session, auth.tenant.id)


@router.post("/rules")
async def create_inbox_rule(
    body: RuleCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import inbox_rules

    try:
        return await inbox_rules.create_rule(
            session,
            auth.tenant.id,
            match_type=body.match_type,
            match_value=body.match_value,
            action=body.action,
            label=body.label,
            tags=body.tags,
            user_id=auth.user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/rules/{rule_id}")
async def update_inbox_rule(
    rule_id: UUID,
    body: RulePatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import inbox_rules

    try:
        rule = await inbox_rules.update_rule(
            session,
            auth.tenant.id,
            rule_id,
            action=body.action,
            status=body.status,
            label=body.label,
            tags=body.tags,
            user_id=auth.user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


@router.delete("/rules/{rule_id}")
async def delete_inbox_rule(
    rule_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import inbox_rules

    ok = await inbox_rules.delete_rule(session, auth.tenant.id, rule_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}


@router.get("/saved-replies")
async def list_saved_replies(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from sqlalchemy import select

    from app.models.signal import SavedReply

    result = await session.execute(
        select(SavedReply)
        .where(SavedReply.tenant_id == auth.tenant.id, SavedReply.deleted_at.is_(None))
        .order_by(SavedReply.title)
    )
    return [
        {
            "id": str(row.id),
            "title": row.title,
            "body_text": row.body_text,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in result.scalars().all()
    ]


@router.post("/saved-replies")
async def create_saved_reply(
    body: SavedReplyBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.models.signal import SavedReply

    title = body.title.strip()
    text = body.body_text.strip()
    if not title or not text:
        raise HTTPException(status_code=400, detail="Title and body are required")
    row = SavedReply(
        tenant_id=auth.tenant.id,
        title=title[:120],
        body_text=text,
        created_by_user_id=auth.user.id,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {"id": str(row.id), "title": row.title, "body_text": row.body_text}


@router.patch("/saved-replies/{reply_id}")
async def update_saved_reply(
    reply_id: UUID,
    body: SavedReplyBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from sqlalchemy import select

    from app.models.signal import SavedReply

    result = await session.execute(
        select(SavedReply).where(
            SavedReply.id == reply_id,
            SavedReply.tenant_id == auth.tenant.id,
            SavedReply.deleted_at.is_(None),
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Saved reply not found")
    row.title = body.title.strip()[:120] or row.title
    row.body_text = body.body_text.strip() or row.body_text
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {"id": str(row.id), "title": row.title, "body_text": row.body_text}


@router.delete("/saved-replies/{reply_id}")
async def delete_saved_reply(
    reply_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from sqlalchemy import select

    from app.models.signal import SavedReply

    result = await session.execute(
        select(SavedReply).where(
            SavedReply.id == reply_id,
            SavedReply.tenant_id == auth.tenant.id,
            SavedReply.deleted_at.is_(None),
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Saved reply not found")
    from app.services.trash import move_to_bin

    await move_to_bin(
        session,
        auth.tenant,
        resource_type="saved_reply",
        row=row,
        user_id=auth.user.id if auth.user else None,
        commit=True,
    )
    return {"ok": True}


@router.get("/badge-counts")
async def badge_counts(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.nav_badge_counts(
        session,
        auth.tenant.id,
        auth.user.id,
        include_agents_attention=auth.is_staff or auth.role in ("owner", "admin"),
        visible_account_ids=await visible_channel_account_ids(
            session, auth.tenant.id, user_id=auth.user.id, role=auth.role
        ),
    )


@router.post("/dismiss-no-reply-suggestions")
async def dismiss_no_reply_suggestions(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    also_close: bool = False,
):
    """Dismiss awaiting 'No reply needed' tip cards (optional: close those threads)."""
    if auth.role not in ("owner", "admin") and not auth.is_staff:
        raise HTTPException(status_code=403, detail="Admin required")
    return await svc.dismiss_no_reply_suggestions(
        session,
        auth.tenant.id,
        auth.user.id,
        also_close_threads=also_close,
    )


@router.get("")
async def list_signal_threads(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    view: str = Query("all_open"),
    folder: str | None = Query(None),
    channel: str | None = Query(None),
    search: str | None = Query(None),
    assignee_id: int | None = Query(None),
    tag: str | None = Query(None),
    connection_id: str | None = Query(None),
    email_connection_id: int | None = Query(None),
    project_id: str | None = Query(None),
    category_id: str | None = Query(None),
    stage: str | None = Query(None),
    agent_id: str | None = Query(None),
    unread: bool = Query(False),
    needs_reply: bool = Query(False),
    needs_decision: bool = Query(False),
    pinned: bool = Query(False),
    team_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
):
    """List conversations.

    ``view``: ``for_you`` (yours: owned, your turn, your team's turn, mentions),
    ``all_open``, ``unassigned`` (team-owned, not picked up), ``closed``,
    ``snoozed``, ``spam``, ``all``. ``team_id`` narrows to one team's work.
    Folder filters: ``project_id`` (linked, or a ticket in the project),
    ``category_id``, ``tag`` and ``stage`` (a stage key or kind).
    """
    return await svc.list_threads(
        session,
        auth.tenant.id,
        auth.user.id,
        _num(auth),
        view=view,
        folder=folder,
        channel=channel,
        search=search,
        assignee_id=assignee_id,
        tag=tag,
        connection_id=connection_id,
        email_connection_id=email_connection_id,
        project_id=project_id,
        category_id=category_id,
        stage=stage,
        agent_id=agent_id,
        unread=unread,
        needs_reply=needs_reply,
        needs_decision=needs_decision,
        pinned_only=pinned,
        team_id=team_id,
        page=page,
        per_page=per_page,
        visible_account_ids=await visible_channel_account_ids(
            session, auth.tenant.id, user_id=auth.user.id, role=auth.role
        ),
    )


@router.get("/{signal_id}")
async def get_signal(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=200)] = 80,
    before: UUID | None = None,
):
    detail = await svc.get_thread(
        session,
        auth.tenant.id,
        auth.user.id,
        signal_id,
        visible_account_ids=await visible_channel_account_ids(
            session, auth.tenant.id, user_id=auth.user.id, role=auth.role
        ),
        limit=limit,
        before=before,
    )
    if not detail:
        raise HTTPException(status_code=404, detail="Signal not found")
    return detail


@router.get("/{signal_id}/messages/{message_id}")
async def get_signal_message(
    signal_id: UUID,
    message_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Full message (HTML + agent_trace) for lazy expand on the timeline."""
    row = await svc.get_message(
        session,
        auth.tenant.id,
        signal_id,
        message_id,
        visible_account_ids=await visible_channel_account_ids(
            session, auth.tenant.id, user_id=auth.user.id, role=auth.role
        ),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")
    return row


async def _require_handle(session: AsyncSession, auth: AuthContext, signal_id: UUID) -> None:
    """View-only channel access may read a conversation but not act on it."""
    from app.models.signal import Signal

    account_id = (
        await session.execute(
            select(Signal.channel_account_id).where(
                Signal.id == signal_id, Signal.tenant_id == auth.tenant.id
            )
        )
    ).scalar_one_or_none()
    if account_id is None:
        return
    handled = await handled_channel_account_ids(
        session, auth.tenant.id, user_id=auth.user.id, role=auth.role
    )
    if handled is not None and account_id not in handled:
        raise HTTPException(status_code=403, detail="You can view this channel but not handle it")


@router.patch("/{signal_id}")
async def patch_signal(
    signal_id: UUID,
    body: ThreadPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await _require_handle(session, auth, signal_id)
    updates = body.model_dump(exclude_unset=True)
    project_id_set = "project_id" in updates
    project_id = updates.pop("project_id", None)
    snoozed_until_set = "snoozed_until" in updates
    snoozed_until = updates.pop("snoozed_until", None)
    follow_up_at_set = "follow_up_at" in updates
    follow_up_at = updates.pop("follow_up_at", None)
    follow_up_title = updates.pop("follow_up_title", None)
    channel_account_id_set = "channel_account_id" in updates
    channel_account_id = updates.pop("channel_account_id", None)
    thread = await svc.patch_thread(
        session,
        auth.tenant.id,
        auth.user.id,
        _num(auth),
        signal_id,
        status=updates.get("status"),
        assigned_to_user_id=updates.get("assigned_to_user_id"),
        assignee=updates.get("assignee"),
        tags=updates.get("tags"),
        priority=updates.get("priority"),
        project_id=project_id,
        project_id_set=project_id_set,
        snoozed_until=snoozed_until,
        snoozed_until_set=snoozed_until_set,
        follow_up_at=follow_up_at,
        follow_up_at_set=follow_up_at_set,
        follow_up_title=follow_up_title,
        channel_account_id=channel_account_id,
        channel_account_id_set=channel_account_id_set,
        actor_role=auth.role,
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Signal not found")
    return thread


@router.post("/bulk")
async def bulk_update(
    body: BulkBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Bulk operator actions on threads (close/reopen/spam/read/unread/assign/snooze/trash)."""
    return await svc.bulk_update_threads(
        session,
        auth.tenant.id,
        auth.user.id,
        signal_ids=body.signal_ids,
        action=body.action,
        assignee_id=body.assignee_id,
        snoozed_until=body.snoozed_until,
    )


@router.delete("/{signal_id}")
async def delete_signal(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    ok = await svc.delete_thread(session, auth.tenant.id, signal_id, user_id=auth.user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Signal not found")
    return {"ok": True}


@router.patch("/{signal_id}/mark-read")
async def mark_read(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    thread = await svc.set_read(
        session, auth.tenant.id, auth.user.id, _num(auth), signal_id, read=True
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Signal not found")
    return thread


@router.patch("/{signal_id}/mark-unread")
async def mark_unread(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    thread = await svc.set_read(
        session, auth.tenant.id, auth.user.id, _num(auth), signal_id, read=False
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Signal not found")
    return thread


@router.post("/{signal_id}/reply")
async def reply(
    signal_id: UUID,
    body: ReplyBody,
    # Outbound replies require a verified sender address (soft gate).
    auth: Annotated[AuthContext, Depends(require_verified_email)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await _require_handle(session, auth, signal_id)
    message = await svc.reply_to_thread(
        session,
        auth.tenant.id,
        auth.user.id,
        _num(auth),
        signal_id,
        body_text=body.body_text,
        body_html=body.body_html,
        action=body.action,
        attachments=body.attachments,
        snooze_minutes=body.snooze_minutes,
        cc=body.cc,
        bcc=body.bcc,
        # Undo is a short grace window, not a full "send later" scheduler UI;
        # cap the delay so the API cannot park messages for days.
        send_after_seconds=min(body.send_after_seconds or 0, 600) or None,
        channel_account_id=body.channel_account_id,
        actor_role=auth.role,
        to=body.to,
        reply_mode=body.mode if body.mode in ("reply", "reply_all", "forward") else "reply",
        source_message_id=body.source_message_id,
        subject=body.subject,
        quoted_html=body.quoted_html,
    )
    if not message:
        raise HTTPException(status_code=404, detail="Signal not found")
    return message


@router.post("/messages/{message_id}/cancel")
async def cancel_scheduled(
    message_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Soft undo: cancel a scheduled outbound message before it is delivered."""
    cancelled = await svc.cancel_scheduled_message(session, auth.tenant.id, message_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="No scheduled message to cancel")
    return cancelled


@router.post("/{signal_id}/draft")
async def draft_reply(
    signal_id: UUID,
    body: DraftBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Draft a reply with AI on demand (one tool-less agent turn over the thread).

    Returns the draft text for the composer; nothing is sent or persisted.
    """
    from sqlalchemy import select

    from app.models.signal import Signal
    from app.services.agent.loop import AgentLoop
    from app.services.assistant_threads import signal_chat_history
    from app.services.routing import resolve_agent_for_signal

    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == auth.tenant.id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")

    agent = await resolve_agent_for_signal(session, signal)
    if not agent:
        raise HTTPException(status_code=409, detail="No active agent for this workspace")

    history = await signal_chat_history(session, signal.id)
    extra = (body.instruction or "").strip()
    # Operator can pass a full rewrite/compose brief (Compose with AI). When the
    # brief already asks for customer-facing output, use it as-is; otherwise
    # treat it as optional guidance on top of a default draft prompt.
    if extra and (
        "Output only" in extra
        or "customer-facing" in extra.lower()
        or "Current draft:" in extra
    ):
        instruction = extra
    else:
        instruction = (
            "Draft a concise, professional reply to the latest customer message. "
            "Output only the customer-facing body. Do not repeat these instructions."
        )
        if extra:
            instruction += f"\nOperator guidance: {extra}"

    loop = AgentLoop(
        session,
        auth.tenant.id,
        auth.user.id,
        agent=agent,
        signal_id=signal.id,
        user_role=auth.role,
    )
    loop.tools = []
    draft_text, tokens = await loop.run_chat(
        [*history, {"role": "user", "content": instruction}]
    )
    from app.services.suggestion_format import split_suggestion

    cleaned = split_suggestion(draft_text or "").body
    return {"draft": cleaned or (draft_text or "").strip(), "usage": tokens}


class InvokeAgentBody(BaseModel):
    agent_id: UUID | None = None
    instruction: str = ""
    output: str = "note"  # note | reply_suggestion


@router.post(
    "/{signal_id}/invoke-agent",
    dependencies=[Depends(rate_limit("invoke-agent", limit=20))],
)
async def invoke_agent(
    signal_id: UUID,
    body: InvokeAgentBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Invoke an agent inline on a thread (via @agent mention or explicit ask).

    The agent gets the thread transcript plus the operator's instruction. Its
    output lands as an internal note for the team, or as a reply suggestion
    (decision card) when `output=reply_suggestion`.
    """
    from sqlalchemy import select

    from app.models.agent import Agent
    from app.models.signal import Signal

    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == auth.tenant.id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")

    from app.services.lead_agent import get_lead_agent

    if body.agent_id:
        agent_result = await session.execute(
            select(Agent).where(Agent.id == body.agent_id, Agent.tenant_id == auth.tenant.id)
        )
        agent = agent_result.scalar_one_or_none()
    else:
        agent = await get_lead_agent(session, auth.tenant.id)
    if not agent or not agent.is_active:
        raise HTTPException(status_code=404, detail="Agent not found or inactive")

    from app.services.thread_dispatch import run_agent_note

    if body.output == "reply_suggestion":
        from app.services.agent.loop import AgentLoop
        from app.services.assistant_threads import signal_chat_history
        from app.services.inbound_agent import create_reply_suggestion
        from app.services.suggestion_format import split_suggestion

        history = await signal_chat_history(session, signal.id)
        instruction = (
            "Draft a concise, professional reply to the latest customer message. "
            "Output ONLY the customer-facing email body starting with a greeting. "
            "Never mention Govern, decisions, concept cards, or these instructions."
        )
        operator = (body.instruction or "").strip()
        if operator:
            instruction += f"\nTeammate's request: {operator}"
        loop = AgentLoop(
            session, auth.tenant.id, auth.user.id, agent=agent, signal_id=signal.id, user_role=auth.role
        )
        reply_text, tokens = await loop.run_chat([*history, {"role": "user", "content": instruction}])
        text = (reply_text or "").strip() or "No output produced."
        text = split_suggestion(text).body or text
        outcome = await create_reply_suggestion(session, auth.tenant.id, signal, agent, reply_text=text)
        return {"output": "reply_suggestion", "usage": tokens, **outcome}

    message = await run_agent_note(
        session,
        auth.tenant.id,
        auth.user.id,
        signal,
        agent,
        operator_text=body.instruction or "",
        user_role=auth.role,
    )
    meta = json.loads(message.metadata_json or "{}")
    return {"output": "note", "usage": meta.get("usage"), "message": svc.serialize_message(message)}


class AssigneePerson(BaseModel):
    id: int
    uuid: str
    name: str
    email: str
    avatar_url: str | None = None
    presence: str
    can_handle: bool
    reason: str = ""


class AssigneeAgent(BaseModel):
    id: str
    name: str
    can_handle: bool
    reason: str = ""
    status: Literal["standby", "working", "error"] = "standby"
    avatar_kind: str | None = None
    avatar_icon: str | None = None
    avatar_color: str | None = None
    avatar_image_url: str | None = None


class AssigneeTeamPresence(BaseModel):
    status: Literal["available", "away", "offline", "standby", "working"]


class AssigneeTeam(BaseModel):
    id: str
    name: str
    kind: str
    can_handle: bool = True
    reason: str = ""
    presence: AssigneeTeamPresence | None = None
    avatar_kind: str | None = None
    avatar_icon: str | None = None
    avatar_color: str | None = None
    avatar_image_url: str | None = None


class AssigneeCandidates(BaseModel):
    people: list[AssigneePerson]
    agents: list[AssigneeAgent]
    teams: list[AssigneeTeam]


@router.get("/{signal_id}/assignees", response_model=AssigneeCandidates)
async def list_assignees(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """People, agents and teams this conversation can go to, for the assign picker and @mentions.

    Everyone is listed. Those without Handle access on the conversation's channel
    have ``can_handle`` false and a ``reason`` so the UI can grey them out.
    """
    from app.models.signal import Signal
    from app.services.ownership import assignee_candidates

    signal = await session.get(Signal, signal_id)
    if signal is None or signal.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Signal not found")
    return await assignee_candidates(session, auth.tenant.id, signal)


@router.get("/{signal_id}/agent-candidates")
async def list_agent_candidates(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Agents the operator can bring into this thread, most relevant first."""
    from app.services import agent_sessions

    items = await agent_sessions.thread_agent_candidates(
        session,
        auth.tenant.id,
        auth.user,
        signal_id,
        is_admin=auth.role in ("owner", "admin"),
    )
    return {"items": items}


@router.post("/{signal_id}/example")
async def mark_conversation_example(
    signal_id: UUID,
    body: ExampleBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Opt a closed conversation into or out of few-shot learning."""
    from app.models.signal import Signal
    from app.services.audit import record_audit

    signal = (
        await session.execute(
            select(Signal).where(
                Signal.id == signal_id, Signal.tenant_id == auth.tenant.id
            )
        )
    ).scalar_one_or_none()
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")
    if body.use_as_example and signal.status != "closed":
        raise HTTPException(status_code=409, detail="Only closed conversations can be examples")
    before = signal.is_example
    signal.is_example = body.use_as_example
    session.add(signal)
    await record_audit(
        session,
        auth.tenant.id,
        action="signal:example_marked" if body.use_as_example else "signal:example_unmarked",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="signal",
        resource_id=signal.id,
        before={"is_example": before},
        after={"is_example": signal.is_example},
        commit=False,
    )
    await session.commit()
    return {"signal_id": str(signal.id), "is_example": signal.is_example}


@router.post("/{signal_id}/sessions")
async def start_agent_session(
    signal_id: UUID,
    body: SessionStartBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Bring an agent into the thread: opens an inline agent session."""
    from app.services import agent_sessions

    agent = await agent_sessions.resolve_session_agent(
        session,
        auth.tenant.id,
        auth.user,
        signal_id,
        body.agent_id,
        is_admin=auth.role in ("owner", "admin"),
    )
    return await agent_sessions.start_session(
        session, auth.tenant.id, auth.user, signal_id, agent
    )


@router.post("/{signal_id}/sessions/{session_id}/close")
async def close_agent_session(
    signal_id: UUID,
    session_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Checkout: freeze the session; its outcome collapses into the timeline."""
    from app.services import agent_sessions

    return await agent_sessions.close_session(
        session, auth.tenant.id, auth.user.id, signal_id, session_id
    )


@router.delete("/{signal_id}/sessions/{session_id}")
async def discard_agent_session(
    signal_id: UUID,
    session_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Cancel a session that has no turns yet; nothing lands in the timeline."""
    from app.services import agent_sessions

    return await agent_sessions.discard_session(
        session, auth.tenant.id, auth.user.id, signal_id, session_id
    )


@router.post("/{signal_id}/notes")
async def add_note(
    signal_id: UUID,
    body: NoteBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    message = await svc.reply_to_thread(
        session,
        auth.tenant.id,
        auth.user.id,
        _num(auth),
        signal_id,
        body_text=body.body_text,
        direction="internal",
        kind="internal_note",
        attachments=body.attachments,
        actor_role=auth.role,
    )
    if not message:
        raise HTTPException(status_code=404, detail="Signal not found")
    return message


class HandledExternallyBody(BaseModel):
    """The conversation was settled outside Bokito."""

    channel: Literal["phone", "whatsapp", "email", "other"] = "other"
    note: str = ""
    close: bool = False
    # UI language for the timeline line ("Afgehandeld via telefoon door ...").
    language: str = ""


@router.post("/{signal_id}/handled-externally")
async def handled_externally(
    signal_id: UUID,
    body: HandledExternallyBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Log that the conversation was handled by phone, WhatsApp, another
    mailbox or elsewhere.

    Writes a system line on the timeline, clears unread, sets aside open AI
    reply proposals (reason ``handled_externally``), counts as the team's
    reply for needs-reply, and optionally closes the conversation.
    """
    await _require_handle(session, auth, signal_id)
    message = await svc.mark_handled_externally(
        session,
        auth.tenant.id,
        auth.user.id,
        signal_id,
        channel=body.channel,
        note=body.note,
        close=body.close,
        language=body.language,
    )
    if not message:
        raise HTTPException(status_code=404, detail="Signal not found")
    return message


@router.get("/{signal_id}/notes")
async def list_notes(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    signal = await svc.get_thread(session, auth.tenant.id, auth.user.id, signal_id)
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    return await svc.list_notes(session, auth.tenant.id, signal_id)


@router.patch("/{signal_id}/notes/{message_id}")
async def update_note(
    signal_id: UUID,
    message_id: UUID,
    body: NotePatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    note = await svc.update_note(
        session,
        auth.tenant.id,
        signal_id,
        message_id,
        body_text=body.body_text,
        author_user_id=auth.user.id,
        author_name=auth.user.display_name or auth.user.email,
    )
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.delete("/{signal_id}/notes/{message_id}")
async def delete_note(
    signal_id: UUID,
    message_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    ok = await svc.delete_note(session, auth.tenant.id, signal_id, message_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True}


@router.post("/{signal_id}/pin")
async def pin_signal(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.pin_thread(session, auth.tenant.id, auth.user.id, signal_id)
    return {"ok": True}


@router.delete("/{signal_id}/pin")
async def unpin_signal(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.unpin_thread(session, auth.tenant.id, auth.user.id, signal_id)
    return {"ok": True}


class SplitBody(BaseModel):
    from_message_id: UUID
    category_id: UUID | None = None


class SplitResult(BaseModel):
    signal_id: str
    parent_signal_id: str


@router.post("/{signal_id}/split", response_model=SplitResult)
async def split_signal(
    signal_id: UUID,
    body: SplitBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Move the messages from ``from_message_id`` on into a new linked conversation.

    The new conversation keeps the contact, channel and provider thread; later
    inbound replies on that thread land there. ``category_id`` files its
    category right away.
    """
    from app.services.conversation_split import resolve_category, split_conversation

    category = (
        await resolve_category(session, auth.tenant.id, str(body.category_id))
        if body.category_id
        else None
    )
    child = await split_conversation(
        session,
        auth.tenant.id,
        signal_id,
        from_message_id=body.from_message_id,
        category=category,
        actor_type="user",
        actor_id=str(auth.user.id),
    )
    return SplitResult(signal_id=str(child.id), parent_signal_id=str(signal_id))


@router.post("/{signal_id}/messages/{message_id}/resolve")
async def resolve_decision(
    signal_id: UUID,
    message_id: UUID,
    body: ResolveBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.resolve_message_decision(
        session,
        auth.tenant.id,
        auth.user.id,
        signal_id,
        message_id,
        action=body.action,
        option_id=body.option_id,
        option_ids=body.option_ids,
        body=body.body or body.body_text,
        body_html=body.body_html,
        subject=body.subject,
        response_text=body.response_text,
        send_as=body.send_as,
        messages=body.messages,
    )


@router.post("/{signal_id}/triage")
async def triage_signal_endpoint(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Re-queue inbound processing so the channel agent re-reads the thread.

    Interpretation is no longer a separate LLM call; the linked channel agent
    runs ``record_thread_read`` (and reply tools when AI handling allows).
    """
    from app.models.signal import Signal
    from app.workers.tasks import enqueue_signal_processing

    row = await session.get(Signal, signal_id)
    if row is None or row.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Signal not found")
    await enqueue_signal_processing(str(auth.tenant.id), str(signal_id))
    return {"queued": True, "signal_id": str(signal_id)}


class ContactLinkBody(BaseModel):
    """Who this conversation is. Give an existing ``contact_id`` or an email /
    phone number; name is used when a new contact is created."""

    contact_id: UUID | None = None
    email: str = ""
    phone: str = ""
    name: str = ""


class ContactLinkCandidate(BaseModel):
    id: str
    display_name: str
    address: str


class ContactLinkResult(BaseModel):
    """``linked`` / ``created``: the thread now points at ``contact_id``.
    ``choose``: more than one contact matches; post again with one of the
    ``candidates`` as ``contact_id``. ``unchanged``: already linked."""

    status: str
    contact_id: str | None = None
    contact_name: str = ""
    basis: str = ""
    candidates: list[ContactLinkCandidate] = []


class ContactUnlinkResult(BaseModel):
    ok: bool
    contact_id: str | None = None


async def _tenant_signal_or_404(session: AsyncSession, tenant_id: UUID, signal_id: UUID):
    from app.models.signal import Signal

    signal = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")
    return signal


@router.post("/{signal_id}/contact-link", response_model=ContactLinkResult)
async def link_conversation_contact(
    signal_id: UUID,
    body: ContactLinkBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Link the conversation to a person (basis ``manual``).

    The visitor row becomes an identity of the person; no address is
    overwritten. Linking a conversation that already belongs to another
    known person merges the two and needs owner or admin.
    """
    from app.models.channel import Contact
    from app.services import contact_identity as identity
    from app.services.audit import record_audit

    signal = await _tenant_signal_or_404(session, auth.tenant.id, signal_id)
    if body.contact_id is not None:
        target = await session.get(Contact, body.contact_id)
        if target is None or target.tenant_id != auth.tenant.id:
            raise HTTPException(status_code=404, detail="Contact not found")
        person = await identity.canonical(session, target)
        current = None
        if signal.contact_id:
            current = await identity.canonical(session, await session.get(Contact, signal.contact_id))
        if current is not None and current.id == person.id and signal.contact_basis:
            return ContactLinkResult(
                status="unchanged",
                contact_id=str(person.id),
                contact_name=person.display_name,
                basis=signal.contact_basis,
            )
        proposal = identity.LinkProposal(
            outcome="link",
            basis="manual",
            person=person,
            needs_merge=current is not None
            and current.id != person.id
            and not identity.is_anonymous(current),
        )
    else:
        proposal = await identity.resolve_link(
            session,
            auth.tenant,
            signal,
            email=body.email,
            phone=body.phone,
            name=body.name,
            basis="manual",
        )
        if proposal.reason == "no_identifier":
            raise HTTPException(status_code=400, detail="A valid email address or phone number is required")
        if proposal.reason == "member":
            raise HTTPException(status_code=400, detail="This address belongs to a teammate")
        if proposal.outcome == "suggest":
            return ContactLinkResult(
                status="choose",
                candidates=[
                    ContactLinkCandidate(
                        id=str(c.id), display_name=c.display_name, address=c.address
                    )
                    for c in proposal.candidates
                ],
            )
        if proposal.outcome == "none":
            person = proposal.person
            return ContactLinkResult(
                status="unchanged",
                contact_id=str(person.id) if person else None,
                contact_name=person.display_name if person else "",
                basis=signal.contact_basis or "",
            )
    if proposal.needs_merge:
        auth.require_role("owner", "admin")
    created = proposal.outcome == "create"
    person = await identity.apply_link(
        session, signal, proposal, actor_type="user", actor_id=str(auth.user.id)
    )
    await record_audit(
        session,
        auth.tenant.id,
        action="signal:contact_linked",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="signal",
        resource_id=signal.id,
        after={"contact_id": str(person.id), "basis": "manual", "merged": proposal.needs_merge},
        commit=False,
    )
    await session.commit()
    return ContactLinkResult(
        status="created" if created else "linked",
        contact_id=str(person.id),
        contact_name=person.display_name,
        basis="manual",
    )


@router.delete("/{signal_id}/contact-link", response_model=ContactUnlinkResult)
async def unlink_conversation_contact(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Undo the latest contact link on this conversation. Undoing an AI link
    is recorded as learning feedback."""
    from app.services import contact_identity as identity
    from app.services.audit import record_audit

    signal = await _tenant_signal_or_404(session, auth.tenant.id, signal_id)
    undone = await identity.unlink(
        session, signal, actor_type="user", actor_id=str(auth.user.id), user_id=auth.user.id
    )
    if not undone:
        raise HTTPException(status_code=404, detail="No contact link to undo")
    await record_audit(
        session,
        auth.tenant.id,
        action="signal:contact_unlinked",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="signal",
        resource_id=signal.id,
        after={"contact_id": str(signal.contact_id) if signal.contact_id else None},
        commit=False,
    )
    await session.commit()
    return ContactUnlinkResult(
        ok=True, contact_id=str(signal.contact_id) if signal.contact_id else None
    )
