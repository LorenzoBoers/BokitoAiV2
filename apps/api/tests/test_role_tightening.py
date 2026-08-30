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
async def test_member_cannot_change_company_agent_model(client: AsyncClient):
    """Company agent models are admin-only; personal assistants no longer exist."""
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    member = await _member(client, owner, "model-member@example.com")

    r = await client.get("/api/me/assistant", headers=member)
    assert r.status_code == 404

    r = await client.get("/api/workforce/agents", headers=member)
    assert r.status_code == 200
    company = next(
        (
            a
            for a in r.json().get("items", r.json())
            if isinstance(a, dict) and a.get("kind") == "company"
        ),
        None,
    )
    assert company is not None
    r = await client.patch(
        f"/api/workforce/agents/{company['id']}/model",
        headers=member,
        json={"model": "claude-sonnet-4-5"},
    )
    assert r.status_code == 403
