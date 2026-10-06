"""INTERPRETATION layer: LLM triage of inbound signals.

Timing: this runs on every inbound message *before* the reply path
(`workers.tasks.process_inbound_signal` calls `interpret_inbound` first), so a
conversation is read and typed even when AI replies are off or a human has
taken over. A certain category match files a ticket; unsure matches land as
`proposed` with a confirm chip on the thread; patterns no hashtag covers go to
the backlog in `services.signal_catalog`. Triage never invents a hashtag.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.services.channel_ai import inbox_policy
from app.services.signals import apply_triage, get_signal_detail

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
    """File the conversation's category from the triage read.

    A conversation has one category. Once it has a settled one, a certain read
    of a different category on the newest message is a new request: it goes to
    ``split_or_propose``. The ticket path enforces the category's create mode,
    thresholds, verification and the project choice; triage never bypasses
    those. The project is the conversation's own when the playbook uses it;
    otherwise the operator picks it on the confirm chip.
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
    except Exception:  # noqa: BLE001 - triage must never fail the ingest pipeline
        logger.warning("triage ticket filing failed for #%s", category.name, exc_info=True)


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
        logger.warning("triage split failed for signal %s", signal_id, exc_info=True)


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


async def triage_signal(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> dict:
    detail = await get_signal_detail(session, tenant_id, signal_id)
    messages = detail.get("messages") or []
    body = messages[-1]["body_text"] if messages else detail.get("subject", "")

    tenant = await session.get(Tenant, tenant_id)
    threshold = inbox_policy(tenant)["certainty_threshold"]

    from app.services.agent.llm import get_chat_provider
    from app.services.model_resolution import record_usage, resolve_model_call

    resolved = await resolve_model_call(session, tenant_id, kind="chat")
    llm = get_chat_provider(
        resolved.provider_type, resolved.api_key, resolved.base_url or None
    )
    from app.services.agent.style import PLAIN_STYLE, strip_emoji
    from app.services.signal_tags import ai_catalog_lines
    from app.services.tickets import category_catalog_lines, list_categories

    # Curated vocabulary: AI may only pick hashtags the workspace has, reading
    # each description as guidance. It never invents one.
    categories = await list_categories(session, tenant_id)
    category_hints = await category_catalog_lines(session, tenant_id)
    tag_hints = await ai_catalog_lines(session, tenant_id)
    vocabulary_line = (
        '"ticket_category":"at most one category hashtag that clearly applies, ONLY from '
        "this list, or empty: " + "; ".join(category_hints) + '",'
        if category_hints
        else ""
    )
    if tag_hints:
        vocabulary_line += (
            '"tags":["zero or more free hashtags that clearly apply, ONLY from this list: '
            + "; ".join(tag_hints)
            + '"],'
        )
    prompt = (
        "Classify this inbound signal. Reply with JSON only:\n"
        '{"category":"support|sales|billing|other","urgency":0-100,"impact":0-100,'
        f"{vocabulary_line}"
        '"intent":"question|implementation_request|bug_report|feedback|complaint|other",'
        '"sentiment":"positive|neutral|negative",'
        '"unknown_signal":{"name":"2-4 word name for the kind of request this is, '
        'only when NO hashtag above fits","sentence":"one sentence describing when a '
        'hashtag like this applies","quote":"short quote from the message"},'
        '"summary":"one sentence","certainty":0-100,"priority":"normal|high|urgent"}\n'
        "intent guide: implementation_request = the sender asks for a new feature, "
        "change, or piece of work; bug_report = something is broken or behaving "
        "wrong; feedback = opinions or suggestions without a direct ask.\n"
        "hashtag guide: only include a hashtag when the message clearly matches its "
        "description; when in doubt, leave it out. Write names without #.\n"
        "unknown_signal guide: fill this only when the message asks for something "
        "recurring that no hashtag above covers. Never invent a hashtag; "
        "leave unknown_signal out for small talk, thanks, or one-off questions.\n"
        f"{PLAIN_STYLE}\n\n"
        f"Subject: {detail.get('subject')}\nFrom: {detail.get('contact_email')}\n\n{body}"
    )
    response = await llm.chat(
        [{"role": "user", "content": prompt}], tools=None, model=resolved.model_id
    )
    _usage = response.get("usage", {})
    await record_usage(
        session, tenant_id, resolved,
        tokens_in=_usage.get("input_tokens", 0), tokens_out=_usage.get("output_tokens", 0),
        scope="triage", scope_id=str(signal_id), call_type="triage",
    )
    text_blocks = [b["text"] for b in response.get("content", []) if b.get("type") == "text"]
    raw = "\n".join(text_blocks).strip()
    try:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        parsed = json.loads(raw[start:end]) if start >= 0 else {}
    except (json.JSONDecodeError, ValueError):
        parsed = {
            "category": "other",
            "urgency": 50,
            "impact": 40,
            "summary": detail.get("subject", "Inbound signal"),
            "certainty": 50,
            "priority": "normal",
        }

    priority = parsed.get("priority", "normal")
    if int(parsed.get("certainty", 0)) < threshold * 10:
        priority = "normal"

    from app.services.signal_tags import normalize_tag

    by_name = {row.name: row for row in categories}
    picked = by_name.get(normalize_tag(str(parsed.get("ticket_category") or "")))
    raw_tags = parsed.get("tags")
    suggested_tags = [s for s in raw_tags if isinstance(s, str)] if isinstance(raw_tags, list) else []

    category = str(parsed.get("category", "other"))
    intent = str(parsed.get("intent") or "")
    if intent not in (
        "question",
        "implementation_request",
        "bug_report",
        "feedback",
        "complaint",
        "other",
    ):
        intent = ""
    sentiment = str(parsed.get("sentiment") or "")
    if sentiment not in ("positive", "neutral", "negative"):
        sentiment = ""

    summary = strip_emoji(str(parsed.get("summary", "")))[:500]
    certainty = int(parsed.get("certainty", 50))
    signal = await apply_triage(
        session,
        tenant_id,
        signal_id,
        category=category,
        urgency=int(parsed.get("urgency", 50)),
        impact=int(parsed.get("impact", 40)),
        summary=summary,
        certainty=certainty,
        priority=priority if priority in ("normal", "high", "urgent") else "normal",
        intent=intent or None,
        sentiment=sentiment or None,
    )

    certain = certainty >= threshold * 10
    if suggested_tags and certain:
        from app.services.signal_tags import add_signal_tags

        _, added = await add_signal_tags(
            session, tenant_id, signal_id, suggested_tags, registered_only=True
        )
        if added:
            await session.commit()
    # A category match files a ticket. The category's create mode and
    # thresholds decide whether it opens (certain) or lands as `proposed`
    # with a confirm chip on the thread (unsure).
    if picked is not None:
        await _file_from_triage(
            session,
            tenant_id,
            signal_id=signal_id,
            category=picked,
            summary=summary,
            certainty=certainty,
            certain=certain,
        )
    elif not suggested_tags:
        # No hashtag fits: count the pattern in the backlog so an owner can
        # turn it into a category once it recurs. Never a new hashtag here.
        await _record_unknown_signal(
            session, tenant_id, parsed.get("unknown_signal"), fallback_quote=body
        )
    # Work-shaped intent on a project thread: surface an "add to queue" chip.
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

    from app.services.signals import serialize_signal

    return serialize_signal(signal)


async def interpret_inbound(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID
) -> dict | None:
    """Interpret one inbound message before any reply is drafted.

    Called first in the inbound pipeline, so category, intent and typed signals
    exist even when AI replies are off, the channel cannot send, or a human has
    taken the thread over. Failures are swallowed: reading must never block the
    conversation.
    """
    try:
        return await triage_signal(session, tenant_id, signal_id)
    except Exception:  # noqa: BLE001
        logger.warning("Interpretation failed for signal %s", signal_id, exc_info=True)
        try:
            await session.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None
