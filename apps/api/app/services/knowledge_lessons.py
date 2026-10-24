"""Turn a correction, a verdict or an intuition into one labeled lesson.

A lesson is a section on the workspace page ``lessen.md`` plus at least one
``knowledge_evidence`` row. It starts as a concept. Two independent
conversations that share a label promote it. A contradiction of a final
section opens a decision and leaves the text in place.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workspace import (
    LESSON_EVIDENCE_KINDS,
    DocSection,
    KnowledgeEvidence,
    WorkspaceDoc,
)
from app.services.workspace import (
    conversation_tag_ids,
    hybrid_search,
    set_section_status,
    set_section_tags,
    update_section,
    upsert_section,
    word_count,
)

logger = logging.getLogger(__name__)

async def list_lessons(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    status: str | None = None,
    tag_id: UUID | None = None,
    agent_id: UUID | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Sections that have evidence: the lesson list, not every draft page."""
    from app.models.signal import SignalTag
    from app.models.workspace import DocSectionTagLink

    stmt = (
        select(DocSection)
        .join(KnowledgeEvidence, KnowledgeEvidence.section_id == DocSection.id)
        .where(DocSection.tenant_id == tenant_id)
        .distinct()
    )
    if status:
        stmt = stmt.where(DocSection.status == status)
    if agent_id is not None:
        stmt = stmt.where(KnowledgeEvidence.agent_id == agent_id)
    if tag_id is not None:
        stmt = stmt.where(
            DocSection.id.in_(
                select(DocSectionTagLink.section_id).where(DocSectionTagLink.tag_id == tag_id)
            )
        )
    sections = list((await session.execute(stmt.limit(max(1, min(limit, 100))))).scalars().all())
    out: list[dict[str, Any]] = []
    for section in sections:
        evidence = (
            await session.execute(
                select(KnowledgeEvidence).where(KnowledgeEvidence.section_id == section.id)
            )
        ).scalars().all()
        tags = (
            await session.execute(
                select(SignalTag)
                .join(DocSectionTagLink, DocSectionTagLink.tag_id == SignalTag.id)
                .where(DocSectionTagLink.section_id == section.id)
            )
        ).scalars().all()
        signal_ids = [row.signal_id for row in evidence if row.signal_id]
        out.append(
            {
                "id": str(section.id),
                "doc_id": str(section.doc_id),
                "heading": section.heading,
                "status": section.status,
                "signals": len(set(signal_ids)),
                "signal_id": str(signal_ids[-1]) if signal_ids else None,
                "tags": [{"id": str(tag.id), "name": tag.name} for tag in tags],
            }
        )
    return out


LESSON_PATH = "lessen.md"
SAME_THRESHOLD = 0.90
NEW_THRESHOLD = 0.78
MIN_LESSON_WORDS = 25
MAX_LESSON_WORDS = 400

LessonKind = Literal["correction", "verdict", "intuition", "call", "pattern", "human"]
JudgeRelation = Literal["same", "augments", "contradicts", "different"]


@dataclass
class LessonInput:
    tenant_id: UUID
    agent_id: UUID | None
    signal_id: UUID | None
    kind: LessonKind
    source_ref: str
    heading: str
    body: str


@dataclass
class LessonOutcome:
    action: Literal["created", "same", "updated", "contradiction", "skipped"]
    section_id: UUID | None = None
    reason: str = ""
    decision_id: UUID | None = None
    heading: str = ""


@dataclass
class _Neighbor:
    section_id: UUID
    vector: float
    title: str
    content: str
    status: str
    is_lesson: bool


def _clip(body: str) -> str:
    words = (body or "").split()
    if len(words) > MAX_LESSON_WORDS:
        return " ".join(words[:MAX_LESSON_WORDS])
    return (body or "").strip()


async def lesson_doc(session: AsyncSession, tenant_id: UUID) -> WorkspaceDoc:
    from app.core.time import utcnow
    from app.services.trash import alive

    # A workspace can already have more than one lessen.md. Use the oldest live page.
    found = (
        await session.execute(
            select(WorkspaceDoc)
            .where(
                WorkspaceDoc.tenant_id == tenant_id,
                WorkspaceDoc.path == LESSON_PATH,
                alive(WorkspaceDoc),
            )
            .order_by(WorkspaceDoc.created_at.asc())
            .limit(1)
        )
    ).scalars().first()
    if found is not None:
        return found
    now = utcnow()
    doc = WorkspaceDoc(
        tenant_id=tenant_id,
        path=LESSON_PATH,
        kind="skill",
        title="Lessen",
        content="",
        agent_id=None,
        department_id=None,
        internal=True,
        created_by_type="system",
        created_at=now,
        updated_at=now,
    )
    session.add(doc)
    await session.flush()
    return doc


async def _existing_evidence(
    session: AsyncSession, tenant_id: UUID, source_ref: str
) -> KnowledgeEvidence | None:
    if not source_ref:
        return None
    return (
        await session.execute(
            select(KnowledgeEvidence)
            .where(
                KnowledgeEvidence.tenant_id == tenant_id,
                KnowledgeEvidence.source_ref == source_ref,
            )
            .limit(1)
        )
    ).scalar_one_or_none()


async def _merge_tags(
    session: AsyncSession, tenant_id: UUID, section_id: UUID, tag_ids: list[UUID]
) -> None:
    from app.models.workspace import DocSectionTagLink

    current = (
        await session.execute(
            select(DocSectionTagLink.tag_id).where(DocSectionTagLink.section_id == section_id)
        )
    ).scalars().all()
    merged = list(dict.fromkeys([*current, *tag_ids]))
    await set_section_tags(session, tenant_id, section_id, merged)


async def _add_evidence(
    session: AsyncSession,
    lesson: LessonInput,
    section_id: UUID,
    tag_ids: list[UUID],
) -> KnowledgeEvidence | None:
    if lesson.kind not in LESSON_EVIDENCE_KINDS:
        return None
    prior = await _existing_evidence(session, lesson.tenant_id, lesson.source_ref)
    if prior is not None:
        return prior
    row = KnowledgeEvidence(
        tenant_id=lesson.tenant_id,
        section_id=section_id,
        kind=lesson.kind,
        signal_id=lesson.signal_id,
        source_ref=lesson.source_ref[:200],
        agent_id=lesson.agent_id,
        tag_ids_json=json.dumps([str(tag_id) for tag_id in tag_ids]),
        excerpt=(lesson.body or "")[:500],
    )
    session.add(row)
    await session.flush()
    return row


async def _section_status(session: AsyncSession, section_id: UUID) -> str:
    section = await session.get(DocSection, section_id)
    return section.status if section is not None else "draft"


async def maybe_promote(session: AsyncSession, tenant_id: UUID, section_id: UUID) -> bool:
    """Two conversations, one shared label, and the section becomes final."""
    rows = (
        await session.execute(
            select(KnowledgeEvidence).where(
                KnowledgeEvidence.tenant_id == tenant_id,
                KnowledgeEvidence.section_id == section_id,
            )
        )
    ).scalars().all()
    by_signal: dict[UUID, set[str]] = {}
    for row in rows:
        if row.signal_id is None:
            continue
        try:
            tags = set(json.loads(row.tag_ids_json or "[]"))
        except json.JSONDecodeError:
            tags = set()
        by_signal.setdefault(row.signal_id, set()).update(str(tag) for tag in tags)
    signals = list(by_signal)
    if len(signals) < 2:
        return False
    shared = False
    for index, left in enumerate(signals):
        for right in signals[index + 1 :]:
            if by_signal[left] & by_signal[right]:
                shared = True
                break
    if not shared:
        return False
    section = await session.get(DocSection, section_id)
    if section is None or section.status == "final":
        return section is not None and section.status == "final"
    await set_section_status(
        session,
        tenant_id,
        section_id,
        "final",
        actor_type="system",
        actor_id="propose_lesson",
        commit=False,
    )
    return True


async def judge_lesson(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    heading: str,
    body: str,
    neighbor_title: str,
    neighbor_body: str,
) -> JudgeRelation:
    """One cheap call. A failed judge does not invent a contradiction."""
    from app.services.model_resolution import record_usage, resolve_model_call

    resolved = await resolve_model_call(session, tenant_id, kind="chat")
    if not getattr(resolved, "live", False) or not getattr(resolved, "api_key", ""):
        return "different"
    prompt = (
        "Compare a candidate lesson with one existing lesson. "
        "Reply with JSON {\"relation\": \"same|augments|contradicts|different\", \"difference\": \"...\"}. "
        "same: the same rule. augments: adds a step to the same rule. "
        "contradicts: the new text denies the old rule. different: another topic.\n\n"
        f"Candidate: {heading}\n{body[:1200]}\n\n"
        f"Existing: {neighbor_title}\n{neighbor_body[:1200]}"
    )
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=resolved.api_key,
            base_url=resolved.base_url or None,
            timeout=8.0,
        )
        response = await client.chat.completions.create(
            model=resolved.model_id,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )
        usage = getattr(response, "usage", None)
        await record_usage(
            session,
            tenant_id,
            resolved,
            tokens_in=int(getattr(usage, "prompt_tokens", 0) or 0),
            tokens_out=int(getattr(usage, "completion_tokens", 0) or 0),
            call_type="knowledge_lesson",
            commit=False,
        )
        text = (response.choices[0].message.content or "").strip()
        start = text.find("{")
        end = text.rfind("}")
        data = json.loads(text[start : end + 1] if start >= 0 else text)
        relation = str(data.get("relation") or "different")
        if relation in ("same", "augments", "contradicts", "different"):
            return relation  # type: ignore[return-value]
    except Exception:
        logger.debug("lesson judge failed", exc_info=True)
    return "different"


async def _neighbors(
    session: AsyncSession, lesson: LessonInput, tag_ids: list[UUID]
) -> list[_Neighbor]:
    hits = await hybrid_search(
        session,
        lesson.tenant_id,
        f"{lesson.heading}\n{lesson.body[:400]}",
        top_k=12,
        agent_id=lesson.agent_id,
        tag_ids=tag_ids or None,
    )
    found: list[_Neighbor] = []
    for hit in hits:
        raw = hit.get("section_id")
        if not raw:
            continue
        try:
            section_id = UUID(str(raw))
        except ValueError:
            continue
        status = await _section_status(session, section_id)
        found.append(
            _Neighbor(
                section_id=section_id,
                vector=float(hit.get("vector") or 0),
                title=str(hit.get("title") or ""),
                content=str(hit.get("content") or ""),
                status=status,
                is_lesson=bool(hit.get("is_lesson")),
            )
        )
    return found


async def _note(session: AsyncSession, lesson: LessonInput, outcome: LessonOutcome) -> None:
    if outcome.action not in {"created", "updated", "contradiction"} or lesson.signal_id is None:
        return
    from sqlalchemy import desc

    from app.models.signal import SignalMessage
    from app.services.agent.turn_persist import attach_activity_to_message

    message = (
        await session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == lesson.signal_id,
                SignalMessage.tenant_id == lesson.tenant_id,
                SignalMessage.author_agent_id.is_not(None),
            )
            .order_by(desc(SignalMessage.created_at))
            .limit(1)
        )
    ).scalar_one_or_none()
    if message is None:
        return
    label = {
        "created": f"Conceptles: {outcome.heading or lesson.heading}",
        "updated": "Zelfde les bijgewerkt",
        "contradiction": f"Conceptles spreekt definitief tegen: {outcome.heading or lesson.heading}",
    }[outcome.action]
    attach_activity_to_message(
        message,
        [
            {
                "id": f"lesson:{lesson.source_ref}"[:80],
                "kind": "other",
                "tool": "knowledge_lesson",
                "label": label,
                "section_id": str(outcome.section_id or ""),
            }
        ],
    )
    session.add(message)


async def _open_contradiction(
    session: AsyncSession,
    lesson: LessonInput,
    neighbor: _Neighbor,
    difference: str,
) -> UUID | None:
    from app.services.signal_decisions import create_decision

    decision, _message = await create_decision(
        session,
        lesson.tenant_id,
        title=f"Les wijkt af: {lesson.heading[:80]}",
        summary=difference or "Een nieuwe les spreekt een definitieve sectie tegen.",
        options=[
            {
                "id": "accept",
                "label": "Les overnemen",
                "action_type": "accept_lesson_change",
                "payload": {
                    "section_id": str(neighbor.section_id),
                    "heading": lesson.heading,
                    "body": lesson.body,
                },
            },
            {"id": "reject", "label": "Definitief laten staan", "action_type": "reject"},
        ],
        agent_id=lesson.agent_id,
        signal_id=lesson.signal_id,
        source_type="knowledge_lesson",
        source_id=str(neighbor.section_id),
        announce=True,
    )
    return decision.id


async def propose_lesson(
    session: AsyncSession,
    lesson: LessonInput,
    *,
    judge=None,
) -> LessonOutcome:
    body = _clip(lesson.body)
    heading = (lesson.heading or "Les").strip()[:120]
    if word_count(body) < MIN_LESSON_WORDS:
        return LessonOutcome(action="skipped", reason="short")
    prior = await _existing_evidence(session, lesson.tenant_id, lesson.source_ref)
    if prior is not None:
        return LessonOutcome(action="same", section_id=prior.section_id, reason="duplicate", heading=heading)

    tag_ids: list[UUID] = []
    if lesson.signal_id is not None:
        tag_ids = await conversation_tag_ids(session, lesson.tenant_id, lesson.signal_id)
    neighbors = await _neighbors(session, lesson, tag_ids)
    lessons = [item for item in neighbors if item.is_lesson]
    docs = [item for item in neighbors if not item.is_lesson]
    best = max(lessons, key=lambda item: item.vector) if lessons else None

    relation: JudgeRelation = "different"
    if best is not None and best.vector >= SAME_THRESHOLD:
        relation = "same"
    elif best is not None and best.vector >= NEW_THRESHOLD:
        relation = await (judge or judge_lesson)(
            session,
            lesson.tenant_id,
            heading=heading,
            body=body,
            neighbor_title=best.title,
            neighbor_body=best.content,
        )
    elif any(item.vector >= SAME_THRESHOLD for item in docs):
        return LessonOutcome(action="skipped", reason="known", heading=heading)

    if relation == "same" and best is not None:
        await _add_evidence(session, lesson, best.section_id, tag_ids)
        await _merge_tags(session, lesson.tenant_id, best.section_id, tag_ids)
        await maybe_promote(session, lesson.tenant_id, best.section_id)
        outcome = LessonOutcome(action="same", section_id=best.section_id, heading=heading)
        await _note(session, lesson, outcome)
        return outcome

    if relation == "contradicts" and best is not None and best.status == "final":
        decision_id = await _open_contradiction(session, lesson, best, "De nieuwe les spreekt de definitieve tekst tegen.")
        outcome = LessonOutcome(
            action="contradiction",
            section_id=best.section_id,
            decision_id=decision_id,
            heading=heading,
        )
        await _note(session, lesson, outcome)
        return outcome

    if relation in {"augments", "contradicts"} and best is not None and best.status != "final":
        await update_section(
            session,
            lesson.tenant_id,
            best.section_id,
            heading=heading,
            content=body,
            status="review",
            actor_type="agent",
            actor_id=str(lesson.agent_id or ""),
            commit=False,
        )
        await _add_evidence(session, lesson, best.section_id, tag_ids)
        await _merge_tags(session, lesson.tenant_id, best.section_id, tag_ids)
        outcome = LessonOutcome(action="updated", section_id=best.section_id, heading=heading)
        await _note(session, lesson, outcome)
        return outcome

    doc = await lesson_doc(session, lesson.tenant_id)
    section = await upsert_section(
        session,
        lesson.tenant_id,
        doc,
        heading=heading,
        content=body,
        actor_type="agent",
        actor_id=str(lesson.agent_id or ""),
        enforce_limit=True,
        commit=False,
    )
    await _add_evidence(session, lesson, section.id, tag_ids)
    await _merge_tags(session, lesson.tenant_id, section.id, tag_ids)
    from app.services.audit import record_audit

    await record_audit(
        session,
        lesson.tenant_id,
        action="knowledge:lesson_created",
        actor_type="agent",
        actor_id=str(lesson.agent_id or ""),
        agent_id=lesson.agent_id,
        resource_type="doc_section",
        resource_id=str(section.id),
        summary=f"Conceptles: {heading}",
        commit=False,
    )
    outcome = LessonOutcome(action="created", section_id=section.id, heading=heading)
    await _note(session, lesson, outcome)
    return outcome


async def propose_lesson_from_correction(session: AsyncSession, feedback) -> LessonOutcome:
    """Build one lesson from a stored draft_edit and propose it."""
    try:
        meta = json.loads(feedback.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    original = str(meta.get("original") or "")
    sent = str(meta.get("sent") or feedback.comment or "")
    customer = str(meta.get("customer") or "")
    category = str(meta.get("category") or "algemeen")
    signal_raw = str(meta.get("signal_id") or "")
    signal_id = None
    try:
        signal_id = UUID(signal_raw) if signal_raw else None
    except ValueError:
        signal_id = None
    heading = f"Antwoord bij {category}"
    body = (
        f"Als een concept antwoord dit zei: {original[:300]}. "
        f"Stuur in plaats daarvan: {sent[:600]}. "
        f"De klant schreef: {customer[:300]}. "
        "Gebruik deze formulering de volgende keer bij hetzelfde label."
    )
    return await propose_lesson(
        session,
        LessonInput(
            tenant_id=feedback.tenant_id,
            agent_id=None,
            signal_id=signal_id,
            kind="correction",
            source_ref=f"decision:{feedback.subject_id}",
            heading=heading,
            body=body,
        ),
    )


def schedule_lesson_scan_after_commit(session: AsyncSession, message_id: UUID) -> None:
    """Enqueue one scan after the turn commits. A missed scan only loses an intuition."""
    import asyncio

    from sqlalchemy import event

    pending: set[str] = session.info.setdefault("lesson_scans", set())
    pending.add(str(message_id))
    if session.info.get("lesson_scans_hooked"):
        return
    session.info["lesson_scans_hooked"] = True
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    def _after(_sync_session) -> None:
        ids = list(session.info.pop("lesson_scans", set()) or [])
        session.info["lesson_scans_hooked"] = False
        for mid in ids:
            loop.call_soon_threadsafe(lambda mid=mid: asyncio.ensure_future(_enqueue_lesson_scan(mid)))

    event.listen(session.sync_session, "after_commit", _after, once=True)


async def _enqueue_lesson_scan(message_id: str) -> None:
    try:
        from app.workers.tasks import _get_arq_pool

        redis = await _get_arq_pool()
        await redis.enqueue_job(
            "scan_turn_for_lesson",
            message_id,
            _job_id=f"lesson:{message_id}",
        )
    except Exception:
        logger.debug("lesson scan enqueue skipped", exc_info=True)


async def _turn_ready(session: AsyncSession, message) -> str | None:
    """A reason to stop, or None when the gates are open. No model call."""
    from datetime import timedelta

    from app.models.agent import Agent
    from app.models.learning import Feedback
    from app.services.agent_awareness import awareness_config, spent_today_cents

    if message is None or message.author_agent_id is None:
        return "no_agent"
    agent = await session.get(Agent, message.author_agent_id)
    if agent is None or not agent.is_active:
        return "inactive"
    mode = awareness_config(agent).get("mode") or "daily"
    if mode == "off":
        return "awareness_off"
    tags = await conversation_tag_ids(session, message.tenant_id, message.signal_id)
    if not tags:
        return "no_label"
    try:
        meta = json.loads(message.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    work = [
        item
        for item in (meta.get("activity") or [])
        if isinstance(item, dict) and item.get("kind") == "work" and not item.get("error")
    ]
    if len(work) < 2:
        return "thin_turn"
    since = message.created_at - timedelta(minutes=10) if message.created_at else None
    if since is not None:
        edited = (
            await session.execute(
                select(Feedback.id)
                .where(
                    Feedback.tenant_id == message.tenant_id,
                    Feedback.subject_type == "draft_edit",
                    Feedback.created_at >= since,
                    Feedback.metadata_json.contains(str(message.signal_id)),
                )
                .limit(1)
            )
        ).first()
        if edited:
            return "corrected"
    day_ago = message.created_at - timedelta(hours=24) if message.created_at else None
    if day_ago is not None:
        recent = (
            await session.execute(
                select(KnowledgeEvidence.id)
                .where(
                    KnowledgeEvidence.signal_id == message.signal_id,
                    KnowledgeEvidence.kind == "intuition",
                    KnowledgeEvidence.created_at >= day_ago,
                )
                .limit(1)
            )
        ).first()
        if recent:
            return "recent"
    spent = await spent_today_cents(session, message.tenant_id, agent.id)
    if spent >= awareness_config(agent)["daily_cost_cents"]:
        return "budget"
    return None


async def extract_lesson(session: AsyncSession, tenant_id: UUID, text: str) -> dict[str, Any] | None:
    from app.services.model_resolution import record_usage, resolve_model_call

    resolved = await resolve_model_call(session, tenant_id, kind="chat")
    if not getattr(resolved, "live", False) or not getattr(resolved, "api_key", ""):
        return None
    prompt = (
        "Is there one reusable lesson in this finished turn? "
        "No names, dates, amounts or one-off facts. "
        "Reply JSON {\"reusable\": bool, \"importance\": 1-10, \"heading\": \"\", \"body\": \"\", \"why\": \"\"}.\n\n"
        + text[:4000]
    )
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=resolved.api_key, base_url=resolved.base_url or None, timeout=8.0)
        response = await client.chat.completions.create(
            model=resolved.model_id,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )
        usage = getattr(response, "usage", None)
        await record_usage(
            session,
            tenant_id,
            resolved,
            tokens_in=int(getattr(usage, "prompt_tokens", 0) or 0),
            tokens_out=int(getattr(usage, "completion_tokens", 0) or 0),
            call_type="knowledge_lesson",
            commit=False,
        )
        raw = response.choices[0].message.content or ""
        start, end = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[start : end + 1] if start >= 0 else raw)
        if isinstance(data, dict):
            return data
    except Exception:
        logger.debug("lesson extract failed", exc_info=True)
    return None


async def scan_message(
    session: AsyncSession,
    message_id: UUID,
    *,
    extract=None,
) -> LessonOutcome:
    from app.models.signal import SignalMessage

    message = await session.get(SignalMessage, message_id)
    reason = await _turn_ready(session, message)
    if reason:
        return LessonOutcome(action="skipped", reason=reason)
    text = (message.body_text if message else "") or ""
    data = await (extract or extract_lesson)(session, message.tenant_id, text)
    if not data or not data.get("reusable") or int(data.get("importance") or 0) < 7:
        return LessonOutcome(action="skipped", reason="not_reusable")
    return await propose_lesson(
        session,
        LessonInput(
            tenant_id=message.tenant_id,
            agent_id=message.author_agent_id,
            signal_id=message.signal_id,
            kind="intuition",
            source_ref=f"message:{message.id}",
            heading=str(data.get("heading") or "Les")[:120],
            body=str(data.get("body") or ""),
        ),
    )


async def propose_lesson_from_verdict(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    signal_id: UUID,
    event_id: UUID,
    feedback: str,
    agent_id: UUID | None,
) -> LessonOutcome:
    text = (feedback or "").strip()
    return await propose_lesson(
        session,
        LessonInput(
            tenant_id=tenant_id,
            agent_id=agent_id,
            signal_id=signal_id,
            kind="verdict",
            source_ref=f"event:{event_id}",
            heading="Klantfeedback",
            body=text,
        ),
    )


_CORRECTION_MARKS = ("nee,", "nee ", "altijd", "niet zo", "we always", "no, we")


def _call_kind(lines: list[dict[str, str]]) -> tuple[str, str]:
    for line in lines:
        if line.get("role") != "user":
            continue
        text = line.get("text") or ""
        lowered = text.lower()
        if any(mark in lowered for mark in _CORRECTION_MARKS):
            return "correction", text
    joined = " ".join(line.get("text") or "" for line in lines)
    return "call", joined


async def review_lessons(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    action: str,
    section_ids: list[str],
    actor_id: str = "",
) -> dict[str, Any]:
    """Promote, defer or discard lessons from chat."""
    from datetime import timedelta

    from app.core.time import utcnow
    from app.services.workspace import delete_section

    done: list[str] = []
    for raw in section_ids:
        try:
            section_id = UUID(str(raw))
        except ValueError:
            continue
        if action == "promote":
            await set_section_status(
                session,
                tenant_id,
                section_id,
                "final",
                actor_type="user",
                actor_id=actor_id,
                commit=False,
            )
        elif action == "discard":
            await delete_section(session, tenant_id, section_id, commit=False)
        elif action == "defer":
            rows = (
                await session.execute(
                    select(KnowledgeEvidence).where(
                        KnowledgeEvidence.tenant_id == tenant_id,
                        KnowledgeEvidence.section_id == section_id,
                    )
                )
            ).scalars().all()
            until = utcnow() + timedelta(days=1)
            for row in rows:
                row.deferred_until = until
                session.add(row)
        else:
            return {"error": "unknown_action"}
        done.append(str(section_id))
    return {"action": action, "sections": done}


async def scan_call(session: AsyncSession, call_id: UUID) -> LessonOutcome:
    """One lesson from a finished call. A spoken correction is kind=correction."""
    from app.models.agent_call import AgentCall
    from app.models.signal import SignalMessage

    call = await session.get(AgentCall, call_id)
    if call is None:
        return LessonOutcome(action="skipped", reason="missing")
    messages = (
        await session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == call.signal_id,
                SignalMessage.tenant_id == call.tenant_id,
                SignalMessage.kind == "system_event",
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(20)
        )
    ).scalars().all()
    lines: list[dict[str, str]] = []
    for message in messages:
        try:
            meta = json.loads(message.metadata_json or "{}")
        except json.JSONDecodeError:
            continue
        if str(meta.get("agent_call_id") or "") != str(call.id):
            continue
        raw = (meta.get("call_log") or {}).get("lines") or []
        lines = [row for row in raw if isinstance(row, dict)]
        break
    if not lines:
        return LessonOutcome(action="skipped", reason="empty")
    kind, body = _call_kind(lines)
    if kind != "correction":
        reason = await _call_ready(session, call)
        if reason:
            return LessonOutcome(action="skipped", reason=reason)
    outcome = await propose_lesson(
        session,
        LessonInput(
            tenant_id=call.tenant_id,
            agent_id=call.agent_id,
            signal_id=call.signal_id,
            kind=kind,  # type: ignore[arg-type]
            source_ref=f"call:{call.id}",
            heading="Call",
            body=body,
        ),
    )
    if outcome.action in {"created", "same", "updated"}:
        await _propose_pattern(session, call, body)
    return outcome


async def _call_ready(session: AsyncSession, call) -> str | None:
    """Gates for an ordinary call. A spoken correction skips these."""
    from app.models.agent import Agent
    from app.services.agent_awareness import awareness_config, spent_today_cents

    if call.agent_id is None:
        return "no_agent"
    agent = await session.get(Agent, call.agent_id)
    if agent is None or not agent.is_active:
        return "inactive"
    if awareness_config(agent).get("mode") == "off":
        return "awareness_off"
    if not await conversation_tag_ids(session, call.tenant_id, call.signal_id):
        return "no_label"
    if await spent_today_cents(session, call.tenant_id, agent.id) >= awareness_config(agent)["daily_cost_cents"]:
        return "budget"
    return None


async def _propose_pattern(session: AsyncSession, call, body: str) -> None:
    """Three similar calls on one label in different threads become one pattern lesson."""
    from datetime import timedelta

    from app.core.time import utcnow

    tags = await conversation_tag_ids(session, call.tenant_id, call.signal_id)
    if not tags:
        return
    since = utcnow() - timedelta(days=30)
    rows = (
        await session.execute(
            select(KnowledgeEvidence).where(
                KnowledgeEvidence.tenant_id == call.tenant_id,
                KnowledgeEvidence.kind.in_(("call", "correction", "pattern")),
                KnowledgeEvidence.created_at >= since,
            )
        )
    ).scalars().all()
    for tag_id in tags:
        mark = str(tag_id)
        signals = {
            row.signal_id
            for row in rows
            if row.signal_id is not None and mark in (row.tag_ids_json or "")
        }
        if len(signals) < 3:
            continue
        await propose_lesson(
            session,
            LessonInput(
                tenant_id=call.tenant_id,
                agent_id=call.agent_id,
                signal_id=call.signal_id,
                kind="pattern",
                source_ref=f"pattern:{tag_id}",
                heading="Patroon",
                body=body,
            ),
        )
        return


def schedule_call_lesson_after_commit(session: AsyncSession, call_id: UUID) -> None:
    import asyncio

    from sqlalchemy import event

    pending: set[str] = session.info.setdefault("call_lesson_scans", set())
    pending.add(str(call_id))
    if session.info.get("call_lesson_hooked"):
        return
    session.info["call_lesson_hooked"] = True
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    def _after(_sync_session) -> None:
        ids = list(session.info.pop("call_lesson_scans", set()) or [])
        session.info["call_lesson_hooked"] = False
        for cid in ids:
            loop.call_soon_threadsafe(lambda cid=cid: asyncio.ensure_future(_enqueue_call_scan(cid)))

    event.listen(session.sync_session, "after_commit", _after, once=True)


async def _enqueue_call_scan(call_id: str) -> None:
    try:
        from app.workers.tasks import _get_arq_pool

        pool = await _get_arq_pool()
        await pool.enqueue_job("scan_call_for_lesson", call_id, _job_id=f"lesson:call:{call_id}")
        return
    except Exception:
        logger.info("call lesson scan runs in-process for %s", call_id)
    from app.db.session import async_session_factory

    async with async_session_factory() as session:
        await scan_call(session, UUID(call_id))
        await session.commit()
