"""Candidate pool for hybrid search: scope in SQL, old matches kept, labels boost."""

from __future__ import annotations

import json
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.time import utcnow
from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import SignalTag
from app.models.workspace import DocChunk, DocSection, KnowledgeEvidence, WorkspaceDoc
from app.services.workspace import hybrid_search, set_section_tags


async def _fake_resolve(*_args, **_kwargs):
    return SimpleNamespace(api_key="", live=False, model_id="test", base_url=None)


async def _fake_embed(*_args, **_kwargs):
    return [1.0, 0.0], 0


async def _no_teams(*_args, **_kwargs):
    return set()


def _patch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.model_resolution.resolve_model_call", _fake_resolve)
    monkeypatch.setattr("app.services.embeddings.embed_text_with_usage", _fake_embed)
    monkeypatch.setattr("app.services.teams.agent_team_ids", _no_teams)


def _doc(tenant_id, *, agent_id=None, path: str) -> WorkspaceDoc:
    return WorkspaceDoc(
        tenant_id=tenant_id,
        path=path,
        title=path,
        kind="doc",
        agent_id=agent_id,
        content="body",
    )


def _section(tenant_id, doc_id, heading: str) -> DocSection:
    return DocSection(
        tenant_id=tenant_id,
        doc_id=doc_id,
        anchor=heading.lower() or "preamble",
        heading=heading,
        content="body " * 30,
        status="draft",
    )


@pytest.mark.asyncio
async def test_old_best_match_survives_a_large_pool(client, session_override, monkeypatch):
    del client
    _patch(monkeypatch)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    mine = Agent(tenant_id=tenant.id, name="Mine", slug=f"mine-{uuid4().hex[:8]}")
    other = Agent(tenant_id=tenant.id, name="Other", slug=f"other-{uuid4().hex[:8]}")
    session_override.add(mine)
    session_override.add(other)
    await session_override.flush()

    home = _doc(tenant.id, path=f"docs/pool-{uuid4().hex[:6]}.md")
    foreign = _doc(tenant.id, agent_id=other.id, path=f"docs/foreign-{uuid4().hex[:6]}.md")
    session_override.add(home)
    session_override.add(foreign)
    await session_override.flush()

    now = utcnow()
    best = DocChunk(
        tenant_id=tenant.id,
        doc_id=home.id,
        source_type="workspace_doc",
        source_id=home.path,
        title="Refund policy",
        content="Customers can request a refund within thirty days.",
        embedding_json=json.dumps([1.0, 0.0]),
        metadata_json="{}",
        created_at=now - timedelta(days=400),
    )
    session_override.add(best)
    for index in range(249):
        session_override.add(
            DocChunk(
                tenant_id=tenant.id,
                doc_id=home.id,
                source_type="workspace_doc",
                source_id=home.path,
                title=f"Noise {index}",
                content="unrelated warehouse inventory count",
                embedding_json=json.dumps([0.0, 1.0]),
                metadata_json="{}",
                created_at=now - timedelta(minutes=index),
            )
        )
    stolen = DocChunk(
        tenant_id=tenant.id,
        doc_id=foreign.id,
        source_type="workspace_doc",
        source_id=foreign.path,
        title="Refund policy",
        content="Customers can request a refund within thirty days.",
        embedding_json=json.dumps([1.0, 0.0]),
        metadata_json="{}",
        created_at=now,
    )
    session_override.add(stolen)
    await session_override.commit()

    hits = await hybrid_search(
        session_override,
        tenant.id,
        "refund policy days",
        top_k=5,
        agent_id=mine.id,
    )
    assert hits
    assert hits[0]["title"] == "Refund policy"
    assert hits[0]["doc_id"] == str(home.id)
    assert all(hit["doc_id"] != str(foreign.id) for hit in hits)
    assert "vector" in hits[0] and "keyword" in hits[0]


@pytest.mark.asyncio
async def test_shared_label_boosts_without_hiding_a_better_page(client, session_override, monkeypatch):
    del client
    _patch(monkeypatch)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    agent = Agent(tenant_id=tenant.id, name="Label", slug=f"label-{uuid4().hex[:8]}")
    session_override.add(agent)
    tag = SignalTag(tenant_id=tenant.id, name=f"orders-{uuid4().hex[:6]}")
    session_override.add(tag)
    lesson_doc = _doc(tenant.id, path=f"docs/lessen-{uuid4().hex[:6]}.md")
    plain = _doc(tenant.id, path=f"docs/plain-{uuid4().hex[:6]}.md")
    session_override.add(lesson_doc)
    session_override.add(plain)
    await session_override.flush()
    lesson = _section(tenant.id, lesson_doc.id, "Orders")
    plain_section = _section(tenant.id, plain.id, "Handbook")
    session_override.add(lesson)
    session_override.add(plain_section)
    await session_override.flush()

    lesson_chunk = DocChunk(
        tenant_id=tenant.id,
        doc_id=lesson_doc.id,
        section_id=lesson.id,
        source_type="workspace_doc",
        source_id=lesson_doc.path,
        title="Orders",
        content="ship the order the same day",
        embedding_json=json.dumps([1.0, 0.0]),
        metadata_json=json.dumps({"section_status": "draft", "is_lesson": True, "tag_ids": []}),
        created_at=utcnow(),
    )
    better = DocChunk(
        tenant_id=tenant.id,
        doc_id=plain.id,
        section_id=plain_section.id,
        source_type="workspace_doc",
        source_id=plain.path,
        title="Handbook",
        content="ship the order the same day and confirm the customer",
        embedding_json=json.dumps([1.0, 0.0]),
        metadata_json=json.dumps({"section_status": "final", "is_lesson": False, "tag_ids": []}),
        created_at=utcnow(),
    )
    session_override.add(lesson_chunk)
    session_override.add(better)
    session_override.add(
        KnowledgeEvidence(
            tenant_id=tenant.id,
            section_id=lesson.id,
            kind="intuition",
            source_ref=f"message:{uuid4()}",
            excerpt="ship the order the same day",
        )
    )
    await session_override.commit()
    before = lesson_chunk.embedding_json

    await set_section_tags(session_override, tenant.id, lesson.id, [tag.id])
    await session_override.commit()
    await session_override.refresh(lesson_chunk)
    assert lesson_chunk.embedding_json == before
    meta = json.loads(lesson_chunk.metadata_json)
    assert meta["tag_ids"] == [str(tag.id)]

    hits = await hybrid_search(
        session_override,
        tenant.id,
        "ship the order",
        top_k=5,
        agent_id=agent.id,
        tag_ids=[tag.id],
    )
    ids = [hit["section_id"] for hit in hits]
    assert str(lesson.id) in ids
    assert str(plain_section.id) in ids
    # Equal vectors: the shared label puts the lesson first even after the
    # unconfirmed penalty. The unlabeled page with the longer keyword hit
    # stays in the top five.
    assert hits[0]["section_id"] == str(lesson.id)
    assert hits[0]["label_match"] is True
    assert hits[0]["unconfirmed"] is True
