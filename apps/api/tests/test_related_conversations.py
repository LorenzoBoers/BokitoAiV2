"""Conversations with the same person see each other across channels."""

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.services.inbound_agent import create_reply_suggestion
from app.services.related_conversations import recent_contact_context, related_conversations
from app.services.signal_threads import DEFER_SIBLING_THREAD
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _assistant(session, tenant: Tenant) -> Agent:
    return (
        (
            await session.execute(
                select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
            )
        )
        .scalars()
        .first()
    )


async def _thread(
    session,
    tenant: Tenant,
    *,
    channel: str,
    email: str,
    subject: str,
    body: str,
    direction: str = "inbound",
    minutes_ago: int,
) -> Signal:
    at = datetime.utcnow() - timedelta(minutes=minutes_ago)
    signal = Signal(
        tenant_id=tenant.id,
        channel=channel,
        source="mock",
        subject=subject,
        contact_name="Sanne de Vries",
        contact_email=email,
        status="open",
        has_unread=direction == "inbound",
        last_message_at=at,
        created_at=at,
    )
    session.add(signal)
    await session.flush()
    session.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction=direction,
            role="user",
            body_text=body,
            body_preview=body,
            created_at=at,
        )
    )
    await session.commit()
    await session.refresh(signal)
    return signal


@pytest.mark.asyncio
async def test_related_conversations_lists_other_channels(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = await _tenant(session_override)
    email = "sanne.related@klant.nl"
    mail = await _thread(
        session_override,
        tenant,
        channel="email",
        email=email,
        subject="Vraag over factuur",
        body="Klopt het bedrag op de factuur?",
        minutes_ago=120,
    )
    chat = await _thread(
        session_override,
        tenant,
        channel="whatsapp",
        email=email,
        subject="",
        body="Ik heb net gebeld, is de factuur al aangepast?",
        minutes_ago=10,
    )
    # A colleague's internal room with the same address must never show up.
    await _thread(
        session_override,
        tenant,
        channel="internal",
        email=email,
        subject="Team",
        body="Interne afstemming",
        minutes_ago=1,
    )

    rows = await related_conversations(session_override, mail)
    assert [row["id"] for row in rows] == [str(chat.id)]
    assert rows[0]["channel"] == "whatsapp"
    assert rows[0]["last_message_direction"] == "inbound"
    assert rows[0]["last_message_preview"].startswith("Ik heb net gebeld")
    assert rows[0]["has_open_proposal"] is False

    # Thread detail carries the same rows.
    detail = await client.get(f"/api/signals/{mail.id}", headers=headers)
    assert detail.status_code == 200
    related = detail.json()["related_conversations"]
    assert [row["id"] for row in related] == [str(chat.id)]

    # Prompt block mentions the other channel and who spoke last.
    context = await recent_contact_context(session_override, mail)
    assert "whatsapp" in context
    assert "customer wrote" in context
    assert "Ik heb net gebeld" in context


@pytest.mark.asyncio
async def test_related_conversations_empty_without_match(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = await _tenant(session_override)
    lonely = await _thread(
        session_override,
        tenant,
        channel="email",
        email="alone.related@klant.nl",
        subject="Solo",
        body="Alleen dit gesprek",
        minutes_ago=5,
    )
    assert await related_conversations(session_override, lonely) == []
    assert await recent_contact_context(session_override, lonely) == ""


@pytest.mark.asyncio
async def test_new_proposal_parks_sibling_thread_proposal(client: AsyncClient, session_override):
    """One live AI proposal per person: a newer thread's card sets the older aside."""
    await _auth_headers(client)
    tenant = await _tenant(session_override)
    agent = await _assistant(session_override, tenant)
    email = "sanne.sibling@klant.nl"
    older = await _thread(
        session_override,
        tenant,
        channel="email",
        email=email,
        subject="Levertijd",
        body="Wanneer wordt het geleverd?",
        minutes_ago=60,
    )
    newer = await _thread(
        session_override,
        tenant,
        channel="whatsapp",
        email=email,
        subject="",
        body="Nog even over de levertijd",
        minutes_ago=2,
    )

    await create_reply_suggestion(
        session_override, tenant.id, older, agent, reply_text="Volgende week.", is_mock=True
    )
    await session_override.commit()
    await create_reply_suggestion(
        session_override, tenant.id, newer, agent, reply_text="Volgende week, ook hier.", is_mock=True
    )
    await session_override.commit()

    older_card = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == older.id)
        )
    ).scalar_one()
    newer_card = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == newer.id)
        )
    ).scalar_one()
    assert older_card.status == "deferred"
    assert older_card.chosen_option_id == DEFER_SIBLING_THREAD
    assert newer_card.status == "awaiting_human"

    rows = await related_conversations(session_override, older)
    assert rows[0]["id"] == str(newer.id)
    assert rows[0]["has_open_proposal"] is True
