"""Already handled outside Bokito: endpoint, needs-reply, proposal deferral, agent tool."""

import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.inbound_agent import create_reply_suggestion
from app.services.signal_threads import DEFER_HANDLED_EXTERNALLY, handled_externally_text
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


async def _customer_thread(session, tenant: Tenant, *, subject: str) -> Signal:
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject=subject,
        contact_name="Harold Jansen",
        contact_email=f"harold-{subject.lower().replace(' ', '-')}@klant.nl",
        status="open",
        has_unread=True,
        last_message_at=datetime.utcnow() - timedelta(minutes=5),
    )
    session.add(signal)
    await session.flush()
    session.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="inbound",
            role="user",
            body_text="Kunnen jullie de levering verzetten?",
            body_preview="Kunnen jullie de levering verzetten?",
            created_at=datetime.utcnow() - timedelta(minutes=5),
        )
    )
    await session.commit()
    await session.refresh(signal)
    return signal


def test_handled_externally_text_languages():
    assert handled_externally_text("phone", "Lorenzo", language="nl") == (
        "Afgehandeld via telefoon door Lorenzo"
    )
    assert handled_externally_text("phone", "Lorenzo", language="en") == (
        "Handled by phone by Lorenzo"
    )
    # Unknown channel falls back to "other"; empty name falls back to the team.
    assert handled_externally_text("fax", "", language="en") == "Handled outside Bokito by team"


@pytest.mark.asyncio
async def test_handled_externally_logs_system_line_and_parks_proposal(
    client: AsyncClient, session_override
):
    headers = await _auth_headers(client)
    tenant = await _tenant(session_override)
    agent = await _assistant(session_override, tenant)
    signal = await _customer_thread(session_override, tenant, subject="Levering verzetten")

    await create_reply_suggestion(
        session_override,
        tenant.id,
        signal,
        agent,
        reply_text="Natuurlijk, welke dag past u?",
        is_mock=True,
    )
    await session_override.commit()

    # Before: the thread wants a reply.
    before = await client.get(
        "/api/signals?view=all_open&folder=inbox&needs_reply=1", headers=headers
    )
    assert str(signal.id) in {row["id"] for row in before.json()["items"]}

    res = await client.post(
        f"/api/signals/{signal.id}/handled-externally",
        json={"channel": "phone", "note": "Levering naar donderdag", "language": "nl"},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    message = res.json()
    assert message["kind"] == "system_event"
    assert message["direction"] == "outbound"
    assert message["body_text"].startswith("Afgehandeld via telefoon door ")
    assert "Levering naar donderdag" in message["body_text"]
    assert message["payload"]["handled_externally"]["channel"] == "phone"
    assert message["payload"]["handled_externally"]["note"] == "Levering naar donderdag"
    assert message["payload"]["handled_externally"]["by_name"]

    await session_override.refresh(signal)
    assert signal.has_unread is False
    assert signal.status == "open"  # close not requested

    # The open proposal is set aside with the handled_externally reason.
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == signal.id)
        )
    ).scalar_one()
    assert decision.status == "deferred"
    assert decision.chosen_option_id == DEFER_HANDLED_EXTERNALLY

    # After: counts as the team's reply.
    after = await client.get(
        "/api/signals?view=all_open&folder=inbox&needs_reply=1", headers=headers
    )
    assert str(signal.id) not in {row["id"] for row in after.json()["items"]}

    # The list preview reflects the system line and its direction.
    listing = await client.get("/api/signals?view=all_open&folder=inbox", headers=headers)
    row = next(item for item in listing.json()["items"] if item["id"] == str(signal.id))
    assert row["last_message_direction"] == "outbound"

    events = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == signal.id, SignalEvent.event_type == "handled_externally"
            )
        )
    ).scalars().all()
    assert len(events) == 1
    assert json.loads(events[0].payload_json)["deferred_suggestions"] == 1

    # The thread detail renders the deferred card with its reason.
    detail = await client.get(f"/api/signals/{signal.id}", headers=headers)
    cards = [m for m in detail.json()["messages"] if m["kind"] == "decision_request"]
    assert cards and cards[0]["payload"]["decision"]["resolution_reason"] == DEFER_HANDLED_EXTERNALLY


@pytest.mark.asyncio
async def test_handled_externally_can_close(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = await _tenant(session_override)
    signal = await _customer_thread(session_override, tenant, subject="Offerte vraag")

    res = await client.post(
        f"/api/signals/{signal.id}/handled-externally",
        json={"channel": "whatsapp", "close": True, "language": "en"},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["body_text"].startswith("Handled via WhatsApp by ")
    await session_override.refresh(signal)
    assert signal.status == "closed"
    assert signal.has_unread is False


@pytest.mark.asyncio
async def test_handled_externally_rejects_unknown_channel(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = await _tenant(session_override)
    signal = await _customer_thread(session_override, tenant, subject="Fax vraag")
    res = await client.post(
        f"/api/signals/{signal.id}/handled-externally",
        json={"channel": "fax"},
        headers=headers,
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_mark_handled_externally_tool(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = await _tenant(session_override)
    from app.tools import execute_tool

    user = (
        (await session_override.execute(select(User).where(User.email == TEST_EMAIL)))
        .scalars()
        .first()
    )
    signal = await _customer_thread(session_override, tenant, subject="Tool vraag")

    result = await execute_tool(
        session_override,
        tenant.id,
        user.id if user else None,
        "mark_handled_externally",
        {"signal_id": str(signal.id), "channel": "phone", "note": "Besproken", "close": True},
        approved=True,
    )
    assert result.get("ok") is True, result
    assert result.get("channel") == "phone"
    assert result.get("closed") is True

    await session_override.refresh(signal)
    assert signal.status == "closed"
    assert signal.has_unread is False
    line = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id, SignalMessage.kind == "system_event"
            )
        )
    ).scalar_one()
    assert line.direction == "outbound"
    assert json.loads(line.metadata_json)["handled_externally"] is True

    bad = await execute_tool(
        session_override,
        tenant.id,
        user.id if user else None,
        "mark_handled_externally",
        {"signal_id": str(signal.id), "channel": "pigeon"},
        approved=True,
    )
    assert "error" in bad
