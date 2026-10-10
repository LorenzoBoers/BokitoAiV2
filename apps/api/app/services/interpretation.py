"""Thread-read side effects for the channel agent's inbound run.

The inbound worker no longer calls a separate triage LLM. The linked channel
agent calls ``record_thread_read`` (and tag/ticket/contact tools) in one
``AgentLoop``. Helpers here persist scores, auto-tags, ticket filing, splits,
and the unknown-signal backlog with the same certainty thresholds as before.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.services.channel_ai import inbox_policy
from app.services.signals import apply_triage

logger = logging.getLogger(__name__)


async def _file_from_triage(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_id: UUID,
    category,
    summary: str,
    certainty: int,
    certain: bool = False,
) -> None:
    """File the conversation's category from the thread read.

    A conversation has one category. Once it has a settled one, a certain read
    of a different category on the newest message is a new request: it goes to
    ``split_or_propose``. The ticket path enforces the category's create mode,
    thresholds, verification and the project choice; this never bypasses those.
    """
    from app.models.signal import Signal
    from app.services.tickets import file_ticket, playbook_project_ids

    signal = await session.get(Signal, signal_id)
    if signal is None:
        return
    if signal.ticket_tag_id is not None:
        if not certain or signal.ticket_status == "proposed" or signal.ticket_tag_id == category.id:
            return
        await _split_new_intent(session, tenant_id, signal_id, category, summary)
        return
    choices = await playbook_project_ids(session, tenant_id, category.workstream_id)
    project_chosen = not choices or signal.project_id in choices
    try:
        await file_ticket(
            session,
            tenant_id,
            signal_id=signal_id,
            tag_id=category.id,
            project_id=signal.project_id if choices and project_chosen else None,
            project_chosen=project_chosen,
            summary=summary,
            certainty=max(0, min(10, round(certainty / 10))),
            actor="agent",
            created_by_type="triage",
            created_by_id="",
        )
    except Exception:  # noqa: BLE001 - read path must never fail the ingest pipeline
        logger.warning("thread-read ticket filing failed for #%s", category.name, exc_info=True)


async def _split_new_intent(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID, category, summary: str
) -> None:
    from app.models.signal import Signal
    from app.services.conversation_split import split_or_propose

    signal = await session.get(Signal, signal_id)
    if signal is None:
        return
    try:
        await split_or_propose(
            session, tenant_id, signal, category=category, agent_id=signal.agent_id,
            reason=summary,
        )
    except Exception:  # noqa: BLE001 - a split must never fail the ingest pipeline
        logger.warning("thread-read split failed for signal %s", signal_id, exc_info=True)


async def _propose_file_tag(
    session: AsyncSession,
    tenant: Tenant | None,
    signal_id: UUID,
    category,
    *,
    summary: str,
    agent_id: UUID | None,
) -> None:
    """Ask once, in the thread, to file a confident read that is not auto-tagged."""
    from datetime import datetime, timedelta

    from sqlalchemy import and_, or_, select

    from app.models.notification import DecisionRequest
    from app.services.language import resolve_workspace_language
    from app.services.signal_decisions import create_decision

    if tenant is None:
        return
    lang = resolve_workspace_language(tenant)
    title = (
        f"Dien in als #{category.name}"
        if lang == "nl"
        else f"File as #{category.name}"
    )
    since = datetime.utcnow() - timedelta(days=7)
    existing = (
        await session.execute(
            select(DecisionRequest.id).where(
                DecisionRequest.tenant_id == tenant.id,
                DecisionRequest.signal_id == signal_id,
                DecisionRequest.title == title,
                or_(
                    DecisionRequest.status == "awaiting_human",
                    and_(
                        DecisionRequest.status.in_(("rejected", "deferred")),
                        DecisionRequest.resolved_at.is_not(None),
                        DecisionRequest.resolved_at >= since,
                    ),
                ),
            )
        )
    ).first()
    if existing:
        return
    file_label = "Dien in" if lang == "nl" else "File"
    later_label = "Niet nu" if lang == "nl" else "Not now"
    summary_text = summary or (
        "Deze lezing is zeker genoeg om in te dienen. Jij bevestigt de actietag."
        if lang == "nl"
        else "This read is confident enough to file. You confirm the action tag."
    )
    try:
        await create_decision(
            session,
            tenant.id,
            title=title,
            summary=summary_text[:500],
            options=[
                {
                    "id": "file",
                    "label": file_label,
                    "action_type": "file_ticket",
                    "payload": {
                        "signal_id": str(signal_id),
                        "tag_id": str(category.id),
                        "summary": summary[:500],
                    },
                },
                {"id": "later", "label": later_label, "action_type": "defer"},
            ],
            agent_id=agent_id,
            signal_id=signal_id,
            source_type="thread_read",
            source_id=str(category.id),
        )
    except Exception:  # noqa: BLE001 - a card must never fail the read
        logger.warning("file-as-tag card failed for #%s", category.name, exc_info=True)


async def _record_unknown_signal(
    session: AsyncSession,
    tenant_id: UUID,
    raw: object,
    *,
    fallback_quote: str = "",
) -> None:
    """Count one sighting of a pattern no hashtag covers (never creates one)."""
    if not isinstance(raw, dict):
        return
    name = str(raw.get("name") or "").strip()
    if not name:
        return
    from app.services.agent.style import strip_emoji
    from app.services.signal_catalog import record_unknown

    quote = str(raw.get("quote") or "").strip() or (fallback_quote or "")[:200]
    try:
        await record_unknown(
            session,
            tenant_id,
            name=strip_emoji(name),
            sentence=strip_emoji(str(raw.get("sentence") or "")),
            example=strip_emoji(quote),
        )
    except Exception:  # noqa: BLE001 — the backlog must never fail ingest
        logger.warning("backlog record failed for %s", name, exc_info=True)


async def apply_thread_read(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    summary: str,
    certainty: int = 50,
    category: str = "other",
    urgency: int = 50,
    impact: int = 40,
    priority: str = "normal",
    intent: Optional[str] = None,
    sentiment: Optional[str] = None,
    ticket_category: str = "",
    tags: Optional[list[str]] = None,
    unknown_signal: Any = None,
    agent_id: Optional[UUID] = None,
    agent_name: Optional[str] = None,
    body_quote: str = "",
) -> dict:
    """Persist a structured thread read and apply tags / ticket / backlog.

    Called from the ``record_thread_read`` tool during the inbound agent run.
    """
    from app.services.agent.style import strip_emoji
    from app.services.signal_tags import normalize_tag, registry_rows
    from app.services.signals import serialize_signal

    tenant = await session.get(Tenant, tenant_id)
    threshold = inbox_policy(tenant)["certainty_threshold"]

    certainty = max(0, min(100, int(certainty)))
    if certainty < threshold * 10:
        priority = "normal"
    if priority not in ("normal", "high", "urgent"):
        priority = "normal"

    if intent not in (
        "question",
        "implementation_request",
        "bug_report",
        "feedback",
        "complaint",
        "other",
    ):
        intent = None
    if sentiment not in ("positive", "neutral", "negative"):
        sentiment = None

    summary = strip_emoji(str(summary or ""))[:500]
    if not summary:
        summary = "Inbound message"

    category = str(category or "other")
    if category not in ("support", "sales", "billing", "other"):
        category = "other"

    all_tags = await registry_rows(session, tenant_id)
    categories = [row for row in all_tags if row.workstream_id is not None]
    by_name = {row.name: row for row in categories}
    picked = by_name.get(normalize_tag(str(ticket_category or "")))
    suggested_tags = [s for s in (tags or []) if isinstance(s, str)]

    certain = certainty >= threshold * 10
    tags_applied: list[str] = []
    ticket_tag_name = ""

    if suggested_tags and certain:
        from app.services.signal_tags import add_signal_tags

        allowed = {
            row.name
            for row in all_tags
            if row.workstream_id is None and bool(row.ai_auto_tag)
        }
        applyable = [name for name in suggested_tags if normalize_tag(name) in allowed]
        if applyable:
            _, added = await add_signal_tags(
                session, tenant_id, signal_id, applyable, registered_only=True
            )
            tags_applied = list(added or [])
            if tags_applied:
                await session.commit()

    if picked is not None and bool(picked.ai_auto_tag):
        ticket_tag_name = picked.name
        await _file_from_triage(
            session,
            tenant_id,
            signal_id=signal_id,
            category=picked,
            summary=summary,
            certainty=certainty,
            certain=certain,
        )
    elif picked is not None and certain:
        await _propose_file_tag(
            session,
            tenant,
            signal_id,
            picked,
            summary=summary,
            agent_id=agent_id,
        )
    elif not suggested_tags:
        await _record_unknown_signal(
            session, tenant_id, unknown_signal, fallback_quote=body_quote
        )

    signal = await apply_triage(
        session,
        tenant_id,
        signal_id,
        category=category,
        urgency=int(urgency),
        impact=int(impact),
        summary=summary,
        certainty=certainty,
        priority=priority,
        intent=intent,
        sentiment=sentiment,
        agent_id=agent_id,
        agent_name=agent_name,
        tags_applied=tags_applied or None,
        ticket_tag=ticket_tag_name or None,
    )

    if signal.project_id and intent in ("implementation_request", "bug_report"):
        try:
            chips = json.loads(signal.suggested_actions_json or "[]")
        except json.JSONDecodeError:
            chips = []
        if "add_to_queue" not in chips:
            signal.suggested_actions_json = json.dumps(([*chips, "add_to_queue"])[:4])
            session.add(signal)
            await session.commit()
            await session.refresh(signal)

    return serialize_signal(signal)


async def triage_signal(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> dict:
    """Legacy entry: enqueue is preferred; kept for direct structured tests.

    Prefer the inbound agent ``record_thread_read`` tool. This helper applies a
    minimal read from the newest message subject when called without an agent.
    """
    from app.services.signals import get_triage_context

    ctx = await get_triage_context(session, tenant_id, signal_id)
    return await apply_thread_read(
        session,
        tenant_id,
        signal_id,
        summary=(ctx.get("subject") or "Inbound signal")[:500],
        certainty=50,
        category="other",
        urgency=50,
        impact=40,
        priority="normal",
        body_quote=str(ctx.get("body") or "")[:200],
    )


async def interpret_inbound(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID
) -> dict | None:
    """Deprecated: inbound interpretation is the channel agent's job.

    Kept as a no-op-safe shim for any stray callers; returns None.
    """
    del session, tenant_id, signal_id
    return None
