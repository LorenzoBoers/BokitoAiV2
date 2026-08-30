import pytest
from httpx import AsyncClient
from sqlalchemy import select


@pytest.mark.asyncio
async def test_chat_flow(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    targets = await client.get("/api/chat/targets", headers=headers)
    assert targets.status_code == 200
    items = targets.json()["items"]
    assert items, "seeded workspace must expose at least one company agent"
    agent_id = items[0]["id"]

    conv = await client.post(
        "/api/chat/conversations",
        json={"title": "Test chat", "agent_id": agent_id},
        headers=headers,
    )
    assert conv.status_code == 200
    conv_id = conv.json()["id"]

    msg = await client.post(
        f"/api/chat/conversations/{conv_id}/messages",
        json={"content": "What is Bokito?"},
        headers=headers,
    )
    assert msg.status_code == 200
    assert msg.json()["message"]["role"] == "assistant"
    assert "mock" in msg.json()["message"]["content"].lower() or "bokito" in msg.json()["message"]["content"].lower()


@pytest.mark.asyncio
async def test_chat_targets_company_only_and_create_requires_agent(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    targets = await client.get("/api/chat/targets", headers=headers)
    assert targets.status_code == 200
    payload = targets.json()
    assert all(item.get("kind") == "company" for item in payload["items"])
    assert "personal" not in {item.get("kind") for item in payload["items"]}

    missing = await client.post(
        "/api/chat/conversations",
        json={"title": "No agent"},
        headers=headers,
    )
    assert missing.status_code == 400, missing.text
    detail = missing.json().get("detail", missing.text)
    assert "choose" in str(detail).lower()


@pytest.mark.asyncio
async def test_admin_sees_all_company_agents_in_targets(client: AsyncClient, session_override):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD
    from app.models.agent import Agent
    from app.models.auth import Tenant, User
    from app.services.personal_agents import allowed_company_agents

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    hidden_agent = Agent(
        tenant_id=tenant.id,
        name="Hidden Ops Agent",
        role="assistant",
        kind="company",
        chat_access="nobody",
    )
    session_override.add(hidden_agent)
    await session_override.commit()

    # The seeded user is the workspace owner: targets must include the
    # nobody-access agent.
    targets = await client.get("/api/chat/targets", headers=headers)
    assert targets.status_code == 200
    names = {item["name"] for item in targets.json()["items"]}
    assert "Hidden Ops Agent" in names

    # A plain member (is_admin=False) must not see it.
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    member_visible = await allowed_company_agents(
        session_override, tenant.id, user.id, is_admin=False
    )
    assert all(a.name != "Hidden Ops Agent" for a in member_visible)
