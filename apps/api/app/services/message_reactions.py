"""Message reactions: social stack + learning bridge for scored kinds.

Emoji reactions are an intentional UI exception (Communication only). Do not
spread emoji elsewhere in the product.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import AppError, NotFoundError
from app.models.agent import Agent
from app.models.auth import User
from app.models.learning import Feedback
from app.models.message_reaction import MessageReaction
from app.models.signal import Signal, SignalMessage

logger = logging.getLogger(__name__)

ReactionKind = Literal[
    "up", "down", "hundred", "facepalm", "clap", "thinking", "investigating"
]
ActorType = Literal["user", "agent"]

REACTION_KINDS: tuple[ReactionKind, ...] = (
    "up",
    "down",
    "hundred",
    "facepalm",
    "clap",
    "thinking",
    "investigating",
)
# Legacy DB / tool values → current kind.
KIND_ALIASES: dict[str, ReactionKind] = {"angry": "facepalm"}
HUMAN_KINDS: frozenset[str] = frozenset(
    {"up", "down", "hundred", "facepalm", "clap", "thinking"}
)
AGENT_ONLY_KINDS: frozenset[str] = frozenset({"investigating"})
# Quality signal for EvalScore / breaker (human reactors preferred).
SCORED_KINDS: dict[str, tuple[str, int]] = {
    "up": ("up", 5),
    "hundred": ("up", 5),
    "clap": ("up", 5),
    "down": ("down", 1),
    "facepalm": ("down", 1),
}

# Display glyphs — Communication reaction UI only.
REACTION_EMOJI: dict[str, str] = {
    "up": "👍",
    "down": "👎",
    "hundred": "💯",
    "facepalm": "🙈",
    "clap": "👏",
    "thinking": "🤔",
    "investigating": "🔍",
}


def canonicalize_kind(kind: str | None) -> str:
    value = (kind or "").strip().lower()
    return KIND_ALIASES.get(value, value)


def normalize_kind(kind: str | None, *, actor_type: ActorType) -> ReactionKind:
    value = canonicalize_kind(kind)
    if value not in REACTION_KINDS:
        raise AppError("Unknown reaction kind", code="app_error", status_code=400)
    if actor_type == "user" and value in AGENT_ONLY_KINDS:
        raise HTTPException(
            status_code=403,
            detail="Only agents can use the investigating reaction",
        )
    return value  # type: ignore[return-value]


async def _load_message(
    session: AsyncSession, tenant_id: UUID, message_id: UUID
) -> SignalMessage:
    message = (
        await session.execute(
            select(SignalMessage).where(
                SignalMessage.id == message_id,
                SignalMessage.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if message is None:
        raise NotFoundError("Message not found")
    return message


async def _sync_learning_feedback(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    message_id: UUID,
    actor_type: ActorType,
    actor_id: UUID,
    kind: ReactionKind | None,
) -> None:
    """Keep Feedback in sync for scored kinds; humans drive learning metrics."""
    if actor_type != "user":
        return

    existing = (
        await session.execute(
            select(Feedback).where(
                Feedback.tenant_id == tenant_id,
                Feedback.user_id == actor_id,
                Feedback.subject_type == "message",
                Feedback.subject_id == str(message_id),
            )
        )
    ).scalar_one_or_none()

    scored = SCORED_KINDS.get(kind) if kind else None
    if scored is None:
        if existing is not None:
            try:
                meta = json.loads(existing.metadata_json or "{}")
            except json.JSONDecodeError:
                meta = {}
            if isinstance(meta, dict) and meta.get("source") == "reaction":
                await session.delete(existing)
        return

    sentiment, score = scored
    meta = {"source": "reaction", "kind": kind}
    if existing is None:
        session.add(
            Feedback(
                tenant_id=tenant_id,
                subject_type="message",
                subject_id=str(message_id),
                user_id=actor_id,
                score=score,
                sentiment=sentiment,
                metadata_json=json.dumps(meta),
            )
        )
        return
    existing.score = score
    existing.sentiment = sentiment
    existing.processed = False
    existing.metadata_json = json.dumps(meta)
    session.add(existing)


async def set_reaction(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    message_id: UUID,
    actor_type: ActorType,
    actor_id: UUID,
    kind: str,
    commit: bool = True,
) -> dict[str, Any]:
    """Set or replace this actor's reaction on the message."""
    message = await _load_message(session, tenant_id, message_id)
    norm = normalize_kind(kind, actor_type=actor_type)
    now = utcnow()

    row = (
        await session.execute(
            select(MessageReaction).where(
                MessageReaction.tenant_id == tenant_id,
                MessageReaction.message_id == message_id,
                MessageReaction.actor_type == actor_type,
                MessageReaction.actor_id == actor_id,
            )
        )
    ).scalar_one_or_none()

    if row is None:
        row = MessageReaction(
            tenant_id=tenant_id,
            signal_id=message.signal_id,
            message_id=message_id,
            kind=norm,
            actor_type=actor_type,
            actor_id=actor_id,
            created_at=now,
            updated_at=now,
        )
    else:
        if row.kind == norm:
            # Same kind again = clear (LinkedIn toggle).
            return await clear_reaction(
                session,
                tenant_id=tenant_id,
                message_id=message_id,
                actor_type=actor_type,
                actor_id=actor_id,
                commit=commit,
            )
        row.kind = norm
        row.updated_at = now
    session.add(row)
    await _sync_learning_feedback(
        session,
        tenant_id=tenant_id,
        message_id=message_id,
        actor_type=actor_type,
        actor_id=actor_id,
        kind=norm,
    )

    if norm in ("down", "facepalm") and actor_type == "user":
        from app.models.auth import Tenant
        from app.services.ai_handling import check_breaker, load_layers

        signal = await session.get(Signal, message.signal_id)
        tenant = await session.get(Tenant, tenant_id)
        if signal is not None and tenant is not None:
            account, _contact = await load_layers(session, tenant_id, signal)
            await check_breaker(session, tenant, account)

    if commit:
        await session.commit()
    else:
        await session.flush()

    aggregate = await aggregate_for_messages(
        session,
        tenant_id,
        [message_id],
        viewer_type=actor_type,
        viewer_id=actor_id,
    )
    payload = aggregate.get(str(message_id)) or empty_aggregate()
    await _publish(message, payload)
    return payload


async def clear_reaction(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    message_id: UUID,
    actor_type: ActorType,
    actor_id: UUID,
    commit: bool = True,
) -> dict[str, Any]:
    message = await _load_message(session, tenant_id, message_id)
    await session.execute(
        delete(MessageReaction).where(
            MessageReaction.tenant_id == tenant_id,
            MessageReaction.message_id == message_id,
            MessageReaction.actor_type == actor_type,
            MessageReaction.actor_id == actor_id,
        )
    )
    await _sync_learning_feedback(
        session,
        tenant_id=tenant_id,
        message_id=message_id,
        actor_type=actor_type,
        actor_id=actor_id,
        kind=None,
    )
    if commit:
        await session.commit()
    else:
        await session.flush()

    aggregate = await aggregate_for_messages(
        session,
        tenant_id,
        [message_id],
        viewer_type=actor_type,
        viewer_id=actor_id,
    )
    payload = aggregate.get(str(message_id)) or empty_aggregate()
    await _publish(message, payload)
    return payload


def empty_aggregate() -> dict[str, Any]:
    return {"kinds": [], "mine": None}


async def aggregate_for_messages(
    session: AsyncSession,
    tenant_id: UUID,
    message_ids: list[UUID],
    *,
    viewer_type: ActorType | None = None,
    viewer_id: UUID | None = None,
) -> dict[str, dict[str, Any]]:
    """Build `{message_id: { kinds, mine }}` for thread serialization."""
    if not message_ids:
        return {}
    rows = list(
        (
            await session.execute(
                select(MessageReaction).where(
                    MessageReaction.tenant_id == tenant_id,
                    MessageReaction.message_id.in_(message_ids),
                )
            )
        ).scalars().all()
    )
    if not rows:
        return {str(mid): empty_aggregate() for mid in message_ids}

    user_ids = {r.actor_id for r in rows if r.actor_type == "user"}
    agent_ids = {r.actor_id for r in rows if r.actor_type == "agent"}
    users: dict[UUID, User] = {}
    agents: dict[UUID, Agent] = {}
    if user_ids:
        users = {
            u.id: u
            for u in (
                await session.execute(select(User).where(User.id.in_(user_ids)))
            ).scalars().all()
        }
    if agent_ids:
        agents = {
            a.id: a
            for a in (
                await session.execute(select(Agent).where(Agent.id.in_(agent_ids)))
            ).scalars().all()
        }

    by_message: dict[str, list[MessageReaction]] = {str(mid): [] for mid in message_ids}
    for row in rows:
        by_message.setdefault(str(row.message_id), []).append(row)

    out: dict[str, dict[str, Any]] = {}
    for mid, group in by_message.items():
        kind_order: list[str] = []
        buckets: dict[str, list[MessageReaction]] = {}
        mine: str | None = None
        for row in sorted(group, key=lambda r: r.updated_at or r.created_at):
            kind = canonicalize_kind(row.kind)
            buckets.setdefault(kind, []).append(row)
            if kind not in kind_order:
                kind_order.append(kind)
            if (
                viewer_type
                and viewer_id
                and row.actor_type == viewer_type
                and row.actor_id == viewer_id
            ):
                mine = kind
        kinds = []
        for kind in kind_order:
            reactors = buckets[kind]
            preview = []
            for r in reactors[:5]:
                preview.append(_reactor_preview(r, users, agents))
            kinds.append(
                {
                    "kind": kind,
                    "emoji": REACTION_EMOJI.get(kind, ""),
                    "count": len(reactors),
                    "reactors": preview,
                }
            )
        out[mid] = {"kinds": kinds, "mine": mine}
    return out


def _reactor_preview(
    row: MessageReaction,
    users: dict[UUID, User],
    agents: dict[UUID, Agent],
) -> dict[str, Any]:
    if row.actor_type == "user":
        user = users.get(row.actor_id)
        name = (
            (user.display_name or user.email or "Teammate") if user else "Teammate"
        )
        return {
            "actor_type": "user",
            "actor_id": str(row.actor_id),
            "name": name,
        }
    agent = agents.get(row.actor_id)
    return {
        "actor_type": "agent",
        "actor_id": str(row.actor_id),
        "name": agent.name if agent else "Agent",
    }


async def _publish(message: SignalMessage, aggregate: dict[str, Any]) -> None:
    try:
        from app.gateway.publish import publish_message_reaction

        await publish_message_reaction(
            tenant_id=message.tenant_id,
            signal_id=message.signal_id,
            message_id=message.id,
            reactions=aggregate,
        )
    except Exception:  # noqa: BLE001 — never break the write path
        logger.warning(
            "publish message reaction failed for message %s",
            message.id,
            exc_info=True,
        )
