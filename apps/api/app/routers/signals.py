"""Unified SENSING endpoints (Signal model) with inbox-parity for Messages hub."""

import json
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth, require_verified_email
from app.middleware.rate_limit import rate_limit
from app.models.auth import user_numeric_id
from app.services import signal_tags as tag_svc
from app.services import signal_threads as svc
from app.services.channel_visibility import visible_channel_account_ids
from app.services.interpretation import triage_signal
from app.services.signals import create_inbound_signal, serialize_signal

router = APIRouter(prefix="/signals", tags=["signals"])


class InboundSignalBody(BaseModel):
    channel: str = "email"
    source: str = "mock"
    subject: str = ""
    body_text: str
    contact_email: str = ""
    contact_name: str = ""
    external_id: str = ""


class ThreadPatch(BaseModel):
    status: str | None = None
    assigned_to_user_id: int | None = None
    tags: list[str] | None = None
    priority: str | None = None
    project_id: UUID | None = None
    # Set a wake time to snooze (status flips to pending); null clears it.
    snoozed_until: datetime | None = None


class BulkBody(BaseModel):
    signal_ids: list[UUID]
    action: str  # close | reopen | spam | read | unread | assign | snooze
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
    body: str | None = None
    body_text: str | None = None
    body_html: str | None = None
    subject: str | None = None
    response_text: str | None = None
    # Sender identity for approved reply suggestions: "user" (default) or "agent".
    send_as: str | None = None


class SessionStartBody(BaseModel):
    """Inline agent session: which agent to bring into the thread."""

    agent_id: UUID | None = None


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
    action: str = "auto_close"  # auto_close | auto_task | mute_ai
    label: str = ""


class RulePatchBody(BaseModel):
    action: str | None = None
    status: str | None = None  # active | paused
    label: str | None = None


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
        .where(SavedReply.tenant_id == auth.tenant.id)
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
        select(SavedReply).where(SavedReply.id == reply_id, SavedReply.tenant_id == auth.tenant.id)
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
        select(SavedReply).where(SavedReply.id == reply_id, SavedReply.tenant_id == auth.tenant.id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Saved reply not found")
    await session.delete(row)
    await session.commit()
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


class TagCreateBody(BaseModel):
    name: str
    description: str = ""


class TagPatchBody(BaseModel):
    new_tag: str | None = None
    description: str | None = None


@router.get("/tags")
async def list_signal_tags(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Tenant tag registry with usage counts (powers the Tags sidebar section,
    the thread tag picker, and the AI tagging vocabulary)."""
    return {
        "items": await tag_svc.catalog(
            session,
            auth.tenant.id,
            visible_account_ids=await visible_channel_account_ids(
                session, auth.tenant.id, user_id=auth.user.id, role=auth.role
            ),
        )
    }


@router.post("/tags")
async def create_signal_tag(
    body: TagCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Add a tag to the tenant vocabulary before any thread uses it."""
    try:
        row = await tag_svc.create_tag(
            session,
            auth.tenant.id,
            auth.user.id,
            name=body.name,
            description=body.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"tag": row.name, "description": row.description}


def _require_tag_admin(auth: AuthContext) -> None:
    if not (auth.is_staff or auth.role in ("owner", "admin")):
        raise HTTPException(status_code=403, detail="Only admins can manage tags")


@router.patch("/tags/{tag}")
async def update_signal_tag(
    tag: str,
    body: TagPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Rename a tag across every thread and/or set its AI guidance (admin only)."""
    _require_tag_admin(auth)
    if body.new_tag is not None and not body.new_tag.strip():
        raise HTTPException(status_code=400, detail="new_tag cannot be empty")
    if body.new_tag is None and body.description is None:
        raise HTTPException(status_code=400, detail="nothing to update")
    return await tag_svc.update_tag(
        session,
        auth.tenant.id,
        auth.user.id,
        tag=tag,
        new_name=body.new_tag,
        description=body.description,
    )


@router.delete("/tags/{tag}")
async def delete_signal_tag(
    tag: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Remove a tag from the vocabulary and from every thread (admin only)."""
    _require_tag_admin(auth)
    changed = await tag_svc.delete_tag(session, auth.tenant.id, auth.user.id, tag=tag)
    return {"changed": changed}


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
    agent_id: str | None = Query(None),
    unread: bool = Query(False),
    needs_reply: bool = Query(False),
    needs_decision: bool = Query(False),
    pinned: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
):
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
        agent_id=agent_id,
        unread=unread,
        needs_reply=needs_reply,
        needs_decision=needs_decision,
        pinned_only=pinned,
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
):
    detail = await svc.get_thread(
        session,
        auth.tenant.id,
        auth.user.id,
        signal_id,
        visible_account_ids=await visible_channel_account_ids(
            session, auth.tenant.id, user_id=auth.user.id, role=auth.role
        ),
    )
    if not detail:
        raise HTTPException(status_code=404, detail="Signal not found")
    return detail


@router.patch("/{signal_id}")
async def patch_signal(
    signal_id: UUID,
    body: ThreadPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    updates = body.model_dump(exclude_unset=True)
    project_id_set = "project_id" in updates
    project_id = updates.pop("project_id", None)
    snoozed_until_set = "snoozed_until" in updates
    snoozed_until = updates.pop("snoozed_until", None)
    thread = await svc.patch_thread(
        session,
        auth.tenant.id,
        auth.user.id,
        _num(auth),
        signal_id,
        status=updates.get("status"),
        assigned_to_user_id=updates.get("assigned_to_user_id"),
        tags=updates.get("tags"),
        priority=updates.get("priority"),
        project_id=project_id,
        project_id_set=project_id_set,
        snoozed_until=snoozed_until,
        snoozed_until_set=snoozed_until_set,
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
    """Bulk operator actions on threads (close/reopen/spam/read/unread/assign/snooze)."""
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
    instruction = (
        "Draft a concise, professional reply to the latest customer message. "
        "Output only the customer-facing body. Do not repeat these instructions."
    )
    extra = (body.instruction or "").strip()
    if extra:
        instruction += f"\nOperator guidance: {extra}"

    loop = AgentLoop(
        session,
        auth.tenant.id,
        auth.user.id,
        agent=agent,
        signal_id=signal.id,
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
    from app.services.agent.loop import AgentLoop
    from app.services.assistant_threads import signal_chat_history

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

    history = await signal_chat_history(session, signal.id)
    operator = (body.instruction or "").strip()
    if body.output == "reply_suggestion":
        instruction = (
            "Draft a concise, professional reply to the latest customer message. "
            "Output ONLY the customer-facing email body starting with a greeting. "
            "Never mention Govern, decisions, concept cards, or these instructions."
        )
    else:
        instruction = (
            "Help a teammate on this conversation: answer their question, look "
            "things up, or propose next steps. Reply as a concise internal note "
            "for the team (the customer will not see it). Do not repeat these "
            "instructions."
        )
    if operator:
        instruction += f"\nTeammate's request: {operator}"

    loop = AgentLoop(
        session,
        auth.tenant.id,
        auth.user.id,
        agent=agent,
        signal_id=signal.id,
    )
    reply_text, tokens = await loop.run_chat(
        [*history, {"role": "user", "content": instruction}]
    )
    text = (reply_text or "").strip() or "No output produced."
    if body.output == "reply_suggestion":
        from app.services.suggestion_format import split_suggestion

        text = split_suggestion(text).body or text

    if body.output == "reply_suggestion":
        from app.services.inbound_agent import create_reply_suggestion

        outcome = await create_reply_suggestion(
            session, auth.tenant.id, signal, agent, reply_text=text
        )
        return {"output": "reply_suggestion", "usage": tokens, **outcome}

    from app.gateway.publish import publish_signal_message
    from app.models.signal import SignalEvent, SignalMessage

    now = datetime.utcnow()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=auth.tenant.id,
        kind="internal_note",
        direction="internal",
        role="assistant",
        author_agent_id=agent.id,
        from_address="",
        to_addresses="",
        subject=signal.subject,
        body_text=text,
        body_preview=text[:200],
        body_html=f"<p>{text}</p>",
        metadata_json=json.dumps(
            {
                "usage": tokens,
                "steps": list(loop.trace_steps),
                "invoked_by_user_id": str(auth.user.id),
                "agent_name": agent.name,
            }
        ),
        received_at=now,
    )
    session.add(message)
    signal.updated_at = now
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=auth.tenant.id,
            event_type="agent_invoked",
            actor_type="user",
            actor_id=str(auth.user.id),
            payload_json=json.dumps({"agent_id": str(agent.id), "agent_name": agent.name}),
        )
    )
    await session.commit()
    await session.refresh(message)
    await publish_signal_message(signal, message)
    return {
        "output": "note",
        "usage": tokens,
        "message": svc.serialize_message(message),
    }


@router.post("/{signal_id}/takeover")
async def takeover_thread(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Human takes over a thread; the AI stops auto-replying until released."""
    result = await svc.set_ai_paused(
        session, auth.tenant.id, auth.user.id, signal_id, paused=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Signal not found")
    return result


@router.post("/{signal_id}/release")
async def release_thread(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Hand the thread back to the AI agent."""
    result = await svc.set_ai_paused(
        session, auth.tenant.id, auth.user.id, signal_id, paused=False
    )
    if not result:
        raise HTTPException(status_code=404, detail="Signal not found")
    return result


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
        body=body.body or body.body_text,
        body_html=body.body_html,
        subject=body.subject,
        response_text=body.response_text,
        send_as=body.send_as,
    )


@router.post("/{signal_id}/triage")
async def triage_signal_endpoint(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await triage_signal(session, auth.tenant.id, signal_id)
    return result
