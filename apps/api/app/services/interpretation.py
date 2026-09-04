"""INTERPRETATION layer: LLM triage of inbound signals."""

from __future__ import annotations

import json
import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.services.channel_ai import inbox_policy
from app.services.signals import apply_triage, get_signal_detail

logger = logging.getLogger(__name__)


async def _create_cases_from_triage(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_id: UUID,
    slugs: list[str],
    enabled_types: list,
    summary: str,
    certainty: int,
) -> None:
    """Open/propose a Case for each catalog hit, skipping duplicates.

    The case create path enforces the type's create_mode, thresholds and
    verification requirement — triage never bypasses those gates.
    """
    from sqlalchemy import select

    from app.models.case import Case
    from app.services.cases import create_case, slugify

    # Stored slugs are always slugified (hyphens); the LLM may echo underscore
    # variants from module catalogs, so normalize both sides before matching.
    by_slug = {slugify(row.slug): row for row in enabled_types}
    existing_type_ids = set(
        (
            await session.execute(
                select(Case.case_type_id).where(
                    Case.tenant_id == tenant_id,
                    Case.signal_id == signal_id,
                    Case.status != "cancelled",
                )
            )
        ).scalars()
    )
    score = max(0, min(10, round(certainty / 10)))
    for slug in slugs:
        case_type = by_slug.get(slugify(slug))
        if case_type is None or case_type.id in existing_type_ids:
            continue
        try:
            await create_case(
                session,
                tenant_id,
                case_type_id=case_type.id,
                signal_id=signal_id,
                title=case_type.name,
                summary=summary,
                certainty=score,
                actor="agent",
                created_by_type="triage",
                created_by_id="",
            )
            existing_type_ids.add(case_type.id)
        except Exception:
            # Triage must never fail the ingest pipeline over one case.
            logger.warning("triage case create failed for type %s", slug, exc_info=True)
            continue


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
    from app.services.cases import list_case_types

    # Curated intake: AI may only pick from the tenant's CaseType catalog,
    # reading each type's description as guidance — it never invents types.
    enabled_types = [row for row in await list_case_types(session, tenant_id) if row.enabled]
    type_hints = [
        f"{row.slug} - {row.description}" if (row.description or "").strip() else row.slug
        for row in enabled_types
    ]
    case_types_line = (
        '"case_types":["zero or more type slugs that clearly apply, ONLY from this list: '
        + "; ".join(type_hints)
        + '"],'
        if type_hints
        else ""
    )
    prompt = (
        "Classify this inbound signal. Reply with JSON only:\n"
        '{"category":"support|sales|billing|other","urgency":0-100,"impact":0-100,'
        f"{case_types_line}"
        '"intent":"question|implementation_request|bug_report|feedback|complaint|other",'
        '"sentiment":"positive|neutral|negative",'
        '"summary":"one sentence","certainty":0-100,"priority":"normal|high|urgent"}\n'
        "intent guide: implementation_request = the sender asks for a new feature, "
        "change, or piece of work; bug_report = something is broken or behaving "
        "wrong; feedback = opinions or suggestions without a direct ask.\n"
        "case_types guide: only include a type when the message clearly matches its "
        "description; when in doubt, leave the list empty.\n"
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

    raw_case_types = parsed.get("case_types")
    allowed_slugs = {row.slug for row in enabled_types}
    proposed_slugs = (
        [s for s in raw_case_types if isinstance(s, str) and s in allowed_slugs]
        if isinstance(raw_case_types, list)
        else []
    )

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

    # Catalog hits become Cases (typed intake), not tags. The type's own
    # create_mode + thresholds decide whether this auto-opens, asks the
    # customer, or waits for an operator.
    if proposed_slugs:
        await _create_cases_from_triage(
            session,
            tenant_id,
            signal_id=signal_id,
            slugs=proposed_slugs,
            enabled_types=enabled_types,
            summary=summary,
            certainty=certainty,
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
