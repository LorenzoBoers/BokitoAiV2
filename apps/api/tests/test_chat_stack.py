"""Chat stack: pinned conversations plus followed ones, with live agents."""

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _thread(client: AsyncClient, headers: dict[str, str], subject: str) -> str:
    res = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": subject,
            "body_text": f"Body of {subject}",
            "contact_email": "c@test.com",
        },
    )
    assert res.status_code == 200
    return res.json()["id"]


@pytest.mark.asyncio
async def test_stack_pinned_first_then_following(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    first = await _thread(client, headers, "First pinned")
    second = await _thread(client, headers, "Second pinned")
    followed = await _thread(client, headers, "Followed")

    assert (await client.post(f"/api/signals/{first}/pin", headers=headers)).status_code == 200
    assert (await client.post(f"/api/signals/{second}/pin", headers=headers)).status_code == 200

    res = await client.get(
        f"/api/signals/stack?follow={followed},{first},not-a-uuid",
        headers=headers,
    )
    assert res.status_code == 200
    items = res.json()["items"]
    assert [i["id"] for i in items] == [first, second, followed]
    assert [i["pinned"] for i in items] == [True, True, False]
    assert items[0]["title"] == "First pinned"
    assert items[2]["preview"]


@pytest.mark.asyncio
async def test_stack_drops_other_tenant_and_caps_following(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    other = Tenant(slug="other", name="Other")
    session_override.add(other)
    await session_override.commit()
    await session_override.refresh(other)
    foreign = Signal(tenant_id=other.id, channel="email", subject="Not yours")
    session_override.add(foreign)
    await session_override.commit()
    await session_override.refresh(foreign)

    ids = [await _thread(client, headers, f"Follow {n}") for n in range(4)]
    res = await client.get(
        f"/api/signals/stack?follow={foreign.id},{','.join(ids)}",
        headers=headers,
    )
    assert res.status_code == 200
    got = [i["id"] for i in res.json()["items"]]
    assert str(foreign.id) not in got
    assert got == ids[:1]


@pytest.mark.asyncio
async def test_stack_shows_working_agent(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    thread_id = await _thread(client, headers, "Agent at work")
    agent = (
        await session_override.execute(select(Agent).where(Agent.slug == "assistant"))
    ).scalars().first()
    signal = await session_override.get(Signal, UUID(thread_id))
    agent.runtime_status = "working"
    agent.current_signal_id = signal.id
    agent.current_activity_summary = "Drafting a reply"
    await session_override.commit()

    res = await client.get(f"/api/signals/stack?follow={thread_id}", headers=headers)
    assert res.status_code == 200
    card = res.json()["items"][0]
    assert card["agents"][0]["name"] == "Test Assistant"
    assert card["agents"][0]["working"] is True
    assert card["agents"][0]["summary"] == "Drafting a reply"


@pytest.mark.asyncio
async def test_stack_empty_without_pins_or_follow(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    res = await client.get("/api/signals/stack", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"items": []}


@pytest.mark.asyncio
async def test_stack_keeps_soft_deleted_pin(client: AsyncClient, session_override):
    """Pins and follows stay on the stack even when the thread is in trash."""
    from datetime import datetime

    headers = await _auth_headers(client)
    thread_id = await _thread(client, headers, "Pinned then trashed")
    assert (await client.post(f"/api/signals/{thread_id}/pin", headers=headers)).status_code == 200

    signal = await session_override.get(Signal, UUID(thread_id))
    signal.deleted_at = datetime.utcnow()
    await session_override.commit()

    res = await client.get("/api/signals/stack", headers=headers)
    assert res.status_code == 200
    items = res.json()["items"]
    assert [i["id"] for i in items] == [thread_id]
    assert items[0]["pinned"] is True
