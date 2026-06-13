"""MVP tests: agent replies in internal threads + agent create/update API."""

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


async def _test_tenant(session_override) -> Tenant:
    return (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _company_agent(session_override, tenant_id) -> Agent:
    return (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant_id, Agent.kind == "company").limit(1)
        )
    ).scalars().first()


@pytest.mark.asyncio
async def test_internal_agent_thread_generates_reply(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = await _test_tenant(session_override)
    agent = await _company_agent(session_override, tenant.id)
    assert agent is not None

    sig = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="workforce",
        subject="Agent chat",
        agent_id=agent.id,
    )
    session_override.add(sig)
    await session_override.commit()
    await session_override.refresh(sig)

    reply = await client.post(
        f"/api/signals/{sig.id}/reply",
        headers=headers,
        json={"body_text": "Hello agent, what is the status?", "action": "send"},
    )
    assert reply.status_code == 200

    detail = await client.get(f"/api/signals/{sig.id}", headers=headers)
    assert detail.status_code == 200
    messages = detail.json()["messages"]
    # The operator's message plus a generated agent reply.
    assert any(m.get("direction") == "outbound" and m.get("kind") == "agent_message" for m in messages)


@pytest.mark.asyncio
async def test_external_thread_reply_has_no_agent_reply(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": "Customer email",
            "body_text": "Need help",
            "contact_email": "ext@test.com",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]

    reply = await client.post(
        f"/api/signals/{signal_id}/reply",
        headers=headers,
        json={"body_text": "Thanks, we are on it.", "action": "send"},
    )
    assert reply.status_code == 200

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert detail.status_code == 200
    messages = detail.json()["messages"]
    assert not any(m.get("kind") == "agent_message" for m in messages)


@pytest.mark.asyncio
async def test_create_and_update_company_agent(client: AsyncClient, session_override):
    headers = await _auth_headers(client)

    created = await client.post(
        "/api/workforce/agents",
        headers=headers,
        json={
            "name": "Support Specialist",
            "role": "communication",
            "system_prompt": "You help customers with billing.",
        },
    )
    assert created.status_code == 200, created.text
    agent = created.json()["agent"]
    assert agent["name"] == "Support Specialist"
    assert agent["kind"] == "company"
    assert agent["system_prompt"] == "You help customers with billing."
    agent_id = agent["id"]

    updated = await client.patch(
        f"/api/workforce/agents/{agent_id}",
        headers=headers,
        json={"name": "Billing Specialist", "system_prompt": "Updated instructions."},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["agent"]["name"] == "Billing Specialist"
    assert updated.json()["agent"]["system_prompt"] == "Updated instructions."

    # The new agent shows up in the workforce listing.
    listed = await client.get("/api/workforce/agents", headers=headers)
    assert listed.status_code == 200
    names = {a["name"] for a in listed.json()["items"]}
    assert "Billing Specialist" in names


@pytest.mark.asyncio
async def test_create_agent_rejects_empty_name(client: AsyncClient):
    headers = await _auth_headers(client)
    res = await client.post(
        "/api/workforce/agents",
        headers=headers,
        json={"name": "   "},
    )
    assert res.status_code == 400
