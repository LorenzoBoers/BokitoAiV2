"""propose_lesson: one concept, paraphrase, contradiction, promotion."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.models.agent_call import AgentCall
from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage, SignalTag, SignalTagLink
from app.models.workspace import DocChunk, DocSection, DocSectionTagLink, KnowledgeEvidence
from app.services.knowledge_lessons import LessonInput, propose_lesson, scan_call
from app.services.workspace import set_section_status


BODY = (
    "Ship every confirmed order on the same working day and tell the customer "
    "the tracking code before the evening cutoff. Repeat this for every paid "
    "order that left the warehouse after the customer confirmed the address."
)


async def _fake_resolve(*_args, **_kwargs):
    return SimpleNamespace(api_key="", live=False, model_id="test", base_url=None)


async def _fake_embed(*_args, **_kwargs):
    return [1.0, 0.0], 0


def _patch_models(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.model_resolution.resolve_model_call", _fake_resolve)
    monkeypatch.setattr("app.services.embeddings.embed_text_with_usage", _fake_embed)


async def _signal(session, tenant_id, tag_id) -> Signal:
    signal = Signal(tenant_id=tenant_id, channel="email", status="open", subject="Order")
    session.add(signal)
    await session.flush()
    session.add(SignalTagLink(signal_id=signal.id, tag_id=tag_id, tenant_id=tenant_id))
    await session.flush()
    return signal


def _lesson(tenant_id, signal_id, ref: str, heading: str = "Orders") -> LessonInput:
    return LessonInput(
        tenant_id=tenant_id,
        agent_id=None,
        signal_id=signal_id,
        kind="correction",
        source_ref=ref,
        heading=heading,
        body=BODY,
    )


@pytest.mark.asyncio
async def test_one_correction_creates_a_labeled_concept(client, session_override, monkeypatch):
    del client
    _patch_models(monkeypatch)

    async def no_hits(*_args, **_kwargs):
        return []

    monkeypatch.setattr("app.services.knowledge_lessons.hybrid_search", no_hits)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    tag = SignalTag(tenant_id=tenant.id, name=f"orders-{uuid4().hex[:6]}")
    session_override.add(tag)
    await session_override.flush()
    signal = await _signal(session_override, tenant.id, tag.id)

    outcome = await propose_lesson(
        session_override, _lesson(tenant.id, signal.id, f"decision:{uuid4()}")
    )
    await session_override.commit()

    assert outcome.action == "created"
    section = await session_override.get(DocSection, outcome.section_id)
    assert section is not None and section.status == "draft"
    link = (
        await session_override.execute(
            select(DocSectionTagLink).where(DocSectionTagLink.section_id == section.id)
        )
    ).scalar_one()
    assert link.tag_id == tag.id
    chunk = (
        await session_override.execute(select(DocChunk).where(DocChunk.section_id == section.id))
    ).scalar_one()
    assert str(tag.id) in chunk.metadata_json
    evidence = (
        await session_override.execute(
            select(func.count()).select_from(KnowledgeEvidence).where(
                KnowledgeEvidence.section_id == section.id
            )
        )
    ).scalar_one()
    assert evidence == 1


@pytest.mark.asyncio
async def test_paraphrase_keeps_the_section_and_a_repeat_is_one_row(
    client, session_override, monkeypatch
):
    del client
    _patch_models(monkeypatch)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    tag = SignalTag(tenant_id=tenant.id, name=f"orders-{uuid4().hex[:6]}")
    session_override.add(tag)
    await session_override.flush()
    signal = await _signal(session_override, tenant.id, tag.id)

    async def no_hits(*_args, **_kwargs):
        return []

    monkeypatch.setattr("app.services.knowledge_lessons.hybrid_search", no_hits)
    ref = f"decision:{uuid4()}"
    first = await propose_lesson(session_override, _lesson(tenant.id, signal.id, ref))

    async def same_hit(*_args, **_kwargs):
        return [
            {
                "section_id": str(first.section_id),
                "vector": 0.96,
                "title": "Orders",
                "content": BODY,
                "is_lesson": True,
                "score": 0.9,
            }
        ]

    monkeypatch.setattr("app.services.knowledge_lessons.hybrid_search", same_hit)
    other = await _signal(session_override, tenant.id, tag.id)
    second = await propose_lesson(
        session_override, _lesson(tenant.id, other.id, f"decision:{uuid4()}")
    )
    third = await propose_lesson(session_override, _lesson(tenant.id, other.id, ref))
    await session_override.commit()

    assert second.action == "same"
    assert second.section_id == first.section_id
    assert third.action == "same"
    count = (
        await session_override.execute(
            select(func.count()).select_from(KnowledgeEvidence).where(
                KnowledgeEvidence.source_ref == ref
            )
        )
    ).scalar_one()
    assert count == 1
    section = await session_override.get(DocSection, first.section_id)
    assert section.status == "final"


@pytest.mark.asyncio
async def test_contradiction_of_final_opens_a_decision(client, session_override, monkeypatch):
    del client
    _patch_models(monkeypatch)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    tag = SignalTag(tenant_id=tenant.id, name=f"orders-{uuid4().hex[:6]}")
    session_override.add(tag)
    await session_override.flush()
    signal = await _signal(session_override, tenant.id, tag.id)

    async def no_hits(*_args, **_kwargs):
        return []

    monkeypatch.setattr("app.services.knowledge_lessons.hybrid_search", no_hits)
    first = await propose_lesson(
        session_override, _lesson(tenant.id, signal.id, f"decision:{uuid4()}")
    )
    await set_section_status(
        session_override, tenant.id, first.section_id, "final", actor_type="user", commit=False
    )
    before = (await session_override.get(DocSection, first.section_id)).content

    async def near(*_args, **_kwargs):
        return [
            {
                "section_id": str(first.section_id),
                "vector": 0.84,
                "title": "Orders",
                "content": before,
                "is_lesson": True,
                "score": 0.8,
            }
        ]

    async def contradicts(*_args, **_kwargs):
        return "contradicts"

    monkeypatch.setattr("app.services.knowledge_lessons.hybrid_search", near)
    other = await _signal(session_override, tenant.id, tag.id)
    outcome = await propose_lesson(
        session_override,
        _lesson(tenant.id, other.id, f"decision:{uuid4()}", heading="Orders later"),
        judge=contradicts,
    )
    await session_override.commit()

    assert outcome.action == "contradiction"
    section = await session_override.get(DocSection, first.section_id)
    assert section.content == before
    assert section.status == "final"
    decision = await session_override.get(DecisionRequest, outcome.decision_id)
    assert decision is not None
    assert decision.source_type == "knowledge_lesson"


@pytest.mark.asyncio
async def test_short_text_and_same_conversation_do_not_promote(client, session_override, monkeypatch):
    del client
    _patch_models(monkeypatch)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    tag = SignalTag(tenant_id=tenant.id, name=f"orders-{uuid4().hex[:6]}")
    session_override.add(tag)
    await session_override.flush()
    signal = await _signal(session_override, tenant.id, tag.id)

    async def no_hits(*_args, **_kwargs):
        return []

    monkeypatch.setattr("app.services.knowledge_lessons.hybrid_search", no_hits)
    short = _lesson(tenant.id, signal.id, f"decision:{uuid4()}")
    short.body = "too short"
    skipped = await propose_lesson(session_override, short)
    assert skipped.action == "skipped"

    first = await propose_lesson(
        session_override, _lesson(tenant.id, signal.id, f"decision:{uuid4()}")
    )

    async def same_hit(*_args, **_kwargs):
        return [
            {
                "section_id": str(first.section_id),
                "vector": 0.97,
                "title": "Orders",
                "content": BODY,
                "is_lesson": True,
                "score": 0.9,
            }
        ]

    monkeypatch.setattr("app.services.knowledge_lessons.hybrid_search", same_hit)
    again = await propose_lesson(
        session_override, _lesson(tenant.id, signal.id, f"decision:{uuid4()}")
    )
    section = await session_override.get(DocSection, first.section_id)
    assert again.section_id == first.section_id
    assert section.status == "draft"
    assert isinstance(first.section_id, UUID)


@pytest.mark.asyncio
async def test_intuition_gates(client, session_override, monkeypatch):
    del client
    _patch_models(monkeypatch)

    async def no_hits(*_args, **_kwargs):
        return []

    monkeypatch.setattr("app.services.knowledge_lessons.hybrid_search", no_hits)
    from app.models.agent import Agent
    from app.models.signal import SignalMessage
    from app.services.knowledge_lessons import scan_message

    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    tag = SignalTag(tenant_id=tenant.id, name=f"orders-{uuid4().hex[:6]}")
    quiet = Agent(
        tenant_id=tenant.id,
        name="Quiet",
        slug=f"quiet-{uuid4().hex[:6]}",
        settings_json='{"awareness": {"mode": "off"}}',
    )
    session_override.add(tag)
    session_override.add(quiet)
    await session_override.flush()
    signal = await _signal(session_override, tenant.id, tag.id)
    called = {"n": 0}

    async def extract(*_args, **_kwargs):
        called["n"] += 1
        return {"reusable": False, "importance": 2, "heading": "Fact", "body": "Customer calls Tuesday about one invoice only once."}

    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        seq=1,
        kind="agent_message",
        direction="outbound",
        role="assistant",
        author_agent_id=quiet.id,
        body_text="done",
        metadata_json='{"activity": [{"kind": "work"}, {"kind": "work"}]}',
    )
    session_override.add(message)
    await session_override.commit()
    off = await scan_message(session_override, message.id, extract=extract)
    assert off.reason == "awareness_off"
    assert called["n"] == 0

    quiet.settings_json = "{}"
    session_override.add(quiet)
    await session_override.commit()
    once = await scan_message(session_override, message.id, extract=extract)
    assert once.action == "skipped"
    assert once.reason == "not_reusable"
    assert called["n"] == 1


@pytest.mark.asyncio
async def test_spoken_correction_becomes_a_concept(client, session_override, monkeypatch):
    del client
    _patch_models(monkeypatch)

    async def no_hits(*_args, **_kwargs):
        return []

    monkeypatch.setattr("app.services.knowledge_lessons.hybrid_search", no_hits)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User))).scalars().first()
    tag = SignalTag(tenant_id=tenant.id, name=f"orders-{uuid4().hex[:6]}")
    session_override.add(tag)
    await session_override.flush()
    signal = await _signal(session_override, tenant.id, tag.id)
    call = AgentCall(
        tenant_id=tenant.id,
        signal_id=signal.id,
        decision_id=uuid4(),
        user_id=user.id,
        status="ended",
    )
    session_override.add(call)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="system_event",
            direction="internal",
            role="assistant",
            body_text="nee",
            metadata_json=(
                '{"source":"agent_call","agent_call_id":"%s","call_log":{"lines":'
                '[{"role":"user","text":"nee, %s"}]}}' % (call.id, BODY)
            ),
        )
    )
    await session_override.commit()
    outcome = await scan_call(session_override, call.id)
    assert outcome.action == "created"
    evidence = (
        await session_override.execute(
            select(KnowledgeEvidence).where(KnowledgeEvidence.source_ref == f"call:{call.id}")
        )
    ).scalar_one()
    assert evidence.kind == "correction"


@pytest.mark.asyncio
async def test_three_calls_become_one_pattern(client, session_override, monkeypatch):
    del client
    _patch_models(monkeypatch)

    async def no_hits(*_args, **_kwargs):
        return []

    monkeypatch.setattr("app.services.knowledge_lessons.hybrid_search", no_hits)
    from app.models.agent import Agent

    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User))).scalars().first()
    agent = Agent(tenant_id=tenant.id, name="Caller", slug=f"caller-{uuid4().hex[:6]}", settings_json="{}")
    tag = SignalTag(tenant_id=tenant.id, name=f"orders-{uuid4().hex[:6]}")
    session_override.add(agent)
    session_override.add(tag)
    await session_override.flush()
    for _ in range(3):
        signal = await _signal(session_override, tenant.id, tag.id)
        call = AgentCall(
            tenant_id=tenant.id,
            signal_id=signal.id,
            agent_id=agent.id,
            decision_id=uuid4(),
            user_id=user.id,
            status="ended",
        )
        session_override.add(call)
        await session_override.flush()
        session_override.add(
            SignalMessage(
                signal_id=signal.id,
                tenant_id=tenant.id,
                kind="system_event",
                direction="internal",
                role="assistant",
                body_text="call",
                metadata_json=(
                    '{"source":"agent_call","agent_call_id":"%s","call_log":{"lines":'
                    '[{"role":"user","text":"%s"}]}}' % (call.id, BODY)
                ),
            )
        )
        await session_override.commit()
        outcome = await scan_call(session_override, call.id)
        assert outcome.action in {"created", "same"}
    pattern = (
        await session_override.execute(
            select(func.count())
            .select_from(KnowledgeEvidence)
            .where(KnowledgeEvidence.source_ref == f"pattern:{tag.id}")
        )
    ).scalar_one()
    assert pattern == 1
