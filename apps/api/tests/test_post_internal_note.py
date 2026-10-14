"""Agents leave team notes via post_internal_note — never as customer drafts."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.tools import execute_tool
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> None:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text


async def _customer_thread(session: AsyncSession) -> Signal:
    from app.models.auth import Tenant

    tenant = (await session.execute(select(Tenant))).scalars().first()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Invoice question",
        status="open",
        contact_email="customer@example.com",
        contact_name="Customer",
    )
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


@pytest.mark.asyncio
async def test_post_internal_note_writes_team_note(
    client: AsyncClient, session_override: AsyncSession
):
    await _login(client)
    thread = await _customer_thread(session_override)
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == thread.tenant_id, Agent.kind == "company")
        )
    ).scalars().first()
    assert agent is not None

    result = await execute_tool(
        session_override,
        thread.tenant_id,
        None,
        "post_internal_note",
        {"body_text": "Checked the mailbox — this is spam from a no-reply sender."},
        signal_id=thread.id,
        agent=agent,
    )
    assert result.get("ok") is True
    assert result.get("kind") == "internal_note"
    assert result.get("message_id")

    note = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.id == UUID(str(result["message_id"])))
        )
    ).scalar_one()
    assert note.kind == "internal_note"
    assert note.direction == "internal"
    assert note.author_agent_id == agent.id
    assert "spam" in (note.body_text or "")

    decisions = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == thread.id)
        )
    ).scalars().all()
    assert decisions == []


@pytest.mark.asyncio
async def test_suggest_thread_reply_rejects_note_only_body(
    client: AsyncClient, session_override: AsyncSession
):
    await _login(client)
    thread = await _customer_thread(session_override)
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == thread.tenant_id, Agent.kind == "company")
        )
    ).scalars().first()
    assert agent is not None

    result = await execute_tool(
        session_override,
        thread.tenant_id,
        None,
        "suggest_thread_reply",
        {
            "body_text": (
                "INTERNAL_NOTE: Geen klantantwoord nodig; dit is een ontvangstbevestiging."
            )
        },
        signal_id=thread.id,
        agent=agent,
    )
    assert result.get("ok") is True
    assert result.get("converted_to_note") is True
    assert result.get("awaiting_approval") is False
    assert "post_internal_note" in str(result.get("message") or "")

    decisions = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == thread.id)
        )
    ).scalars().all()
    assert decisions == []

    notes = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == thread.id,
                SignalMessage.kind == "internal_note",
            )
        )
    ).scalars().all()
    assert len(notes) == 1
    assert "ontvangstbevestiging" in (notes[0].body_text or "")


@pytest.mark.asyncio
async def test_post_internal_note_remaps_ask_session_to_host(
    client: AsyncClient, session_override: AsyncSession
):
    """Passing the Ask-session id still lands the note on the customer thread."""
    await _login(client)
    host = await _customer_thread(session_override)
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == host.tenant_id, Agent.kind == "company")
        )
    ).scalars().first()
    assert agent is not None

    session_signal = Signal(
        tenant_id=host.tenant_id,
        channel="assistant",
        subject=f"Agent session: {host.subject}",
        status="open",
        agent_id=agent.id,
        context_signal_id=host.id,
        session_state="active",
    )
    session_override.add(session_signal)
    await session_override.commit()
    await session_override.refresh(session_signal)

    result = await execute_tool(
        session_override,
        host.tenant_id,
        None,
        "post_internal_note",
        {
            "signal_id": str(session_signal.id),
            "body_text": "Note should land on the host, not the session.",
        },
        # Tools normally receive the host; keep that, and pass session explicitly.
        signal_id=host.id,
        agent=agent,
    )
    assert result.get("ok") is True
    assert result.get("signal_id") == str(host.id)

    host_notes = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == host.id,
                SignalMessage.kind == "internal_note",
            )
        )
    ).scalars().all()
    assert len(host_notes) == 1
    assert "host" in (host_notes[0].body_text or "")

    session_notes = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == session_signal.id,
                SignalMessage.kind == "internal_note",
            )
        )
    ).scalars().all()
    assert session_notes == []


@pytest.mark.asyncio
async def test_post_internal_note_falls_back_when_explicit_id_missing(
    client: AsyncClient, session_override: AsyncSession
):
    """Stale/missing explicit id should fall back to ctx.signal_id (host)."""
    await _login(client)
    host = await _customer_thread(session_override)
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == host.tenant_id, Agent.kind == "company")
        )
    ).scalars().first()
    assert agent is not None

    missing = "00000000-0000-4000-8000-000000000099"
    result = await execute_tool(
        session_override,
        host.tenant_id,
        None,
        "post_internal_note",
        {
            "signal_id": missing,
            "body_text": "Fallback note after a bad explicit id.",
        },
        signal_id=host.id,
        agent=agent,
    )
    assert result.get("ok") is True
    assert result.get("signal_id") == str(host.id)
