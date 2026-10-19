"""Inline sessions close themselves — no wrap-up card, no teammate action."""

from datetime import datetime, timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _customer_thread(session: AsyncSession) -> Signal:
    from app.models.auth import Tenant

    tenant = (await session.execute(select(Tenant))).scalars().first()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Invoice question",
        contact_email="klant@example.com",
        contact_name="Klant",
    )
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


async def _started_session(
    client: AsyncClient, session: AsyncSession, headers: dict, thread: Signal
) -> tuple[Signal, Agent]:
    """Start a session on the thread and exchange one turn (mock LLM)."""
    r = await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    assert r.status_code == 200, r.text
    session_id = UUID(r.json()["id"])
    r = await client.post(
        f"/api/signals/conversations/{session_id}/messages",
        headers=headers,
        json={"content": "Kun je deze klant helpen?"},
    )
    assert r.status_code == 200, r.text
    conversation = (
        await session.execute(select(Signal).where(Signal.id == session_id))
    ).scalar_one()
    agent = (
        await session.execute(select(Agent).where(Agent.id == conversation.agent_id))
    ).scalar_one()
    return conversation, agent


async def _propose(session: AsyncSession, thread: Signal, agent: Agent, **kwargs) -> dict:
    from app.tools import execute_tool

    return await execute_tool(
        session,
        thread.tenant_id,
        None,
        "propose_session_checkout",
        {"summary": "Factuur gecrediteerd en klant geinformeerd.", **kwargs},
        signal_id=thread.id,
        agent=agent,
    )


@pytest.mark.asyncio
async def test_propose_checkout_closes_the_session(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)
    conversation, agent = await _started_session(client, session_override, headers, thread)

    result = await _propose(session_override, thread, agent)
    assert result.get("ok") is True, result
    assert result["session_id"] == str(conversation.id)
    assert result["thread_id"] == str(thread.id)
    assert result["status"] == "closed"
    assert "decision_request_id" not in result


@pytest.mark.asyncio
async def test_inline_session_bypasses_channel_access_on_host(
    client: AsyncClient, session_override: AsyncSession
):
    """Invited session tools may mutate the host even when the agent lacks channel Access."""
    import json

    from app.models.auth import User
    from app.models.channel import ChannelAccount
    from app.services.channel_access import set_account_access
    from app.tools import execute_tool

    headers = await _login(client)
    tenant_id = (
        await session_override.execute(select(Agent).where(Agent.kind == "company"))
    ).scalars().first().tenant_id
    owner = (
        await session_override.execute(select(User).where(User.email == TEST_EMAIL))
    ).scalar_one()
    account = ChannelAccount(
        tenant_id=tenant_id,
        channel="email",
        provider="smtp_imap",
        address="restricted@bokito.ai",
        credentials_json=json.dumps({"access_token": "tok"}),
    )
    session_override.add(account)
    await session_override.commit()
    await session_override.refresh(account)
    # Restrict to the human owner only — no agents on the Access list.
    await set_account_access(
        session_override,
        account,
        [{"kind": "user", "id": str(owner.id), "level": "handle"}],
    )
    await session_override.commit()

    thread = Signal(
        tenant_id=tenant_id,
        channel="email",
        subject="Restricted invoice",
        contact_email="vendor@example.com",
        channel_account_id=account.id,
    )
    session_override.add(thread)
    await session_override.commit()
    await session_override.refresh(thread)

    conversation, agent = await _started_session(
        client, session_override, headers, thread
    )

    # Without a session this agent must still be denied.
    other = Signal(
        tenant_id=tenant_id,
        channel="email",
        subject="Other restricted mail",
        channel_account_id=account.id,
    )
    session_override.add(other)
    await session_override.commit()
    await session_override.refresh(other)
    denied = await execute_tool(
        session_override,
        tenant_id,
        None,
        "note_no_reply",
        {"summary": "Automated notice", "signal_id": str(other.id)},
        signal_id=other.id,
        agent=agent,
    )
    assert denied.get("reason") == "channel_access", denied

    allowed = await execute_tool(
        session_override,
        tenant_id,
        None,
        "note_no_reply",
        {"summary": "Automated notice", "signal_id": str(thread.id)},
        signal_id=thread.id,
        agent=agent,
    )
    assert allowed.get("error") is None or allowed.get("ok") or allowed.get(
        "awaiting_approval"
    ), allowed

    result = await _propose(session_override, thread, agent)
    assert result.get("ok") is True, result
    assert result["session_id"] == str(conversation.id)

    cards = (
        await session_override.execute(
            select(DecisionRequest).where(
                DecisionRequest.signal_id == thread.id,
                DecisionRequest.source_type == "agent_session",
            )
        )
    ).scalars().all()
    assert cards == []

    await session_override.refresh(conversation)
    assert conversation.session_state == "closed"
    assert conversation.session_closed_at is not None
    import json

    outcome = json.loads(conversation.session_outcome_json or "{}")
    assert outcome["summary"].startswith("Factuur")

    detail = (await client.get(f"/api/signals/{thread.id}", headers=headers)).json()
    assert detail["sessions"][0]["state"] == "closed"
    assert any(e["event_type"] == "agent_session_closed" for e in detail["events"])


@pytest.mark.asyncio
async def test_starting_a_session_closes_another_operators_session(
    client: AsyncClient, session_override: AsyncSession
):
    """One meta per thread: a second operator inherits, never duplicates."""
    headers = await _login(client)
    thread = await _customer_thread(session_override)

    from app.models.auth import Membership, User
    from app.services.agent_sessions import start_session
    from app.services.auth import hash_password

    colleague = User(
        email="collega@test.local",
        password_hash=hash_password(TEST_PASSWORD),
        display_name="Collega",
        email_verified=True,
    )
    session_override.add(colleague)
    await session_override.commit()
    await session_override.refresh(colleague)
    session_override.add(
        Membership(tenant_id=thread.tenant_id, user_id=colleague.id, role="member")
    )
    await session_override.commit()

    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == thread.tenant_id, Agent.kind == "company")
        )
    ).scalars().first()
    theirs = await start_session(
        session_override, thread.tenant_id, colleague, thread.id, agent
    )

    mine = (
        await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    ).json()
    assert mine["id"] != theirs["id"]

    previous = (
        await session_override.execute(select(Signal).where(Signal.id == UUID(theirs["id"])))
    ).scalar_one()
    assert previous.session_state == "closed"

    detail = (await client.get(f"/api/signals/{thread.id}", headers=headers)).json()
    active = [s for s in detail["sessions"] if s["state"] == "active"]
    assert len(active) == 1 and active[0]["id"] == mine["id"]


@pytest.mark.asyncio
async def test_idle_summary_skips_error_agent_bubbles(
    client: AsyncClient, session_override: AsyncSession
):
    from app.models.auth import Tenant
    from app.services.agent_sessions import _idle_summary

    del client  # seeds the test tenant via the client fixture
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    conversation = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="agent_session",
        subject="Session",
        session_state="active",
    )
    session_override.add(conversation)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=conversation.id,
            tenant_id=tenant.id,
            kind="agent_message",
            role="assistant",
            direction="outbound",
            body_text="Factuur is gecorrigeerd.",
        )
    )
    session_override.add(
        SignalMessage(
            signal_id=conversation.id,
            tenant_id=tenant.id,
            kind="agent_message",
            role="assistant",
            direction="outbound",
            body_text=(
                "The assistant encountered an error while generating a reply. "
                "Please try again in a moment."
            ),
            metadata_json='{"error": true}',
        )
    )
    await session_override.commit()

    summary = await _idle_summary(session_override, conversation)
    assert "encountered an error" not in summary.lower()
    assert "Factuur is gecorrigeerd" in summary


@pytest.mark.asyncio
async def test_idle_session_closes_without_a_card(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)
    conversation, _ = await _started_session(client, session_override, headers, thread)

    from app.services.agent_sessions import nudge_idle_sessions

    stale = datetime.utcnow() - timedelta(minutes=30)
    for message in (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == conversation.id)
        )
    ).scalars().all():
        message.created_at = stale
        session_override.add(message)
    conversation.updated_at = stale
    session_override.add(conversation)
    await session_override.commit()

    out = await nudge_idle_sessions(session_override, idle_seconds=300)
    assert out["closed"] == 1

    cards = (
        await session_override.execute(
            select(DecisionRequest).where(
                DecisionRequest.signal_id == thread.id,
                DecisionRequest.source_type == "agent_session",
            )
        )
    ).scalars().all()
    assert cards == []

    await session_override.refresh(conversation)
    assert conversation.session_state == "closed"
    assert conversation.session_closed_at is not None

    again = await nudge_idle_sessions(session_override, idle_seconds=300)
    assert again["closed"] == 0


@pytest.mark.asyncio
async def test_empty_idle_session_is_discarded(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)
    started = (
        await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    ).json()
    conversation = (
        await session_override.execute(select(Signal).where(Signal.id == UUID(started["id"])))
    ).scalar_one()
    conversation.updated_at = datetime.utcnow() - timedelta(minutes=30)
    session_override.add(conversation)
    await session_override.commit()

    from app.services.agent_sessions import nudge_idle_sessions

    out = await nudge_idle_sessions(session_override, idle_seconds=300)
    assert out["closed"] == 1

    gone = (
        await session_override.execute(select(Signal).where(Signal.id == conversation.id))
    ).scalar_one_or_none()
    assert gone is None or gone.deleted_at is not None


@pytest.mark.asyncio
async def test_session_rejected_on_internal_thread(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    from app.models.auth import Tenant

    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    thread = Signal(
        tenant_id=tenant.id,
        channel="internal",
        subject="Team chat",
    )
    session_override.add(thread)
    await session_override.commit()
    await session_override.refresh(thread)

    r = await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    assert r.status_code == 400
