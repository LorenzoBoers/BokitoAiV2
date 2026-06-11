import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
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
    listed = await client.get("/api/signals?view=all_open", headers=headers)
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
async def test_email_connection_id_filter(client: AsyncClient, session_override):
    from app.models.auth import Tenant, user_numeric_id
    from app.models.channel import ChannelAccount

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    account = (
        await session_override.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id, ChannelAccount.channel == "email"
            )
        )
    ).scalar_one()

    linked = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": "Mailbox scoped",
            "body_text": "Only this mailbox",
            "contact_email": "scoped@test.com",
        },
    )
    assert linked.status_code == 200

    numeric_id = user_numeric_id(account.id)
    filtered = await client.get(
        f"/api/signals?view=all_open&folder=external&email_connection_id={numeric_id}",
        headers=headers,
    )
    assert filtered.status_code == 200
    subjects = [item["email_subject"] for item in filtered.json()["items"]]
    assert "Mailbox scoped" in subjects

    other = await client.get(
        "/api/signals?view=all_open&folder=external&email_connection_id=999999999",
        headers=headers,
    )
    assert other.status_code == 200
    assert other.json()["itemsTotal"] == 0


@pytest.mark.asyncio
async def test_outbound_view(client: AsyncClient, session_override):
    from app.models.auth import Tenant

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()

    sig = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Outbound queue",
        status="open",
    )
    session_override.add(sig)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=sig.id,
            tenant_id=tenant.id,
            kind="agent_message",
            direction="outbound",
            body_text="We replied",
            body_preview="We replied",
        )
    )
    await session_override.commit()

    listed = await client.get("/api/signals?view=outbound&folder=external", headers=headers)
    assert listed.status_code == 200
    subjects = [item["email_subject"] for item in listed.json()["items"]]
    assert "Outbound queue" in subjects


@pytest.mark.asyncio
async def test_signals_sync_status(client: AsyncClient):
    headers = await _auth_headers(client)
    resp = await client.get("/api/signals/sync-status", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_platform_access_role_defaults(client: AsyncClient, session_override):
    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()
    scopes = effective_scopes(agent)
    assert "platform:read" in scopes
    assert agent_has_scope(agent, "platform:doc:write")
    assert not agent_has_scope(agent, "platform:agent:create")
