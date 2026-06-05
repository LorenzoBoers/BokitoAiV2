import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.signal import Signal
from app.services.interpretation import triage_signal
from app.services.platform_access import agent_has_scope, effective_scopes
from app.models.agent import Agent


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_signals_api_list_and_inbound(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": "Help needed",
            "body_text": "I need support with billing",
            "contact_email": "a@test.com",
        },
    )
    assert ingest.status_code == 200
    listed = await client.get("/api/signals", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()["items"]) >= 1


@pytest.mark.asyncio
async def test_triage_signal_mock_llm(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.services.signals import create_inbound_signal

    signal = await create_inbound_signal(
        session_override,
        tenant.id,
        channel="email",
        source="mock",
        subject="Urgent invoice issue",
        body_text="Our invoice is wrong and we need this fixed today",
    )
    result = await triage_signal(session_override, tenant.id, signal.id)
    assert result.get("category")
    assert result.get("summary")
    row = (
        await session_override.execute(select(Signal).where(Signal.id == signal.id))
    ).scalar_one()
    assert row.triaged_at is not None


@pytest.mark.asyncio
async def test_platform_access_role_defaults(client: AsyncClient, session_override):
    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()
    scopes = effective_scopes(agent)
    assert "platform:read" in scopes
    assert agent_has_scope(agent, "platform:blueprint:write")
    assert not agent_has_scope(agent, "platform:agent:create")
