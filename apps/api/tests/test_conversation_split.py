"""A second intent in a conversation is split into its own linked conversation."""

import json
import os
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.case import Case, CaseType
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.cases import ensure_platform_case_types
from app.services.conversation_split import SPLIT_DECISION_SOURCE, split_or_propose
from app.services.notifications import resolve_decision
from app.services.signals import _open_thread_for_inbound
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _type(session, tenant_id, slug: str) -> CaseType:
    await ensure_platform_case_types(session, tenant_id)
    return (
        await session.execute(
            select(CaseType).where(CaseType.tenant_id == tenant_id, CaseType.slug == slug)
        )
    ).scalar_one()


async def _thread(session, tenant_id, *, ai_handling: str | None = None):
    """An email thread with two customer messages and a reply in between."""
    signal = Signal(
        tenant_id=tenant_id,
        channel="email",
        source="email",
        subject="Order 42",
        contact_email="ann@example.com",
        external_id="conv-split-1",
        ai_handling=ai_handling,
    )
    session.add(signal)
    await session.flush()
    start = datetime.utcnow() - timedelta(hours=2)
    rows = []
    for offset, (direction, body) in enumerate(
        [("inbound", "Where is my order?"), ("outbound", "On its way."), ("inbound", "Also, my invoice is wrong.")]
    ):
        row = SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant_id,
            direction=direction,
            kind="user_message" if direction == "inbound" else "agent_message",
            body_text=body,
            subject="Order 42",
            created_at=start + timedelta(minutes=offset),
        )
        session.add(row)
        rows.append(row)
    await session.commit()
    await session.refresh(signal)
    return signal, rows


@pytest.mark.asyncio
async def test_operator_split_moves_messages_and_routes_replies(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    complaint = await _type(session_override, tenant.id, "complaint")
    signal, rows = await _thread(session_override, tenant.id)

    res = await client.post(
        f"/api/signals/{signal.id}/split",
        headers=headers,
        json={"from_message_id": str(rows[2].id), "category_id": str(complaint.id)},
    )
    assert res.status_code == 200, res.text
    child_id = UUID(res.json()["signal_id"])
    parent_id = signal.id

    session_override.expunge_all()
    child = await session_override.get(Signal, child_id)
    parent = await session_override.get(Signal, parent_id)
    assert child.parent_signal_id == parent.id
    assert parent.superseded_by_id == child.id
    assert child.external_id == parent.external_id
    assert child.contact_email == "ann@example.com"

    moved = (
        await session_override.execute(
            select(SignalMessage.body_text).where(SignalMessage.signal_id == child.id)
        )
    ).scalars().all()
    assert moved == ["Also, my invoice is wrong."]
    kept = (
        await session_override.execute(
            select(SignalMessage.id).where(SignalMessage.signal_id == parent.id)
        )
    ).scalars().all()
    assert len(kept) == 2

    case = (await session_override.execute(select(Case).where(Case.signal_id == child.id))).scalar_one()
    assert case.case_type_id == complaint.id
    events = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id.in_([parent.id, child.id]), SignalEvent.event_type == "split"
            )
        )
    ).scalars().all()
    directions = {json.loads(e.payload_json)["direction"] for e in events}
    assert directions == {"in", "out"}

    routed = await _open_thread_for_inbound(
        session_override,
        tenant.id,
        channel="email",
        contact_id=None,
        contact_email="ann@example.com",
        subject="Re: Order 42",
        external_id="conv-split-1",
    )
    assert routed is not None and routed.id == child.id

    detail = await client.get(f"/api/signals/{child.id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["thread"]["parent_signal_id"] == str(parent.id)


@pytest.mark.asyncio
async def test_split_needs_an_earlier_message(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    signal, rows = await _thread(session_override, tenant.id)
    res = await client.post(
        f"/api/signals/{signal.id}/split", headers=headers, json={"from_message_id": str(rows[0].id)}
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_triage_proposes_a_split_for_a_new_category(client: AsyncClient, session_override):
    _ = client
    from app.services.cases import create_case
    from app.services.interpretation import _create_cases_from_triage

    tenant = await _tenant(session_override)
    bug = await _type(session_override, tenant.id, "bug_report")
    complaint = await _type(session_override, tenant.id, "complaint")
    signal, _rows = await _thread(session_override, tenant.id, ai_handling="assisted")
    signal_id = signal.id
    await create_case(
        session_override, tenant.id, case_type_id=bug.id, signal_id=signal_id, actor="operator"
    )
    enabled = [bug, complaint]

    await _create_cases_from_triage(
        session_override, tenant.id, signal_id=signal_id, slugs=[complaint.slug],
        enabled_types=enabled, summary="Invoice is wrong", certainty=40, certain=False,
    )
    await _create_cases_from_triage(
        session_override, tenant.id, signal_id=signal_id, slugs=[bug.slug, complaint.slug],
        enabled_types=enabled, summary="Invoice is wrong", certainty=90, certain=True,
    )
    cards = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.source_type == SPLIT_DECISION_SOURCE)
        )
    ).scalars().all()
    assert cards == []

    await _create_cases_from_triage(
        session_override, tenant.id, signal_id=signal_id, slugs=[complaint.slug],
        enabled_types=enabled, summary="Invoice is wrong", certainty=90, certain=True,
    )
    card = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.source_type == SPLIT_DECISION_SOURCE)
        )
    ).scalar_one()
    assert card.signal_id == signal_id
    assert complaint.name in card.title


@pytest.mark.asyncio
async def test_ai_split_follows_ai_handling(client: AsyncClient, session_override, monkeypatch):
    _ = client
    tenant = await _tenant(session_override)
    complaint = await _type(session_override, tenant.id, "complaint")

    manual, _rows = await _thread(session_override, tenant.id, ai_handling="manual")
    out = await split_or_propose(session_override, tenant.id, manual, case_type=complaint)
    assert out["status"] == "manual"

    assisted, _rows = await _thread(session_override, tenant.id, ai_handling="assisted")
    assisted_id = assisted.id
    out = await split_or_propose(session_override, tenant.id, assisted, case_type=complaint)
    assert out["status"] == "proposed"
    again = await split_or_propose(session_override, tenant.id, assisted, case_type=complaint)
    assert again["status"] == "pending"
    decision_id = UUID(out["decision_id"])
    await resolve_decision(session_override, tenant.id, decision_id, "split", "approved")
    session_override.expunge_all()
    parent = await session_override.get(Signal, assisted_id)
    assert parent.superseded_by_id is not None
    card = await session_override.get(DecisionRequest, decision_id)
    assert card.signal_id == assisted_id
    assert card.source_type == SPLIT_DECISION_SOURCE

    async def _autonomous(*_args, **_kwargs):
        return SimpleNamespace(effective="autonomous")

    monkeypatch.setattr("app.services.ai_handling.resolve_for_signal", _autonomous)
    auto, _rows = await _thread(session_override, tenant.id)
    auto_id = auto.id
    out = await split_or_propose(session_override, tenant.id, auto, case_type=complaint)
    assert out["status"] == "split"
    session_override.expunge_all()
    assert (await session_override.get(Signal, auto_id)).superseded_by_id is not None
