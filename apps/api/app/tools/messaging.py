"""Conversation tools: reply, notes, handover, reactions, close."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.models.auth import Tenant
from app.services.addressee import parse_target
from app.tools._common import (
    TO_TARGET_SCHEMA,
    _resolve_messaging_signal,
    _target_signal_id,
)
from app.tools.registry import ToolContext, ToolSpec, register_tool


# ── messaging / decisions ────────────────────────────────────────


async def _send_reply(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Send a reply on an external signal thread (used by approved suggestion decisions).

    Email/Slack replies are delivered via the channel provider; widget/chat
    replies reach the visitor live via the gateway publish.
    """
    from datetime import datetime

    from app.channels.outbound import deliver_outbound
    from app.gateway.publish import publish_signal_message
    from app.models.signal import Signal, SignalEvent, SignalMessage

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    if not signal_id:
        return {"error": "signal_id required"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}
    if signal.channel in ("internal", "assistant"):
        return {"error": f"Channel {signal.channel} has no external party to reply to"}

    body_text = str(tool_input.get("body_text") or tool_input.get("body") or "").strip()
    if not body_text and isinstance(tool_input.get("messages"), list):
        body_text = "\n\n".join(
            m.strip() for m in tool_input["messages"] if isinstance(m, str) and m.strip()
        )
    body_html = tool_input.get("body_html")
    if isinstance(body_html, str) and not body_html.strip():
        body_html = None
    if not body_text and not body_html:
        return {"error": "body_text or body_html required"}
    if not body_text and body_html:
        body_text = body_html

    # Safety net: relative /docs links and markdown must not leave the mailbox.
    if signal.channel == "email":
        from app.services.suggestion_format import format_customer_email_body

        plain, html = format_customer_email_body(body_text)
        body_text = plain or body_text
        if not body_html:
            body_html = html

    subject = str(tool_input.get("subject") or "").strip()
    if not subject:
        subject = f"Re: {signal.subject}" if signal.subject else "Reply"

    to_override = str(tool_input.get("to") or "").strip()
    if to_override and not signal.contact_email:
        signal.contact_email = to_override

    # Sender identity: "user" (human approved — the default for approvals) or
    # "agent" (auto mode, or explicitly chosen). It drives the appended
    # signature, From display name, and timeline attribution; the From
    # address stays the mailbox (technical requirement of the connected account).
    send_as = str(tool_input.get("send_as") or "").strip().lower()
    if send_as not in ("user", "agent"):
        send_as = "agent" if ctx.agent else "user"
    identity_agent_id = ctx.agent.id if ctx.agent else signal.agent_id
    if send_as == "user" and not ctx.user_id:
        send_as = "agent"

    from app.services.signatures import resolve_from_display_name, resolve_signature_html

    signature_html = await resolve_signature_html(
        ctx.session,
        ctx.tenant_id,
        send_as=send_as,
        user_id=ctx.user_id,
        agent_id=identity_agent_id,
        channel_account_id=signal.channel_account_id,
    )
    from_display_name = await resolve_from_display_name(
        ctx.session,
        ctx.tenant_id,
        send_as=send_as,
        user_id=ctx.user_id,
        agent_id=identity_agent_id,
    )

    from app.services.agent.reply_mode import format_for_channel
    from app.services.chat_delivery import messages_from_payload, pause_before

    # Chat channels: an approved multi-bubble draft goes out as separate
    # messages, in order, with a short typing pause in between.
    if signal.channel == "email":
        bubbles = [body_text]
    else:
        bubbles = [
            format_for_channel(b, signal.channel) for b in messages_from_payload(tool_input)
        ] or [format_for_channel(body_text, signal.channel)]

    as_user = send_as == "user"
    sent: list[SignalMessage] = []
    delivery = "skipped"
    for index, text in enumerate(bubbles):
        if index:
            await pause_before(text)
        single_html = body_html if isinstance(body_html, str) and len(bubbles) == 1 else None
        delivery_result = await deliver_outbound(
            ctx.session,
            signal,
            body_text=text,
            subject=subject,
            body_html=single_html,
            signature_html=signature_html,
            from_display_name=from_display_name,
        )
        delivery = delivery_result.status
        if delivery == "skipped":
            # Channels without provider delivery (widget/chat): the visitor
            # receives the message live via the gateway publish below.
            delivery = "sent"
        if not delivery.startswith("sent"):
            if not sent:
                return {"error": f"Delivery failed: {delivery}", "delivery": delivery}
            break

        metadata: dict[str, Any] = {
            "source": "send_reply_tool",
            "delivery": delivery,
            "send_as": send_as,
        }
        if from_display_name:
            metadata["from_display_name"] = from_display_name
        if ctx.user_id:
            # Keep the approving human traceable even on agent-identity sends.
            metadata["approved_by_user_id"] = str(ctx.user_id)
        if len(bubbles) > 1:
            metadata["bubble_index"] = index
        now = datetime.utcnow()
        message = SignalMessage(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            kind="user_message" if as_user else "agent_message",
            direction="outbound",
            role="user" if as_user else "assistant",
            author_agent_id=None if as_user else identity_agent_id,
            author_user_id=ctx.user_id if as_user else None,
            from_address=delivery_result.from_address,
            to_addresses=delivery_result.to_address or signal.contact_email or "",
            external_id=delivery_result.provider_message_id,
            subject=subject,
            body_text=text,
            body_html=delivery_result.body_html or single_html or "",
            body_preview=text[:200],
            send_status=delivery,
            auto_sent=False,
            received_at=now,
            metadata_json=json.dumps(metadata),
        )
        ctx.session.add(message)
        signal.last_message_at = now
        signal.updated_at = now
        ctx.session.add(signal)
        await ctx.session.flush()
        await publish_signal_message(signal, message)
        sent.append(message)

    ctx.session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            event_type="replied",
            actor_type="user" if as_user else "agent",
            actor_id=str(ctx.user_id if as_user else identity_agent_id or ""),
            payload_json=json.dumps(
                {
                    "delivery": delivery,
                    "via": "send_reply",
                    "send_as": send_as,
                    "messages": len(sent),
                }
            ),
        )
    )
    from app.services.deliveries import TARGET_REPLY, record_delivery

    await record_delivery(
        ctx.session,
        ctx.tenant_id,
        signal.id,
        target_kind=TARGET_REPLY,
        ref=str(sent[-1].id),
        channel=signal.channel,
        agent_id=None if as_user else identity_agent_id,
        user_id=ctx.user_id if as_user else None,
    )
    await ctx.session.flush()
    out: dict[str, Any] = {
        "ok": True,
        "delivery": sent[-1].send_status,
        "message_id": str(sent[-1].id),
        "signal_id": str(signal.id),
    }
    if len(bubbles) > 1:
        out["message_ids"] = [str(m.id) for m in sent]
        if len(sent) < len(bubbles):
            out["partial"] = True
            out["last_delivery"] = delivery
    return out


async def _post_internal_note(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Leave a durable team-only note on a conversation (never a customer draft)."""
    from app.gateway.publish import publish_thread_update
    from app.services.agent.style import strip_emoji
    from app.services.chat_runtime import post_message

    if not ctx.agent:
        return {"error": "Only an agent can post an internal note"}
    signal, err = await _resolve_messaging_signal(ctx, tool_input)
    if signal is None:
        return {"error": err or "Signal not found"}
    body_text = strip_emoji(str(tool_input.get("body_text") or tool_input.get("body") or "")).strip()
    if not body_text:
        return {"error": "body_text required"}
    if len(body_text) > 4000:
        body_text = body_text[:4000].rstrip()

    note = await post_message(
        ctx.session,
        signal,
        content=body_text,
        role="assistant",
        trust="agent",
        author_agent_id=ctx.agent.id,
        kind="internal_note",
        metadata={
            "agent_name": ctx.agent.name,
            "agent_note": True,
            "run_id": str(ctx.run_id) if ctx.run_id else None,
        },
    )
    await ctx.session.commit()
    await ctx.session.refresh(note)
    await publish_thread_update(signal)
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "message_id": str(note.id),
        "kind": "internal_note",
        "note": (
            "Posted as a team-only internal note. The customer cannot see it. "
            "It is not a draft and needs no approval."
        ),
    }


async def _invite_to_thread(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Add a user, agent, or team as a participant on this conversation."""
    from uuid import UUID

    from app.services.participants import ensure_participant

    signal, err = await _resolve_messaging_signal(ctx, tool_input)
    if signal is None:
        return {"error": err or "Signal not found"}
    kind = str(tool_input.get("kind") or "").strip()
    if kind == "team":
        kind = "department"
    if kind not in ("user", "agent", "department"):
        return {"error": "kind must be user, agent, or team"}
    try:
        ref_id = UUID(str(tool_input.get("id") or ""))
    except ValueError:
        return {"error": "id must be a uuid"}
    role = str(tool_input.get("role") or "member")
    if role not in ("member", "watcher"):
        role = "member"
    await ensure_participant(
        ctx.session,
        signal,
        kind=kind,
        ref_id=ref_id,
        role=role,
        invited_by_kind="agent" if ctx.agent else "user",
        invited_by_id=(ctx.agent.id if ctx.agent else ctx.user_id),
        joined_via="invite",
    )
    name = ""
    if kind == "agent":
        from app.models.agent import Agent

        invited = await ctx.session.get(Agent, ref_id)
        name = (invited.name if invited else "") or ""
    elif kind == "department":
        from app.services.teams import get_team

        team = await get_team(ctx.session, ctx.tenant_id, ref_id)
        name = (team.name if team else "") or ""
    elif kind == "user":
        from app.models.auth import User

        user = await ctx.session.get(User, ref_id)
        name = ((user.display_name or user.email) if user else "") or ""
    await ctx.session.commit()
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "kind": kind,
        "ref_id": str(ref_id),
        "name": name,
        "role": role,
    }


async def _leave_thread(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID

    from app.services.participants import leave_participant

    signal, err = await _resolve_messaging_signal(ctx, tool_input)
    if signal is None:
        return {"error": err or "Signal not found"}
    kind = str(tool_input.get("kind") or ("agent" if ctx.agent else "user"))
    raw_id = tool_input.get("id")
    if raw_id:
        try:
            ref_id = UUID(str(raw_id))
        except ValueError:
            return {"error": "id must be a uuid"}
    elif ctx.agent and kind == "agent":
        ref_id = ctx.agent.id
    elif ctx.user_id and kind == "user":
        ref_id = ctx.user_id
    else:
        return {"error": "id required"}
    try:
        left = await leave_participant(ctx.session, signal, kind=kind, ref_id=ref_id)
    except ValueError as exc:
        return {"error": str(exc)}
    await ctx.session.commit()
    return {"ok": True, "left": left, "signal_id": str(signal.id)}


async def _post_thread_message(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Post a visible message on a thread where the agent is a participant.

    Never sends to an external customer — use send_reply / suggest_thread_reply
    for that. Works on internal, assistant, and host threads.
    """
    from app.services.chat_runtime import post_message
    from app.services.participants import is_participant

    if not ctx.agent:
        return {"error": "Only an agent can post_thread_message"}
    signal, err = await _resolve_messaging_signal(ctx, tool_input)
    if signal is None:
        return {"error": err or "Signal not found"}
    body = str(tool_input.get("body_text") or tool_input.get("body") or "").strip()
    if not body:
        return {"error": "body_text required"}
    # Allow if participant, owner agent, or Ask session tool host.
    allowed = await is_participant(
        ctx.session, ctx.tenant_id, signal.id, kind="agent", ref_id=ctx.agent.id
    )
    if not allowed and signal.agent_id != ctx.agent.id:
        return {"error": "You are not a participant on this conversation; invite_to_thread first"}
    note_kind = str(tool_input.get("visibility") or "chat")
    kind = "internal_note" if note_kind == "note" else None
    message = await post_message(
        ctx.session,
        signal,
        content=body[:4000],
        role="assistant",
        trust="agent",
        author_agent_id=ctx.agent.id,
        kind=kind,
        metadata={"agent_name": ctx.agent.name, "post_thread_message": True},
    )
    await ctx.session.commit()
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "message_id": str(message.id),
        "kind": message.kind,
    }


async def _peer_for_turn(ctx: ToolContext, tool_input: dict[str, Any]):
    """Signal and target agent for ask_agent / handoff_to, or an error dict."""
    from uuid import UUID

    from app.models.agent import Agent

    if not ctx.agent:
        return None, None, {"error": "Only an agent can pass the conversation to another agent"}
    signal, err = await _resolve_messaging_signal(ctx, tool_input)
    if signal is None:
        return None, None, {"error": err or "Signal not found"}
    try:
        peer_id = UUID(str(tool_input.get("agent_id") or ""))
    except ValueError:
        return None, None, {"error": "agent_id must be an agent uuid from the snapshot or a tool result"}
    peer = await ctx.session.get(Agent, peer_id)
    if peer is None or peer.tenant_id != ctx.tenant_id or not peer.is_active:
        return None, None, {"error": "Target agent not found"}
    if peer.id == ctx.agent.id:
        return None, None, {"error": "You cannot ask yourself"}
    return signal, peer, None


async def _ask_agent(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Ask another agent in this conversation; the answer comes back to you."""
    from app.services.agent_turns import create_ask

    signal, peer, error = await _peer_for_turn(ctx, tool_input)
    if error:
        return error
    question = str(tool_input.get("question") or "").strip()
    if not question:
        return {"error": "question required"}
    result = await create_ask(ctx.session, signal, from_agent=ctx.agent, peer=peer, question=question)
    await ctx.session.commit()
    if not result.get("ok"):
        return {
            "error": result.get("error") or "Could not ask",
            "note": "The conversation goes back to the human. Do not ask again; answer with what you have.",
        }
    if result.get("already_asked"):
        return {
            "ok": True,
            "ask_id": result["ask_id"],
            "agent_id": str(peer.id),
            "agent_name": peer.name,
            "already_asked": True,
            "note": f"{peer.name} already has your open question and answers after this turn. End your turn now.",
        }
    return {
        "ok": True,
        "ask_id": result["ask_id"],
        "agent_id": str(peer.id),
        "agent_name": peer.name,
        "said": f"@[{peer.name}](agent:{peer.id}) {question}",
        "note": (
            f"{peer.name} answers after this turn, and their answer comes back to you. "
            "The question is already in the chat. Do not repeat it; end your turn now."
        ),
    }


async def _handoff_to(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Hand the conversation to another agent; they take over."""
    from app.services.agent_turns import enqueue_turn

    signal, peer, error = await _peer_for_turn(ctx, tool_input)
    if error:
        return error
    brief = str(tool_input.get("brief") or "").strip()
    if not brief:
        return {"error": "brief required"}
    queued = await enqueue_turn(
        ctx.session,
        signal,
        agent_id=peer.id,
        cause_kind="handoff",
        requested_by_kind="agent",
        requested_by_id=ctx.agent.id,
        prompt=brief,
    )
    await ctx.session.commit()
    if not queued.get("ok"):
        return {
            "error": queued.get("error") or "Could not hand over",
            "note": "The conversation goes back to the human. Answer with what you have.",
        }
    return {
        "ok": True,
        "agent_id": str(peer.id),
        "agent_name": peer.name,
        "said": f"@[{peer.name}](agent:{peer.id}) {brief}",
        "note": f"{peer.name} takes over after this turn. The brief is in the chat; end your turn now.",
    }


async def _start_conversation(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Start a peer conversation with another agent."""
    from datetime import datetime
    from uuid import UUID

    from sqlalchemy import select

    from app.models.agent import Agent
    from app.models.signal import Signal
    from app.services.ownership import apply_owner
    from app.services.agent_turns import enqueue_turn
    from app.services.participants import ensure_participant

    try:
        peer_id = UUID(str(tool_input.get("agent_id") or ""))
    except ValueError:
        return {"error": "agent_id required"}
    peer = (
        await ctx.session.execute(
            select(Agent).where(
                Agent.id == peer_id,
                Agent.tenant_id == ctx.tenant_id,
                Agent.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if peer is None:
        return {"error": "Target agent not found"}
    if ctx.agent and peer.id == ctx.agent.id:
        return {"error": "Cannot start a peer chat with yourself"}

    title = str(tool_input.get("title") or f"{(ctx.agent.name if ctx.agent else 'Agent')} × {peer.name}")
    now = datetime.utcnow()
    signal = Signal(
        tenant_id=ctx.tenant_id,
        channel="internal",
        source="agent_peer",
        subject=title[:200],
        status="open",
        agent_id=peer.id,
        created_at=now,
        updated_at=now,
        last_message_at=now,
    )
    ctx.session.add(signal)
    await ctx.session.flush()
    if ctx.agent:
        await apply_owner(ctx.session, signal, "agent", ctx.agent.id, by_user_id=ctx.user_id)
    elif ctx.user_id:
        await apply_owner(ctx.session, signal, "user", ctx.user_id, by_user_id=ctx.user_id)
    await ensure_participant(
        ctx.session,
        signal,
        kind="agent",
        ref_id=peer.id,
        role="member",
        invited_by_kind="agent" if ctx.agent else "user",
        invited_by_id=(ctx.agent.id if ctx.agent else ctx.user_id),
        joined_via="a2a",
    )
    prompt = str(tool_input.get("message") or tool_input.get("instructions") or "").strip()
    turn = await enqueue_turn(
        ctx.session,
        signal,
        agent_id=peer.id,
        cause_kind="handoff",
        requested_by_kind="agent" if ctx.agent else "user",
        requested_by_id=(ctx.agent.id if ctx.agent else ctx.user_id),
        prompt=prompt or f"Join this conversation about: {title}",
    )
    await ctx.session.commit()
    return {
        "ok": True,
        "mode": "chat",
        "signal_id": str(signal.id),
        "path": f"/communication/inbox/all/t/{signal.id}",
        "peer_agent_id": str(peer.id),
        "peer_agent_name": peer.name,
        "turn": turn,
    }


async def _suggest_thread_reply(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Propose a customer-facing reply on a thread; the operator approves it.

    The proposal lands as the thread's reply-suggestion card, so a draft an
    agent offers while sparring with an operator goes through the same
    approve / edit / decline path as an inbound AI suggestion.
    """
    from app.services.inbound_agent import create_reply_suggestion

    if not ctx.agent:
        return {"error": "Only an agent can suggest a reply"}
    signal, err = await _resolve_messaging_signal(ctx, tool_input)
    if signal is None:
        return {"error": err or "Signal not found"}

    body_text = str(tool_input.get("body_text") or tool_input.get("body") or "").strip()
    if not body_text:
        return {"error": "body_text required"}

    if signal.channel in ("internal", "assistant"):
        return {
            "error": (
                f"Channel {signal.channel} has no external party to reply to. "
                "Use post_internal_note for a team note, or chat normally."
            )
        }

    outcome = await create_reply_suggestion(
        ctx.session,
        ctx.tenant_id,
        signal,
        ctx.agent,
        reply_text=body_text,
        run_id=ctx.run_id,
        announce=ctx.surface != "inbound",
        # Mid-turn the card stays hidden until the chat line is saved, then
        # lands under that line. Revealing it at tool time shoves the speech.
        reveal=not bool(ctx.turn_id),
    )
    if outcome.get("skipped"):
        reason = str(outcome.get("reason") or "skipped")
        if reason == "note_only" or outcome.get("internal_note"):
            # create_reply_suggestion already persisted the note; never open a draft.
            return {
                "ok": True,
                "awaiting_approval": False,
                "converted_to_note": True,
                "signal_id": str(signal.id),
                "message": (
                    "Saved as a team-only internal note — not a customer draft. "
                    "Next time call post_internal_note directly for team notes; "
                    "never use suggest_thread_reply for that."
                ),
                **{k: v for k, v in outcome.items() if k != "skipped"},
            }
        if reason == "meta_draft":
            return {
                "ok": False,
                "error": "meta_draft",
                "message": (
                    "That text talks about the platform, not the customer. "
                    "Write a real customer-facing reply, or use post_internal_note "
                    "for a team observation."
                ),
                **outcome,
            }
        return {
            "ok": False,
            "error": reason,
            "message": "No customer draft was created.",
            **outcome,
        }
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "awaiting_approval": True,
        "note": (
            "The draft is a suggested reply on the conversation, under your "
            "message. Say in one short line that it is ready. Do not repeat "
            "the draft. Nothing was sent."
        ),
        **outcome,
    }


async def _note_no_reply(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Record that an inbound message needs no customer reply.

    Assisted inbound uses this instead of a magic final line. The operator
    still gets the no-reply card on the thread.
    """
    from app.services.inbound_agent import create_action_suggestion

    if not ctx.agent:
        return {"error": "Only an agent can note that no reply is needed"}
    signal, err = await _resolve_messaging_signal(ctx, tool_input)
    if signal is None:
        return {"error": err or "Signal not found"}
    summary = str(tool_input.get("summary") or "").strip()
    if not summary:
        return {"error": "summary required"}

    outcome = await create_action_suggestion(
        ctx.session,
        ctx.tenant_id,
        signal,
        ctx.agent,
        summary=summary,
        reason="agent_judgement",
        run_id=ctx.run_id,
    )
    note = (
        "The card for this message was already on the thread; its summary is updated. "
        "This read has its outcome: finish now."
        if outcome.get("updated")
        else "The no-reply card is on the thread. This read has its outcome: finish now."
    )
    return {"ok": True, "awaiting_approval": True, "note": note, **outcome}


async def _latest_user_message(ctx: ToolContext, signal_id: UUID):
    """Newest teammate message on a conversation — the usual reaction target."""
    from app.models.signal import SignalMessage

    return (
        await ctx.session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == signal_id,
                SignalMessage.tenant_id == ctx.tenant_id,
                SignalMessage.kind == "user_message",
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _react_to_message(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Leave a stacked emoji reaction on a timeline message."""
    from app.models.signal import SignalMessage
    from app.services import message_reactions as reactions

    if not ctx.agent:
        return {"error": "Only an agent can call react_to_message"}
    kind = str(tool_input.get("kind") or "").strip().lower()
    raw_id = str(tool_input.get("message_id") or "").strip()
    message_id: UUID | None = None
    if raw_id:
        try:
            message_id = UUID(raw_id)
        except ValueError:
            # Models invent ids (thread slugs, "latest") when the transcript
            # has no UUIDs. Treat that as "the message they just wrote".
            message_id = None

    # Prefer the host conversation when the agent is in an inline session.
    signal, err = await _resolve_messaging_signal(ctx, tool_input)
    host_id = signal.id if signal is not None else ctx.signal_id

    message = None
    used_latest = message_id is None
    if message_id is not None:
        message = (
            await ctx.session.execute(
                select(SignalMessage).where(
                    SignalMessage.id == message_id,
                    SignalMessage.tenant_id == ctx.tenant_id,
                )
            )
        ).scalar_one_or_none()
        # A conversation id is not a message id.
        if message is None and message_id in {host_id, ctx.signal_id}:
            used_latest = True
            message = None
        elif message is None:
            used_latest = True

    if message is None:
        if host_id is None:
            return {"error": err or "message_id required"}
        message = await _latest_user_message(ctx, host_id)
        used_latest = True
        if message is None:
            return {"error": "No message on this conversation to react to"}

    if host_id and message.signal_id != host_id:
        # Allow reacting on the host when the tool is scoped to a session child.
        if signal is None or message.signal_id != getattr(signal, "id", None):
            # Still allow if message belongs to the session thread itself.
            if ctx.signal_id and message.signal_id != ctx.signal_id:
                return {"error": err or "Message is not on this conversation"}

    try:
        payload = await reactions.set_reaction(
            ctx.session,
            tenant_id=ctx.tenant_id,
            message_id=message.id,
            actor_type="agent",
            actor_id=ctx.agent.id,
            kind=kind,
            commit=True,
        )
    except Exception as exc:  # noqa: BLE001 — surface as tool error
        from fastapi import HTTPException

        if isinstance(exc, HTTPException):
            return {"error": str(exc.detail)}
        return {"error": str(exc)}

    result = {
        "ok": True,
        "message_id": str(message.id),
        "kind": payload.get("mine") or kind,
        "reactions": payload,
        "emoji": reactions.REACTION_EMOJI.get(kind, ""),
    }
    if used_latest:
        result["resolved"] = "latest_user_message"
        result["note"] = "Reacted to the teammate's latest message on this chat."
    return result


async def _propose_session_checkout(
    ctx: ToolContext, tool_input: dict[str, Any]
) -> dict[str, Any]:
    """Close the inline session you are working in.

    The collapsed summary stays on the host conversation. There is no wrap-up
    card and no teammate action.
    """
    from app.services.agent.style import strip_emoji
    from app.services.agent_sessions import propose_checkout, resolve_active_session

    signal_id = _target_signal_id(ctx, tool_input)
    if not signal_id:
        return {"error": "signal_id required"}

    conversation = await resolve_active_session(
        ctx.session,
        ctx.tenant_id,
        signal_id,
        agent_id=ctx.agent.id if ctx.agent else None,
    )
    if conversation is None:
        return {"error": "No active agent session on this conversation"}

    summary = strip_emoji(str(tool_input.get("summary") or "")).strip()
    if not summary:
        return {"error": "summary required"}

    return await propose_checkout(
        ctx.session,
        ctx.tenant_id,
        conversation,
        summary=summary,
        options=tool_input.get("options"),
        user_id=ctx.user_id,
    )


async def _take_over_conversation(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Continue the customer conversation yourself: become its handling agent.

    The mirror image of ``handoff_to_human``: AI replies resume on the thread
    and this agent is pinned as the one that answers the next inbound
    message, so an operator can hand a conversation back mid-sparring.
    """
    from datetime import datetime

    from app.gateway.publish import publish_thread_update
    from app.models.signal import Signal, SignalEvent

    signal_id = _target_signal_id(ctx, tool_input)
    if not signal_id:
        return {"error": "signal_id required"}
    if not ctx.agent:
        return {"error": "Only an agent can take over a conversation"}
    if getattr(ctx.agent, "kind", "company") != "company":
        return {
            "error": "Only a company agent can handle a customer conversation",
        }

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}
    if signal.channel in ("internal", "assistant"):
        return {"error": f"Channel {signal.channel} has no external party to converse with"}

    from app.services.ai_handling import (
        REASON_ESCALATED,
        REASON_HANDOFF,
        conversation_mode,
        release_conversation,
    )

    # Customer/visitor handoff holds the thread until a human acts. Agents must
    # not silently resume AI after "talk to a human".
    if conversation_mode(signal) == "manual" and (signal.ai_handling_reason or "") in (
        REASON_HANDOFF,
        REASON_ESCALATED,
    ):
        return {
            "error": (
                "Autonomy is manual because the customer asked for a human. "
                "A team member must reply or hand the thread back to AI."
            ),
            "ai_handling": "manual",
            "signal_id": str(signal.id),
        }

    from app.services.handover import hand_to_agent

    # Pin this agent on the thread; it becomes the owner only when it may
    # send on its own (autonomous, channel can send). Otherwise the current
    # owner keeps the conversation and this agent drafts for them.
    signal.agent_id = ctx.agent.id
    signal.updated_at = datetime.utcnow()
    if conversation_mode(signal) == "manual":
        release_conversation(
            ctx.session,
            signal,
            reason=str(tool_input.get("reason") or "").strip(),
            actor_type="agent",
            actor_id=str(ctx.agent.id),
            via="take_over_conversation",
        )
    became_owner = await hand_to_agent(
        ctx.session,
        None,
        signal,
        actor_type="agent",
        actor_id=str(ctx.agent.id),
        via="take_over_conversation",
        agent=ctx.agent,
    )
    ctx.session.add(signal)
    ctx.session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            event_type="agent_assigned",
            actor_type="agent",
            actor_id=str(ctx.agent.id),
            payload_json=json.dumps(
                {
                    "via": "take_over_conversation",
                    "agent_id": str(ctx.agent.id),
                    "agent_name": ctx.agent.name,
                    "reason": str(tool_input.get("reason") or "").strip(),
                }
            ),
        )
    )
    await ctx.session.flush()
    await publish_thread_update(signal)
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "ai_handling": None,
        "handling_agent": ctx.agent.name,
        "owner": "agent" if became_owner else (signal.assignee_kind or "department"),
        "note": (
            "You now own this conversation and send the next reply yourself."
            if became_owner
            else (
                "You handle the next inbound message, but Autonomy here is not "
                "autonomous: the current owner keeps the conversation and you draft "
                "replies for their approval."
            )
        ),
    }


async def _close_thread(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Close a signal thread without replying (mark it resolved).

    Used by approved action-suggestion decisions on automated/no-reply mail,
    and available to agents as a governed mutation.
    """
    from datetime import datetime

    from app.gateway.publish import publish_thread_update
    from app.models.signal import Signal, SignalEvent

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    if not signal_id:
        return {"error": "signal_id required"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    # SQLite demo rows can store UUID PKs in a form that fails GUID bind compares.
    if signal is None and signal_id is not None:
        from sqlalchemy import String, cast

        result = await ctx.session.execute(
            select(Signal).where(
                cast(Signal.id, String) == str(signal_id),
                Signal.tenant_id == ctx.tenant_id,
            )
        )
        signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}
    if signal.status == "closed":
        return {"ok": True, "signal_id": str(signal.id), "status": "closed", "already_closed": True}

    from app.services.ai_handling import on_status_change

    signal.status = "closed"
    signal.has_unread = False
    on_status_change(
        ctx.session, signal, actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or "")
    )
    from app.services.tickets import settle_ticket_on_close

    await settle_ticket_on_close(
        ctx.session,
        signal,
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
    )
    signal.updated_at = datetime.utcnow()
    ctx.session.add(signal)
    ctx.session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            event_type="thread_updated",
            actor_type="agent" if ctx.agent else "user",
            actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
            payload_json=json.dumps(
                {"status": "closed", "via": "close_thread", "note": tool_input.get("note") or ""}
            ),
        )
    )
    await ctx.session.flush()
    await publish_thread_update(signal)
    from app.services.webhooks import emit_webhook_event, signal_event_data

    await emit_webhook_event(ctx.session, ctx.tenant_id, "signal.closed", signal_event_data(signal))
    return {"ok": True, "signal_id": str(signal.id), "status": "closed"}


async def _record_thread_read(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Persist the agent's inbound read: summary, priority, certainty, tags, ticket."""
    from app.services.interpretation import apply_thread_read
    from app.services.signals import get_triage_context, message_plain_text
    from app.models.signal import SignalMessage

    # Same rule as other messaging tools: remap Ask-session ids to the host,
    # and fall back when the model passes a stale or non-UUID signal_id.
    signal, err = await _resolve_messaging_signal(ctx, tool_input)
    if signal is None:
        return {"error": err or "signal_id required"}
    signal_id = signal.id

    summary = str(tool_input.get("summary") or "").strip()
    if not summary:
        return {"error": "summary is required (one sentence)"}

    body_quote = ""
    try:
        ctx_row = await get_triage_context(ctx.session, ctx.tenant_id, signal_id)
        body_quote = str(ctx_row.get("body") or "")[:200]
    except Exception:  # noqa: BLE001
        msg = (
            await ctx.session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == signal_id,
                    SignalMessage.direction == "inbound",
                )
                .order_by(SignalMessage.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if msg is not None:
            body_quote = message_plain_text(msg)[:200]

    unknown = tool_input.get("unknown_signal")
    tags = tool_input.get("tags")
    if not isinstance(tags, list):
        tags = None

    try:
        result = await apply_thread_read(
            ctx.session,
            ctx.tenant_id,
            signal_id,
            summary=summary,
            certainty=int(tool_input.get("certainty") or 50),
            urgency=int(tool_input.get("urgency") or 50),
            impact=int(tool_input.get("impact") or 40),
            priority=str(tool_input.get("priority") or "normal"),
            sentiment=str(tool_input.get("sentiment") or "") or None,
            ticket_category=str(tool_input.get("ticket_category") or ""),
            tags=tags,
            unknown_signal=unknown if isinstance(unknown, dict) else None,
            agent_id=ctx.agent.id if ctx.agent else None,
            agent_name=str(getattr(ctx.agent, "name", "") or "") if ctx.agent else None,
            body_quote=body_quote,
            run_id=ctx.run_id,
        )
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
    verdict_out = None
    verdict = str(tool_input.get("verdict") or "").strip()
    if verdict:
        from app.models.signal import Signal
        from app.services.client_approval import apply_verdict

        fresh = await ctx.session.get(Signal, signal_id)
        if fresh is not None:
            verdict_out = await apply_verdict(
                ctx.session,
                fresh,
                verdict,
                feedback=str(tool_input.get("feedback") or ""),
                actor_type="agent" if ctx.agent else "user",
                actor_id=str(ctx.agent.id) if ctx.agent else str(ctx.user_id or ""),
            )
            await ctx.session.commit()
    return {
        "ok": True,
        "signal_id": str(signal_id),
        "summary": result.get("summary"),
        "priority": result.get("priority"),
        "certainty": result.get("certainty"),
        "ticket_tag_id": result.get("ticket_tag_id"),
        **({"verdict": verdict_out} if verdict_out is not None else {}),
    }


async def _handoff_to_human(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Escalate a conversation to the team: set Autonomy to manual, alert operators.

    The visitor keeps chatting in the same thread; a team member takes over
    from the inbox (the manual conversation override silences the agent until
    someone hands it back).
    """
    from app.models.signal import Signal
    from app.services.handoff import request_human_handoff

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    if not signal_id:
        return {"error": "signal_id required"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}

    reason = str(tool_input.get("reason") or "").strip()
    await request_human_handoff(
        ctx.session,
        ctx.tenant_id,
        signal,
        reason=reason,
        via="handoff_to_human",
        to=await parse_target(ctx.session, ctx.tenant_id, tool_input.get("to")),
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
    )
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "ai_handling": "manual",
        "note": (
            "The team has been notified and AI replies are paused on this thread. "
            "Tell the visitor a team member will take over in this same conversation."
        ),
    }


async def _continue_on_whatsapp(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Give the visitor a WhatsApp link that carries this chat over."""
    from app.models.signal import Signal
    from app.services.whatsapp_handover import create_handover

    if not ctx.signal_id:
        return {"error": "continue_on_whatsapp only works inside a website chat"}
    signal = await ctx.session.get(Signal, ctx.signal_id)
    tenant = await ctx.session.get(Tenant, ctx.tenant_id)
    if signal is None or tenant is None or signal.tenant_id != ctx.tenant_id:
        return {"error": "Conversation not found"}
    result = await create_handover(ctx.session, tenant, signal, language=str(tool_input.get("language") or ""))
    if result.get("error"):
        return result
    await ctx.session.commit()
    return {
        **result,
        "instruction": (
            "Give the visitor this link as a markdown link, for example [Continue on WhatsApp](link). "
            "Tell them the message is filled in already; they only press send."
        ),
    }


async def _request_callback(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Ask the team to get back later without pausing the chat."""
    from app.models.signal import Signal
    from app.services.handoff import request_callback

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    if not signal_id:
        return {"error": "signal_id required"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}

    reason = str(tool_input.get("reason") or "").strip()
    await request_callback(
        ctx.session,
        ctx.tenant_id,
        signal,
        reason=reason,
        via="request_callback",
        to=await parse_target(ctx.session, ctx.tenant_id, tool_input.get("to")),
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
    )
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "note": (
            "The team has been notified to get back later. Chat stays open. "
            "Tell the visitor the team is away and will follow up in this conversation."
        ),
    }


async def _request_customer_verify(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.customer_verify import request_customer_verify

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    email = str(tool_input.get("email") or "").strip()
    return await request_customer_verify(
        ctx.session, ctx.tenant_id, signal_id=signal_id, email=email
    )


async def _assign_conversation(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Hand the current conversation to another agent or a team, with an optional message."""
    import json as _json
    from datetime import datetime

    from app.gateway.publish import publish_signal_message, publish_thread_update
    from app.models.signal import Signal, SignalEvent, SignalMessage
    from app.services.ai_handling import on_assignment_change
    from app.services.ownership import owner_payload, resolve_assignee, set_owner
    from app.services.thread_dispatch import dispatch_to

    if not ctx.signal_id:
        return {"error": "assign_conversation only works inside a conversation"}
    raw_kind = str(tool_input.get("kind") or "")
    # ``team`` remains accepted for older prompts; stored kind is department.
    if raw_kind not in ("agent", "team", "department"):
        return {"error": "kind must be agent or department"}
    kind = "department" if raw_kind in ("team", "department") else "agent"
    signal = await ctx.session.get(Signal, ctx.signal_id)
    if signal is None or signal.tenant_id != ctx.tenant_id:
        return {"error": "Conversation not found"}
    try:
        owner_id = await resolve_assignee(ctx.session, ctx.tenant_id, signal, kind, tool_input.get("id"))
    except ValueError as exc:
        return {"error": str(exc)}
    if ctx.agent is not None and kind == "agent" and owner_id == ctx.agent.id:
        return {"error": "This conversation is already yours"}
    before = owner_payload(signal)
    before_assignee = signal.assigned_user_id
    set_owner(signal, kind, owner_id, by_user_id=ctx.user_id)
    on_assignment_change(
        ctx.session,
        signal,
        before_assignee=before_assignee,
        before_kind=before["kind"],
        actor_id=str(ctx.agent.id) if ctx.agent is not None else "",
    )
    ctx.session.add(signal)
    ctx.session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            event_type="assigned",
            actor_type="agent" if ctx.agent is not None else "user",
            actor_id=str(ctx.agent.id) if ctx.agent is not None else str(ctx.user_id or ""),
            payload_json=_json.dumps({"before": before, "after": owner_payload(signal)}),
        )
    )
    message_text = str(tool_input.get("message") or "").strip()
    note: SignalMessage | None = None
    if message_text and ctx.agent is not None:
        note = SignalMessage(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            kind="internal_note",
            direction="internal",
            role="assistant",
            author_agent_id=ctx.agent.id,
            from_address="",
            to_addresses="",
            subject=signal.subject,
            body_text=message_text,
            body_preview=message_text[:200],
            body_html=f"<p>{message_text}</p>",
            metadata_json=_json.dumps({"agent_name": ctx.agent.name, "handover": True}),
            received_at=datetime.utcnow(),
        )
        ctx.session.add(note)
    await ctx.session.commit()
    await publish_thread_update(signal)
    if note is not None:
        await ctx.session.refresh(note)
        await publish_signal_message(signal, note)
    result = {"assigned_to": {"kind": kind, "id": str(owner_id)}}
    if message_text and ctx.user_id:
        result["dispatch"] = await dispatch_to(
            ctx.session,
            ctx.tenant_id,
            signal,
            kind=kind,
            target_id=owner_id,
            author_user_id=ctx.user_id,
            author_name=ctx.agent.name if ctx.agent is not None else "",
            text=message_text,
            user_role=ctx.user_role or "member",
        )
    return result


register_tool(
    ToolSpec(
        name="send_reply",
        description="Send a reply to the external party on a signal thread (typically after human approval).",
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "body_text": {"type": "string"},
                "body_html": {"type": "string"},
                "body": {"type": "string"},
                "messages": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Chat channels: several short messages, sent in order.",
                },
                "subject": {"type": "string"},
                "to": {"type": "string"},
                "send_as": {
                    "type": "string",
                    "enum": ["user", "agent"],
                    "description": "Sender identity for attribution + signature (default: approving user).",
                },
            },
            "required": [],
        },
        handler=_send_reply,
        audience="both",
        consequential=True,
        gated=True,
    )
)

register_tool(
    ToolSpec(
        name="post_internal_note",
        description=(
            "Post a durable team-only note on the host conversation (same place "
            "as a person's Note). The customer never sees it; no approval. Use "
            "this for observations, context for colleagues, or why you are not "
            "drafting a reply — never use suggest_thread_reply for team notes. "
            "Omit signal_id in an Ask session — the host thread is used "
            "automatically; never pass a session id. For back-and-forth with "
            "the operator, write chat. For a customer reply that needs "
            "approval, use suggest_thread_reply. For 'no customer reply "
            "needed', use note_no_reply. If a tool errors, retry correctly in "
            "the same turn — do not narrate the failure to the operator."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {
                    "type": "string",
                    "description": "Host conversation id. Omit in Ask sessions.",
                },
                "body_text": {
                    "type": "string",
                    "description": "The team-facing note body. Plain language, no customer letter.",
                },
            },
            "required": ["body_text"],
        },
        handler=_post_internal_note,
        gated=False,
        audience="both",
        display_name="Post internal note",
    )
)

register_tool(
    ToolSpec(
        name="invite_to_thread",
        description=(
            "Add a teammate, agent, or team as a participant on this conversation. "
            "This does not give anyone a turn: use ask_agent or handoff_to for that "
            "(they add the agent themselves)."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "kind": {
                    "type": "string",
                    "enum": ["user", "agent", "team"],
                    "description": "Who to invite",
                },
                "id": {"type": "string", "description": "UUID of the user, agent, or team"},
                "role": {
                    "type": "string",
                    "enum": ["member", "watcher"],
                    "description": "member (default) or watcher",
                },
            },
            "required": ["kind", "id"],
        },
        handler=_invite_to_thread,
        gated=False,
        audience="both",
        display_name="Invite to conversation",
    )
)

register_tool(
    ToolSpec(
        name="leave_thread",
        description=(
            "Leave a conversation as a participant (not the owner). "
            "Agents use this after their specialist turn is done."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "kind": {"type": "string", "enum": ["user", "agent", "team"]},
                "id": {"type": "string", "description": "Defaults to the calling agent"},
            },
        },
        handler=_leave_thread,
        gated=False,
        audience="both",
        display_name="Leave conversation",
    )
)

register_tool(
    ToolSpec(
        name="post_thread_message",
        description=(
            "Post a visible message on a conversation where you are a participant. "
            "Never reaches the external customer — use suggest_thread_reply or "
            "send_reply for that. It does not ask other agents; use ask_agent for that."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "body_text": {"type": "string"},
                "visibility": {
                    "type": "string",
                    "enum": ["chat", "note"],
                    "description": "chat (default) or note (team-only internal note)",
                },
            },
            "required": ["body_text"],
        },
        handler=_post_thread_message,
        gated=False,
        audience="both",
        display_name="Posted a chat reply",
    )
)

register_tool(
    ToolSpec(
        name="ask_agent",
        description=(
            "Ask another agent something in this conversation. Your question is "
            "posted for you with their name; they answer after your turn, and "
            "their answer (text and images) comes back to you as a new turn. "
            "Do not repeat the question in your reply; end your turn. This is the "
            "only way to ask: an @mention in your reply wakes nobody."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "agent_id": {"type": "string", "description": "Agent uuid from the snapshot"},
                "question": {"type": "string", "description": "What you need from them"},
            },
            "required": ["agent_id", "question"],
        },
        handler=_ask_agent,
        gated=False,
        audience="both",
        display_name="Asked an agent",
    )
)

register_tool(
    ToolSpec(
        name="handoff_to",
        description=(
            "Hand this conversation to another agent who is better placed. Your "
            "brief is posted for you with their name; they take over after your "
            "turn and nothing comes back to you. End your turn."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "agent_id": {"type": "string", "description": "Agent uuid from the snapshot"},
                "brief": {"type": "string", "description": "What they should pick up"},
            },
            "required": ["agent_id", "brief"],
        },
        handler=_handoff_to,
        gated=False,
        audience="both",
        display_name="Handed over",
    )
)

register_tool(
    ToolSpec(
        name="start_conversation",
        description=(
            "Start a separate peer conversation with another agent: an internal "
            "thread with both as participants, and the peer gets the floor. "
            "Do not use this to ask an agent something in the current conversation: "
            "use ask_agent so their answer stays inline here. For background work "
            "that reports back to you, use spawn_subagent."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "title": {"type": "string"},
                "message": {"type": "string"},
            },
            "required": ["agent_id"],
        },
        handler=_start_conversation,
        gated=False,
        audience="both",
        display_name="Start conversation",
    )
)


async def _post_trend(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID

    from app.services.trends import post_trend

    try:
        folder_id = UUID(str(tool_input.get("folder_id") or ""))
    except ValueError:
        return {"error": "folder_id required"}
    sources = tool_input.get("sources") or []
    if isinstance(sources, str):
        sources = [sources]
    return await post_trend(
        ctx.session,
        ctx.tenant_id,
        folder_id=folder_id,
        title=str(tool_input.get("title") or ""),
        for_whom=str(tool_input.get("for_whom") or ""),
        why=str(tool_input.get("why") or ""),
        how=str(tool_input.get("how") or ""),
        sources=[str(s) for s in sources],
        agent_id=ctx.agent.id if ctx.agent else None,
    )


register_tool(
    ToolSpec(
        name="post_trend",
        description=(
            "File a trend for one client: an internal conversation labelled #trend in that "
            "client's folder, with for whom, why, how to use it, and the source links. One "
            "call per client the trend fits. A second call with the same title this week "
            "returns the one that exists."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "folder_id": {"type": "string", "description": "The client folder id."},
                "title": {"type": "string", "description": "Short name of the trend."},
                "for_whom": {"type": "string"},
                "why": {"type": "string"},
                "how": {"type": "string"},
                "sources": {"type": "array", "items": {"type": "string"}, "description": "Source links."},
            },
            "required": ["folder_id", "title", "sources"],
        },
        handler=_post_trend,
        gated=False,
        audience="both",
        display_name="Trend filed",
    )
)

register_tool(
    ToolSpec(
        name="suggest_thread_reply",
        description=(
            "Propose a reply to the external customer only — never for team "
            "notes or operator chat. The draft appears as a suggested reply the "
            "teammate can approve, edit or decline. body_text must be only the "
            "customer-facing text: for email, a proper letter (greeting, short "
            "paragraphs); for WhatsApp/widget/chat channels, a short chat "
            "reply. Your own operator chat stays separate and brief. For a "
            "team-only observation use post_internal_note. For 'no reply "
            "needed' use note_no_reply."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "body_text": {
                    "type": "string",
                    "description": (
                        "Customer-facing body only. Email = structured letter; "
                        "chat channels = short WhatsApp-style reply."
                    ),
                },
            },
            "required": ["body_text"],
        },
        handler=_suggest_thread_reply,
        # Proposing to a human is the safe path; it never waits on approval.
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="react_to_message",
        description=(
            "React to a timeline message with a small emoji stack, including "
            "this assistant chat. Kinds: up (good), down (not good), hundred "
            "(very good), clap (applause), facepalm (awkward / oh no), thinking "
            "(unclear), investigating (you will look into it — agent-only). "
            "One reaction per actor; calling the same kind again clears it. "
            "Omit message_id to react to the teammate's latest message on this "
            "chat — do that when they ask for a thumbs up and you do not have "
            "a real message UUID. Never invent an id, and never pass the "
            "conversation id as message_id. Use investigating when you start "
            "research instead of a long status note."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": (
                        "Signal message UUID. Omit to react to the teammate's "
                        "latest message on this chat."
                    ),
                },
                "kind": {
                    "type": "string",
                    "enum": [
                        "up",
                        "down",
                        "hundred",
                        "clap",
                        "facepalm",
                        "thinking",
                        "investigating",
                    ],
                },
                "signal_id": {"type": "string"},
            },
            "required": ["kind"],
        },
        handler=_react_to_message,
        gated=False,
        audience="operator",
        display_name="React to message",
    )
)

register_tool(
    ToolSpec(
        name="note_no_reply",
        description=(
            "The inbound message needs no customer reply (newsletter, receipt, "
            "no-reply sender, system alert). Records that judgement on the "
            "conversation for a teammate to confirm — this is not a free-form "
            "team note (use post_internal_note for that). Only call this when "
            "the teammate asked you to handle the inbound or mark no reply, "
            "or when that is the clear next step for their ask — not after a "
            "plain lookup question. Do not also draft a reply. It is the "
            "outcome of the read: call it once, after any labels."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "summary": {
                    "type": "string",
                    "description": "One line: what the automated message says.",
                },
            },
            "required": ["summary"],
        },
        handler=_note_no_reply,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="propose_session_checkout",
        description=(
            "Close the inline session you were brought into, with a short "
            "summary of what you found, did, or recommend. Call this after "
            "you have answered the teammate (or finished the work they "
            "asked). The session closes immediately; do not ask the teammate "
            "to end it."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "summary": {
                    "type": "string",
                    "description": (
                        "One short paragraph: what you did and what is left. "
                        "It becomes the session outcome on the thread."
                    ),
                },
            },
            "required": ["summary"],
        },
        handler=_propose_session_checkout,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="take_over_conversation",
        description=(
            "Take the customer conversation over yourself: AI replies resume and "
            "you become the agent that answers the next inbound message. Use when "
            "a teammate asks you to continue with the contact."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "reason": {"type": "string", "description": "Why you are taking over."},
            },
            "required": [],
        },
        handler=_take_over_conversation,
    )
)

register_tool(
    ToolSpec(
        name="close_thread",
        description="Close a signal thread without replying (mark it resolved, e.g. automated notifications).",
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "note": {"type": "string"},
            },
            "required": [],
        },
        handler=_close_thread,
    )
)

register_tool(
    ToolSpec(
        name="record_thread_read",
        description=(
            "Record your read of the newest inbound message: one-sentence summary, "
            "priority (normal|high|urgent), certainty 0-100, urgency/impact 0-100, optional sentiment, "
            "optional ticket_category (one flow label from list_categories whose description fits; "
            "the flow label is the kind of work and picks the approach; leave it empty when no "
            "flow fits), optional free tags from the catalog, and optional unknown_signal when no "
            "hashtag fits. Call this once early on every inbound turn before drafting. "
            "Low certainty keeps priority at normal and only proposes tickets. When the ticket "
            "waits on the customer's approval and this message answers it, pass verdict "
            "(approved moves to the next stage; changes_requested moves back and adds feedback "
            "to the folder doc Afspraken)."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {
                    "type": "string",
                    "description": "Thread id. Omit to use the conversation you are on.",
                },
                "summary": {"type": "string"},
                "certainty": {"type": "integer"},
                "priority": {"type": "string", "enum": ["normal", "high", "urgent"]},
                "urgency": {"type": "integer"},
                "impact": {"type": "integer"},
                "sentiment": {"type": "string"},
                "ticket_category": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "unknown_signal": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "sentence": {"type": "string"},
                        "quote": {"type": "string"},
                    },
                },
                "verdict": {"type": "string", "enum": ["approved", "changes_requested"]},
                "feedback": {
                    "type": "string",
                    "description": "With changes_requested: the customer's feedback as a lasting agreement.",
                },
            },
            "required": ["summary", "certainty"],
        },
        handler=_record_thread_read,
        mutating=True,
        gated=False,
        # Inbound runs are trust=external. This is how that turn files its read.
        audience="both",
        display_name="Read conversation",
    )
)

async def _split_conversation(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from fastapi import HTTPException

    from app.models.signal import Signal
    from app.services.conversation_split import (
        resolve_category,
        split_conversation,
        split_or_propose,
    )

    try:
        signal_id = UUID(str(tool_input.get("signal_id") or ctx.signal_id or ""))
        raw_message = str(tool_input.get("from_message_id") or "").strip()
        from_message_id = UUID(raw_message) if raw_message else None
    except ValueError:
        return {"error": "signal_id and from_message_id must be ids"}
    signal = await ctx.session.get(Signal, signal_id)
    if signal is None or signal.tenant_id != ctx.tenant_id:
        return {"error": "Conversation not found"}
    try:
        category = await resolve_category(ctx.session, ctx.tenant_id, tool_input.get("category"))
        if ctx.agent is None:
            # A person ran this (or approved the split card): no AI handling gate.
            child = await split_conversation(
                ctx.session,
                ctx.tenant_id,
                signal_id,
                from_message_id=from_message_id,
                category=category,
                actor_type="user" if ctx.user_id else "system",
                actor_id=str(ctx.user_id or ""),
            )
            return {"status": "split", "signal_id": str(child.id)}
        if category is None:
            return {"error": "category is required: name the new request's category"}
        return await split_or_propose(
            ctx.session,
            ctx.tenant_id,
            signal,
            category=category,
            from_message_id=from_message_id,
            agent_id=ctx.agent.id,
            reason=str(tool_input.get("reason") or ""),
        )
    except HTTPException as exc:
        return {"error": str(exc.detail)}


register_tool(
    ToolSpec(
        name="split_conversation",
        description=(
            "Move a new request into its own conversation. A conversation has one "
            "label; when the customer raises something with a different label, "
            "split from the message where it starts. The conversation's Autonomy "
            "decides the outcome: autonomous splits, assisted asks the team, manual "
            "leaves it to a person."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "from_message_id": {
                    "type": "string",
                    "description": "First message of the new request; defaults to the newest customer message",
                },
                "category": {
                    "type": "string",
                    "description": "Label hashtag (name without #) or id for the new conversation",
                },
                "reason": {"type": "string", "description": "One sentence for the team"},
            },
            "required": ["category"],
        },
        handler=_split_conversation,
        gated=False,
        display_name="Split conversation",
    )
)

register_tool(
    ToolSpec(
        name="handoff_to_human",
        description=(
            "Hand this conversation over to a human team member. Pauses AI replies "
            "on the thread and notifies the team so someone can take over in the "
            "same conversation. Use when the visitor asks for a human/employee, is "
            "frustrated, or when you cannot help."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "reason": {
                    "type": "string",
                    "description": "Short summary of why the visitor needs a human.",
                },
                "to": TO_TARGET_SCHEMA,
            },
            "required": [],
        },
        handler=_handoff_to_human,
        # Escalating TO a human must never itself wait on human approval.
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="request_callback",
        description=(
            "Ask the team to get back to this visitor later. Use when nobody is "
            "available for a live handoff. Chat stays open; do not say "
            "the chat is closed or offline."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "reason": {
                    "type": "string",
                    "description": "Short summary of what the visitor needs a callback for.",
                },
                "to": TO_TARGET_SCHEMA,
            },
            "required": [],
        },
        handler=_request_callback,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="continue_on_whatsapp",
        description=(
            "Offer the website visitor to continue this chat on WhatsApp. Returns a link "
            "with a prefilled message; when they send it, the conversation continues there "
            "with a colleague. Use when nobody is available live and the visitor prefers WhatsApp."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "language": {
                    "type": "string",
                    "description": "The visitor's language code (nl, en) for the prefilled message",
                },
            },
            "required": [],
        },
        handler=_continue_on_whatsapp,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="request_customer_verify",
        description=(
            "Start a short confirmation for this visitor's email so they can see "
            "their own invoices or documents. Ask for the email they use with this "
            "company first. Always tell them to check their inbox. Never say "
            "whether an account exists."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "email": {
                    "type": "string",
                    "description": "The email address the visitor says they use with this company.",
                },
            },
            "required": ["email"],
        },
        handler=_request_customer_verify,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="assign_conversation",
        description=(
            "Hand this conversation to another agent or a team that fits it better. "
            "The new owner takes over; add a short message saying what they should do. "
            "Only agents and teams with access to this channel can take it."
        ),
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["agent", "department", "team"],
                    "description": "agent or department (team is accepted as an alias)",
                },
                "id": {"type": "string", "description": "Agent or department id"},
                "message": {"type": "string", "description": "Handover note for the new owner"},
            },
            "required": ["kind", "id"],
        },
        handler=_assign_conversation,
    )
)

async def _close_threads(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Close many open/pending threads by id list or by inactivity age."""
    from app.services.tenant_introspection import list_threads_summary

    note = str(tool_input.get("note") or "").strip()
    # ``preview`` is the operator-facing name; ``dry_run`` stays accepted for
    # older MCP clients. Never echo either name in chat — ask in plain words.
    preview = bool(tool_input.get("preview") or tool_input.get("dry_run"))
    limit = max(1, min(int(tool_input.get("limit") or 100), 200))
    raw_ids = tool_input.get("signal_ids") or []
    if isinstance(raw_ids, str):
        raw_ids = [raw_ids]
    if not isinstance(raw_ids, list):
        return {"error": "signal_ids must be a list of ids"}

    older_raw = tool_input.get("older_than_days")
    signal_ids: list[str] = []
    matched = 0
    if raw_ids:
        signal_ids = [str(x).strip() for x in raw_ids if str(x).strip()]
        matched = len(signal_ids)
        signal_ids = signal_ids[:limit]
    elif older_raw is not None:
        summary = await list_threads_summary(
            ctx.session,
            ctx.tenant_id,
            status=tool_input.get("status", "open"),
            channel=tool_input.get("channel"),
            older_than_days=int(older_raw),
            limit=limit,
        )
        signal_ids = [row["id"] for row in summary.get("threads") or []]
        matched = int(summary.get("matched") or len(signal_ids))
    else:
        return {"error": "Provide older_than_days or signal_ids"}

    if preview:
        return {
            "ok": True,
            "preview": True,
            "matched": matched,
            "would_close": len(signal_ids),
            "signal_ids": signal_ids,
            "truncated": matched > len(signal_ids),
        }

    closed: list[str] = []
    errors: list[dict[str, str]] = []
    for sid in signal_ids:
        result = await _close_thread(ctx, {"signal_id": sid, "note": note})
        if result.get("ok"):
            closed.append(sid)
        else:
            errors.append({"signal_id": sid, "error": str(result.get("error") or "failed")})

    return {
        "ok": True,
        "closed": len(closed),
        "matched": matched,
        "signal_ids": closed,
        "errors": errors,
        "truncated": matched > len(signal_ids),
        "note": (
            "Call again with the same filters if truncated is true — "
            "only one page is closed per call."
        ),
    }


register_tool(
    ToolSpec(
        name="close_threads",
        description=(
            "Close many open/pending threads at once for cleanup or support. "
            "Pass older_than_days (inactive longer than N days) and/or signal_ids. "
            "Set preview=true to list matching ids without closing — then ask the "
            "person in plain language whether to close them (e.g. 'Zal ik ze "
            "eerst tonen?' / 'Want a list first?'), never say preview, dry_run, "
            "or other tool parameter names out loud. One page per call "
            "(limit max 200); if truncated is true, call again with the same filters."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "older_than_days": {"type": "integer"},
                "signal_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "status": {"type": "string"},
                "channel": {"type": "string"},
                "limit": {"type": "integer"},
                "note": {"type": "string"},
                "preview": {
                    "type": "boolean",
                    "description": (
                        "List matches without closing. Ask the person in everyday "
                        "words — do not mention this parameter name in chat."
                    ),
                },
            },
        },
        handler=_close_threads,
        mutating=True,
        gated=True,
    )
)
