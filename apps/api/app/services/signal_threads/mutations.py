"""Patch, read state, notes, and delete for a conversation."""

from __future__ import annotations

from app.core.time import utcnow

import json
import logging
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_thread_update
from app.models.agent import Agent
from app.models.auth import User, user_numeric_id
from app.services.ownership import (
    owner_payload,
    picked_up_event,
    resolve_assignee,
    set_owner,
)
from app.models.notification import DecisionRequest, Notification
from app.models.signal import (
    Signal,
    SignalEvent,
    SignalMessage,
    SignalThreadPin,
)


logger = logging.getLogger(__name__)



async def update_note(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    message_id: UUID,
    *,
    body_text: str,
    author_user_id: UUID | None = None,
    author_name: str = "",
) -> dict[str, Any] | None:
    from app.services.signal_threads.reply import MENTION_PATTERN, notify_mentions
    from app.services.signal_threads.serialize import clean_message_preview, serialize_message
    result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "internal_note",
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return None
    prev_mentions = {int(num) for _, num in MENTION_PATTERN.findall(message.body_text or "")}
    message.body_text = body_text
    message.body_preview = clean_message_preview(body_text, limit=200)
    # Notes are created with a body_html mirror (see reply_to_thread); keep it
    # in sync or the timeline keeps rendering the stale HTML after an edit.
    message.body_html = f"<p>{body_text}</p>"
    session.add(message)
    await session.commit()
    # A mention added during the edit must still ping the teammate; mentions
    # that were already in the note stay silent (no duplicate notifications).
    new_mentions = {int(num) for _, num in MENTION_PATTERN.findall(body_text or "")}
    added = new_mentions - prev_mentions
    if added:
        signal = await _get_signal_row(session, tenant_id, signal_id)
        if signal:
            added_only = MENTION_PATTERN.sub(
                lambda m: m.group(0) if int(m.group(2)) in added else f"@{m.group(1)}",
                body_text or "",
            )
            await notify_mentions(
                session,
                tenant_id,
                signal,
                body_text=added_only,
                author_user_id=author_user_id,
                author_name=author_name,
            )
    return serialize_message(message)


async def delete_note(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    message_id: UUID,
) -> bool:
    result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "internal_note",
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return False
    await session.delete(message)
    await session.commit()
    return True


async def list_notes(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
) -> list[dict[str, Any]]:
    from app.services.signal_threads.serialize import serialize_message
    result = await session.execute(
        select(SignalMessage)
        .where(
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "internal_note",
        )
        .order_by(SignalMessage.created_at)
    )
    return [serialize_message(m) for m in result.scalars().all()]


async def _get_signal_row(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID, *, include_deleted: bool = False
) -> Signal | None:
    query = select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    if not include_deleted:
        from app.services.trash import alive

        query = query.where(alive(Signal))
    result = await session.execute(query)
    return result.scalar_one_or_none()


async def patch_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    status: str | None = None,
    assigned_to_user_id: int | None = None,
    tags: list[str] | None = None,
    priority: str | None = None,
    project_id: UUID | None = None,
    project_id_set: bool = False,
    assignee: dict[str, Any] | None = None,
    channel_account_id: UUID | None = None,
    channel_account_id_set: bool = False,
    actor_role: str = "member",
) -> dict[str, Any] | None:
    from app.services.signal_threads.pins import _pinned_ids
    from app.services.signal_threads.reply import _rebind_email_account_for_reply, reply_to_thread
    from app.services.signal_threads.serialize import serialize_thread
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    before_status = signal.status
    before_assignee = signal.assigned_user_id
    before_owner = owner_payload(signal)
    if channel_account_id_set:
        if channel_account_id is None:
            raise HTTPException(status_code=422, detail="channel_account_id is required")
        await _rebind_email_account_for_reply(
            session,
            signal,
            channel_account_id=channel_account_id,
            user_id=user_id,
            actor_role=actor_role,
        )
    if status is not None:
        signal.status = status
        if status != "snoozed":
            signal.hidden_until = None
    newly_assigned: UUID | None = None
    if assignee is None and assigned_to_user_id is not None:
        # Shorthand from the person picker: 0 clears to the channel's owner team.
        assignee = (
            {"kind": "user", "id": assigned_to_user_id}
            if assigned_to_user_id
            else {"kind": "department", "id": None}
        )
    if assignee is not None:
        kind = str(assignee.get("kind") or "")
        try:
            owner_id = await resolve_assignee(session, tenant_id, signal, kind, assignee.get("id"))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if kind == "user" and owner_id != signal.assigned_user_id and owner_id != user_id:
            newly_assigned = owner_id
        set_owner(signal, kind, owner_id, by_user_id=user_id)
    tags_added: list[str] | None = None
    tags_removed: list[str] | None = None
    if tags is not None:
        from app.services.signal_tags import set_signal_tags

        # Operator-typed tags join the tenant vocabulary, so the sidebar,
        # settings, and agent tagging all see the same list.
        tag_outcome = await set_signal_tags(session, tenant_id, signal.id, tags, user_id=user_id)
        tags = tag_outcome["tags"]
        tags_added = tag_outcome["added"]
        tags_removed = tag_outcome["removed"]
    if priority is not None:
        signal.priority = priority
    if project_id_set:
        from app.services.folders import file_in_folder

        # Filing adds the folder's tags; the folder itself follows from the tags.
        try:
            await file_in_folder(
                session, signal, project_id, user_id=user_id, actor_type="user", actor_id=str(user_id)
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Folder not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    signal.updated_at = utcnow()
    if signal.status != before_status and signal.status in {"pending", "closed", "spam"}:
        parked = {
            "pending": "human_snoozed",
            "closed": "human_closed",
            "spam": "human_spam",
        }[signal.status]
        await _defer_open_reply_suggestions(session, tenant_id, signal_id, reason=parked)
        # Closed / spam must not keep an unread bit that could inflate badges.
        if signal.status in {"closed", "spam"}:
            signal.has_unread = False
    from app.services import ai_handling as handling_svc

    if signal.status != before_status:
        handling_svc.on_status_change(session, signal, actor_id=str(user_id))
        if signal.status == "closed":
            from app.services.tickets import settle_ticket_on_close

            await settle_ticket_on_close(session, signal, actor_type="user", actor_id=str(user_id))
    handling_svc.on_assignment_change(
        session,
        signal,
        before_assignee=before_assignee,
        before_kind=before_owner["kind"],
        actor_id=str(user_id),
    )
    owner_changed = owner_payload(signal) != before_owner
    session.add(signal)
    if owner_changed:
        from app.services.thread_schedule import sync_rule_runner

        await sync_rule_runner(session, signal)
    self_pick = (
        owner_changed
        and before_owner["kind"] == "department"
        and signal.assignee_kind == "user"
        and signal.assigned_user_id == user_id
    )
    if self_pick:
        before_team = UUID(before_owner["team_id"]) if before_owner.get("team_id") else None
        session.add(await picked_up_event(session, signal, user_id, before_team, via="pick_up"))
    elif owner_changed:
        session.add(
            SignalEvent(
                signal_id=signal_id,
                tenant_id=tenant_id,
                event_type="assigned",
                actor_type="user",
                actor_id=str(user_id),
                payload_json=json.dumps({"before": before_owner, "after": owner_payload(signal)}),
            )
        )
    patch_payload: dict[str, Any] = {
        "status": status,
        "priority": priority,
        "project_id": str(project_id) if project_id else None,
        "assigned_to": assigned_to_user_id,
        "tags": tags,
    }
    if tags_added is not None:
        patch_payload["tags_added"] = tags_added
    if tags_removed is not None:
        patch_payload["tags_removed"] = tags_removed
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type="thread_updated",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps(patch_payload),
        )
    )
    # Govern audit only for the mutations that matter (status / assignee) —
    # tag/priority tweaks stay thread-timeline-only to avoid audit noise.
    if signal.status != before_status or owner_changed:
        from app.services.audit import record_audit

        await record_audit(
            session,
            tenant_id,
            action="signal:updated",
            actor_type="user",
            actor_id=user_id,
            resource_type="signal",
            resource_id=signal_id,
            summary=(signal.subject or "")[:120],
            before={"status": before_status, "owner": before_owner},
            after={"status": signal.status, "owner": owner_payload(signal)},
            commit=False,
        )
    await session.commit()
    await session.refresh(signal)
    if owner_changed and signal.assignee_kind == "agent":
        from app.workers.tasks import assignment_should_wake_agent, enqueue_signal_processing

        if await assignment_should_wake_agent(session, signal):
            await enqueue_signal_processing(str(tenant_id), str(signal.id))
    from app.models.auth import Tenant

    handling = (
        await handling_svc.resolve_for_signal(session, await session.get(Tenant, tenant_id), signal)
    ).to_payload()
    await publish_thread_update(signal, ai_handling=handling)
    if signal.status == "closed" and before_status != "closed":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    handover = str((assignee or {}).get("message") or "").strip()
    if owner_changed and handover:
        # The handover note mentions the new owner, so the mention path notifies
        # the person, runs the agent, or follows the team's pickup.
        markup = await _owner_mention_markup(session, signal)
        await reply_to_thread(
            session,
            tenant_id,
            user_id,
            user_num,
            signal_id,
            body_text=f"{markup} {handover}".strip(),
            direction="internal",
            kind="internal_note",
            actor_role=actor_role,
        )
        await session.refresh(signal)
    elif newly_assigned:
        await _notify_assignment(session, tenant_id, signal, assignee_id=newly_assigned, actor_id=user_id)
    pinned = await _pinned_ids(session, tenant_id, user_id)
    from app.services.signal_tags import signal_tag_names
    from app.services.tickets import ticket_payload

    return serialize_thread(
        signal,
        is_pinned=signal_id in pinned,
        user_num=user_num,
        ai_handling=handling,
        ticket=await ticket_payload(session, signal),
        tags=await signal_tag_names(session, signal.id),
    )


async def _owner_mention_markup(session: AsyncSession, signal: Signal) -> str:
    """``@[Name](kind:id)`` for the conversation's current owner."""
    from app.models.team import Team

    if signal.assignee_kind == "user" and signal.assigned_user_id:
        user = await session.get(User, signal.assigned_user_id)
        name = (user.display_name or user.email) if user else "Teammate"
        return f"@[{name}](user:{user_numeric_id(signal.assigned_user_id)})"
    if signal.assignee_kind == "agent" and signal.agent_id:
        agent = await session.get(Agent, signal.agent_id)
        return f"@[{agent.name if agent else 'Agent'}](agent:{signal.agent_id})"
    if signal.assignee_team_id:
        team = await session.get(Team, signal.assignee_team_id)
        return f"@[{team.name if team else 'Team'}](team:{signal.assignee_team_id})"
    return ""


async def _notify_assignment(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    assignee_id: UUID,
    actor_id: UUID,
) -> None:
    """Tell a teammate a conversation is theirs now (tier 1)."""
    from app.services.notify import TIER_NOW, notify

    from app.services.notify import from_user

    actor_result = await session.execute(select(User).where(User.id == actor_id))
    actor = actor_result.scalar_one_or_none()
    actor_name = (actor.display_name or actor.email) if actor else "A teammate"
    payload: dict[str, Any] = {}
    mark = from_user(actor)
    if mark:
        payload["from"] = mark
    await notify(
        session,
        tenant_id,
        kind="assignment",
        recipients=[assignee_id],
        title=f"{actor_name} assigned {signal.subject or 'a conversation'} to you",
        body=(signal.summary or "")[:300],
        tier=TIER_NOW,
        category="assigned-to-me",
        signal_id=signal.id,
        payload=payload or None,
    )


async def set_read(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    read: bool,
) -> dict[str, Any] | None:
    from app.services.signal_threads.pins import _pinned_ids
    from app.services.signal_threads.serialize import serialize_thread
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    signal.has_unread = not read
    session.add(signal)
    if read:
        from app.services.notify import mark_conversation_read

        await mark_conversation_read(session, tenant_id, user_id, signal_id)
    await session.commit()
    await session.refresh(signal)
    await publish_thread_update(signal)
    pinned = await _pinned_ids(session, tenant_id, user_id)
    return serialize_thread(signal, is_pinned=signal_id in pinned, user_num=user_num)


BULK_ACTIONS = ("close", "reopen", "spam", "read", "unread", "assign", "trash", "file")


async def bulk_update_threads(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    signal_ids: list[UUID],
    action: str,
    assignee_id: int | None = None,
    project_id: UUID | None = None,
) -> dict[str, Any]:
    """Apply one operator action to many threads at once (inbox bulk bar)."""
    from app.services.signal_threads.serialize import _user_map
    if action not in BULK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown bulk action: {action}")
    assignee_uuid: UUID | None = None
    if action == "assign":
        user_map = await _user_map(session, tenant_id)
        assignee_uuid = user_map.get(assignee_id) if assignee_id else None
        if not assignee_uuid:
            raise HTTPException(status_code=404, detail="Assignee not found")
    if action == "file":
        from app.models.project import Project

        if project_id is None:
            raise HTTPException(status_code=400, detail="Choose a folder")
        folder = (
            await session.execute(
                select(Project).where(
                    Project.id == project_id,
                    Project.tenant_id == tenant_id,
                    Project.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")

    result = await session.execute(
        select(Signal).where(
            Signal.tenant_id == tenant_id,
            Signal.id.in_(signal_ids),
            Signal.deleted_at.is_(None),
        )
    )
    signals = list(result.scalars().all())
    now = utcnow()
    before_states = {
        str(s.id): {"status": s.status, "assigned_user_id": str(s.assigned_user_id or "")}
        for s in signals
    }
    from app.services import ai_handling as handling_svc

    if action == "trash":
        from app.services.audit import record_audit
        from app.services.trash import load_tenant, move_to_bin

        tenant = await load_tenant(session, tenant_id)
        for signal in signals:
            await move_to_bin(
                session,
                tenant,
                resource_type="conversation",
                row=signal,
                user_id=user_id,
                title=signal.subject,
                commit=False,
            )
        if signals:
            await record_audit(
                session,
                tenant_id,
                action="signal:bulk_trash",
                actor_type="user",
                actor_id=user_id,
                resource_type="signal",
                resource_id=";".join(str(s.id) for s in signals[:50]),
                summary=f"Bulk trash on {len(signals)} thread(s)",
                before=before_states,
                after=None,
                commit=False,
            )
        await session.commit()
        for signal in signals:
            await publish_thread_update(signal)
        return {"updated": len(signals), "action": action}

    for signal in signals:
        before_assignee = signal.assigned_user_id
        if action == "close":
            signal.status = "closed"
            signal.has_unread = False
        elif action == "reopen":
            signal.status = "open"
        elif action == "spam":
            signal.status = "spam"
            signal.has_unread = False
        elif action == "read":
            signal.has_unread = False
        elif action == "unread":
            signal.has_unread = True
        elif action == "assign" and assignee_uuid is not None:
            # Same path as the person picker: owner, last human, and hand-back.
            set_owner(signal, "user", assignee_uuid, by_user_id=user_id)
        elif action == "file" and project_id is not None:
            from app.services.folders import file_in_folder

            await file_in_folder(
                session, signal, project_id, user_id=user_id, actor_type="user", actor_id=str(user_id)
            )
        if action == "close":
            handling_svc.on_status_change(session, signal, actor_id=str(user_id))
            from app.services.tickets import settle_ticket_on_close

            await settle_ticket_on_close(session, signal, actor_type="user", actor_id=str(user_id))
        elif action == "assign":
            handling_svc.on_assignment_change(
                session, signal, before_assignee=before_assignee, actor_id=str(user_id)
            )
        signal.updated_at = now
        session.add(signal)
        if action in ("close", "spam"):
            # A closed/spam thread must not keep a pending reply card in the
            # decision queue: nobody is going to send that draft anymore.
            await _defer_open_reply_suggestions(
                session, tenant_id, signal.id, reason="thread_closed"
            )
        if action in ("close", "reopen", "spam", "assign", "file"):
            event_payload: dict[str, Any] = {"bulk": action}
            if action == "assign" and assignee_id is not None:
                # The timeline chip names the assignee from this field.
                event_payload["assigned_to"] = assignee_id
            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=tenant_id,
                    event_type="thread_updated",
                    actor_type="user",
                    actor_id=str(user_id),
                    payload_json=json.dumps(event_payload),
                )
            )
    # One audit event per bulk action with the before-states; mark-read noise
    # (read/unread) is intentionally excluded from the govern audit.
    if signals and action in ("close", "reopen", "spam", "assign", "file"):
        from app.services.audit import record_audit

        await record_audit(
            session,
            tenant_id,
            action=f"signal:bulk_{action}",
            actor_type="user",
            actor_id=user_id,
            resource_type="signal",
            resource_id=";".join(str(s.id) for s in signals[:50]),
            summary=f"Bulk {action} on {len(signals)} thread(s)",
            before=before_states,
            after=(
                {"assignee_id": assignee_id}
                if action == "assign"
                else {"project_id": str(project_id)}
                if action == "file"
                else None
            ),
            commit=False,
        )
    await session.commit()
    for signal in signals:
        await publish_thread_update(signal)
    if action == "close":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        for signal in signals:
            if before_states[str(signal.id)]["status"] != "closed":
                await emit_webhook_event(
                    session, tenant_id, "signal.closed", signal_event_data(signal)
                )
    return {"updated": len(signals), "action": action}


async def delete_thread(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    user_id: UUID | None = None,
    permanent: bool = False,
    commit: bool = True,
) -> bool:
    signal = await _get_signal_row(session, tenant_id, signal_id, include_deleted=permanent)
    if not signal:
        return False
    if not permanent:
        from app.services.trash import load_tenant, move_to_bin

        tenant = await load_tenant(session, tenant_id)
        return await move_to_bin(
            session,
            tenant,
            resource_type="conversation",
            row=signal,
            user_id=user_id,
            title=signal.subject,
            commit=commit,
        )
    subject = signal.subject
    from app.models.agent_context import SignalCompaction
    from app.models.agent_turn import AgentAsk, AgentTurn

    for model in (AgentTurn, AgentAsk, SignalCompaction, SignalMessage, SignalEvent, SignalThreadPin):
        rows = await session.execute(select(model).where(model.signal_id == signal_id))
        for row in rows.scalars().all():
            await session.delete(row)

    # Clean up remaining FK references so Postgres does not reject the delete.
    from sqlalchemy import delete as sa_delete
    from sqlalchemy import update as sa_update

    from app.models.orchestration import AgentTask
    from app.models.platform_change import PlatformChange
    from app.models.trigger import Trigger

    # Decisions live inside the thread and are deleted with it; platform
    # changes keep their own record but lose the decision link.
    decision_ids = (
        (await session.execute(select(DecisionRequest.id).where(DecisionRequest.signal_id == signal_id)))
        .scalars()
        .all()
    )
    if decision_ids:
        await session.execute(
            sa_update(PlatformChange)
            .where(PlatformChange.decision_id.in_(decision_ids))  # type: ignore[attr-defined]
            .values(decision_id=None)
        )
        await session.execute(sa_delete(DecisionRequest).where(DecisionRequest.id.in_(decision_ids)))  # type: ignore[attr-defined]

    # Tasks and triggers outlive the thread; detach the reference.
    for ref_model in (AgentTask, Trigger):
        await session.execute(
            sa_update(ref_model).where(ref_model.signal_id == signal_id).values(signal_id=None)
        )

    await session.delete(signal)
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="signal:deleted",
        actor_type="user" if user_id else "system",
        actor_id=user_id or "",
        resource_type="signal",
        resource_id=signal_id,
        summary=(subject or "")[:120],
        commit=False,
    )
    if commit:
        await session.commit()
    return True


REPLY_SUGGESTION_TITLES = ("Suggested reply", "Reply to customer message")

# Why an open reply suggestion was set aside (stored in ``chosen_option_id``
# on a deferred DecisionRequest; the card renders a matching label).
DEFER_HUMAN_REPLIED = "human_replied"
DEFER_SUPERSEDED_BY_INBOUND = "superseded_by_inbound"
DEFER_SUPERSEDED_BY_EXTERNAL_REPLY = "superseded_by_external_reply"
DEFER_SIBLING_THREAD = "sibling_thread"
DEFER_HANDLED_EXTERNALLY = "handled_externally"


async def _defer_open_reply_suggestions(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    reason: str = DEFER_HUMAN_REPLIED,
    link_signal_id: UUID | None = None,
) -> int:
    """Set aside leftover 'Suggested reply' cards that no longer fit the thread.

    Runs when a human answered, when the contact wrote again (the draft no
    longer answers the latest message), when a colleague's reply from their
    own mailbox was logged, or when a newer conversation with the same person
    carries the live proposal. Only reply-suggestion cards are deferred;
    platform-change reviews and other awaiting_human decisions stay open.
    Returns how many cards were deferred.
    """
    result = await session.execute(
        select(DecisionRequest).where(
            DecisionRequest.tenant_id == tenant_id,
            DecisionRequest.signal_id == signal_id,
            DecisionRequest.status == "awaiting_human",
            DecisionRequest.platform_change_id.is_(None),
            DecisionRequest.title.in_(REPLY_SUGGESTION_TITLES),
        )
    )
    now = utcnow()
    count = 0
    for decision in result.scalars().all():
        count += 1
        decision.status = "deferred"
        decision.resolved_at = now
        decision.chosen_option_id = reason
        if link_signal_id and decision.message_id:
            card = await session.get(SignalMessage, decision.message_id)
            if card is not None:
                try:
                    meta = json.loads(card.metadata_json or "{}")
                except json.JSONDecodeError:
                    meta = {}
                if not isinstance(meta, dict):
                    meta = {}
                meta["superseded_by_signal_id"] = str(link_signal_id)
                card.metadata_json = json.dumps(meta)
                session.add(card)
        session.add(decision)
        if decision.notification_id:
            # Clear the paired bell item too: the card no longer needs anyone.
            notif = (
                await session.execute(
                    select(Notification).where(Notification.id == decision.notification_id)
                )
            ).scalar_one_or_none()
            if notif and notif.status == "unread":
                notif.status = "read"
                session.add(notif)
    return count
