"""Operator loops: file-as-tag cards, ticket close, corrections, handoff, cockpit."""

import json
from datetime import datetime, timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant, User
from app.models.learning import Feedback
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalTag
from app.services.cockpit import cockpit_summary
from app.services.interpretation import apply_thread_read
from app.services.ownership import for_you_predicate
from app.services.tickets import file_ticket, settle_ticket_on_close
from app.services.workspace import build_workspace_context
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _signal(session, tenant_id, **kwargs) -> Signal:
    fields = {"channel": "email", "source": "email", "subject": "Loop"}
    fields.update(kwargs)
    signal = Signal(tenant_id=tenant_id, **fields)
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


async def _category(client: AsyncClient, headers, name: str) -> dict:
    created = await client.post("/api/categories", headers=headers, json={"name": name})
    assert created.status_code == 200, created.text
    return created.json()


@pytest.mark.asyncio
async def test_certain_read_without_auto_tag_asks_to_file(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    created = await _category(client, headers, "klacht-loop")
    tag = await session_override.get(SignalTag, UUID(created["id"]))
    tag.ai_auto_tag = False
    session_override.add(tag)
    signal = await _signal(session_override, tenant.id, subject="Certain")
    await session_override.commit()

    await apply_thread_read(
        session_override,
        tenant.id,
        signal.id,
        summary="De klant klaagt over de levering.",
        certainty=95,
        ticket_category=tag.name,
    )
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == signal.id)
        )
    ).scalars().first()
    assert decision is not None
    assert decision.title in (f"Dien in als #{tag.name}", f"File as #{tag.name}")
    options = json.loads(decision.options_json)
    assert options[0]["action_type"] == "file_ticket"
    assert options[0]["payload"]["tag_id"] == str(tag.id)

    quiet = await _signal(session_override, tenant.id, subject="Uncertain")
    await apply_thread_read(
        session_override,
        tenant.id,
        quiet.id,
        summary="Onduidelijk.",
        certainty=10,
        ticket_category=tag.name,
    )
    none = (
        await session_override.execute(
            select(DecisionRequest.id).where(DecisionRequest.signal_id == quiet.id)
        )
    ).first()
    assert none is None


@pytest.mark.asyncio
async def test_closing_conversation_moves_ticket_to_done(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    created = await _category(client, headers, "klaar-loop")
    signal = await _signal(session_override, tenant.id, subject="Close me")
    filed = await file_ticket(
        session_override,
        tenant.id,
        signal_id=signal.id,
        tag_id=UUID(created["id"]),
        actor="operator",
    )
    assert filed["ticket"]["status"] == "open"
    await session_override.refresh(signal)
    signal.status = "closed"
    session_override.add(signal)
    await session_override.commit()

    moved = await settle_ticket_on_close(session_override, signal, actor_type="user", actor_id="test")
    assert moved is True
    await session_override.refresh(signal)
    assert signal.ticket_status == "done"


@pytest.mark.asyncio
async def test_edited_draft_lands_in_the_next_prompt(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    session_override.add(
        Feedback(
            tenant_id=tenant.id,
            subject_type="draft_edit",
            subject_id="draft-1",
            comment="We sturen het pakket morgen.",
            correction_key="reply:support",
            metadata_json=json.dumps({"customer": "Wanneer komt mijn pakket?", "sent": "We sturen het pakket morgen."}),
        )
    )
    await session_override.commit()

    prompt = await build_workspace_context(session_override, tenant.id)
    assert "Recent corrections" in prompt
    assert "We sturen het pakket morgen." in prompt
    assert "Wanneer komt mijn pakket?" in prompt


@pytest.mark.asyncio
async def test_for_you_includes_a_handoff_on_all_people(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    signal = await _signal(
        session_override,
        tenant.id,
        subject="Person please",
        ai_handling="manual",
        ai_handling_reason="handoff_requested",
        status="open",
    )
    match = (
        await session_override.execute(
            select(Signal.id).where(Signal.id == signal.id, for_you_predicate(user.id, set()))
        )
    ).scalar_one_or_none()
    assert match == signal.id


@pytest.mark.asyncio
async def test_closed_conversation_can_be_marked_as_example(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id, subject="Example me", status="closed")
    res = await client.post(
        f"/api/signals/{signal.id}/example",
        headers=headers,
        json={"use_as_example": True},
    )
    assert res.status_code == 200, res.text
    assert res.json()["is_example"] is True
    await session_override.refresh(signal)
    assert signal.is_example is True
    detail = await client.get(f"/api/signals/{signal.id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["thread"]["is_example"] is True


@pytest.mark.asyncio
async def test_cockpit_counts_resolved_and_lists_quiet_threads(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    quiet = await _signal(
        session_override,
        tenant.id,
        subject="Stil",
        status="open",
        contact_name="Stil contact",
        last_message_at=datetime.utcnow() - timedelta(days=4000),
    )
    await _signal(
        session_override,
        tenant.id,
        subject="Afgehandeld",
        status="closed",
        updated_at=datetime.utcnow() - timedelta(days=4),
    )
    summary = await cockpit_summary(session_override, tenant.id)
    assert isinstance(summary["resolved_conversations_week"], int)
    assert summary["resolved_conversations_week"] >= 1
    assert any(row["id"] == str(quiet.id) for row in summary["quiet_threads"])
