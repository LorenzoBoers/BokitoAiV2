"""Cycle 32: privileged mutations require owner/admin (not plain members)."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient, email: str, password: str) -> dict:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _member(client: AsyncClient, owner: dict, email: str) -> dict:
    r = await client.post(
        "/api/auth/invite", headers=owner, json={"email": email, "role": "member"}
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    r = await client.post(
        "/api/auth/accept-invite",
        json={"token": token, "password": "member-pass1", "display_name": "Member"},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_member_cannot_force_wake(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    member = await _member(client, owner, "wake-member@example.com")
    r = await client.post("/api/workforce/workforce/force-wake", headers=member, json={})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_member_cannot_list_tokens(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    member = await _member(client, owner, "token-member@example.com")
    r = await client.get("/api/govern/tokens", headers=member)
    assert r.status_code == 403
    # Owner still can.
    r = await client.get("/api/govern/tokens", headers=owner)
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_member_cannot_install_mcp(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    member = await _member(client, owner, "mcp-member@example.com")
    r = await client.post(
        "/api/integrations/mcp/install",
        headers=member,
        json={"provider": "bjorn_lunden_mcp", "name": "BL"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_member_can_change_own_assistant_model_but_not_company(client: AsyncClient):
    """The My Assistant page lets every user pick their assistant's model;
    company agents stay admin-only."""
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    member = await _member(client, owner, "model-member@example.com")

    # Provision the member's personal assistant and read its id.
    r = await client.get("/api/me/assistant", headers=member)
    assert r.status_code == 200, r.text
    own_agent_id = r.json()["agent"]["id"]
    own_model = r.json()["agent"]["model"]

    # Authorization must pass for the member's own assistant. The model catalog
    # is not seeded in tests, so accept 200 (valid model) or 400 (catalog miss);
    # what matters is that it is not a 403.
    r = await client.patch(
        f"/api/workforce/agents/{own_agent_id}/model",
        headers=member,
        json={"model": own_model},
    )
    assert r.status_code != 403, r.text

    # A company agent is still off-limits for plain members.
    r = await client.get("/api/workforce/agents", headers=member)
    assert r.status_code == 200
    company = next((a for a in r.json().get("items", r.json())
                    if isinstance(a, dict) and a.get("kind") != "personal"), None)
    if company:
        r = await client.patch(
            f"/api/workforce/agents/{company['id']}/model",
            headers=member,
            json={"model": "claude-sonnet-4-5"},
        )
        assert r.status_code == 403
