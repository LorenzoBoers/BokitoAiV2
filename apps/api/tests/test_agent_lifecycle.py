"""Cycle 13: contact management and agent lifecycle (archive, status, passport)."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient, email: str, password: str) -> dict:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_contact_create_list_delete(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)

    r = await client.post(
        "/api/channels/contacts",
        headers=owner,
        json={
            "channel": "email",
            "address": "New.Person@Example.com",
            "display_name": "New Person",
            "company": "Acme",
        },
    )
    assert r.status_code == 200, r.text
    contact = r.json()
    assert contact["address"] == "new.person@example.com"  # normalized
    assert contact["status"] == "approved"
    contact_id = contact["id"]

    r = await client.get("/api/channels/contacts", headers=owner)
    assert r.status_code == 200
    assert any(c["id"] == contact_id for c in r.json()["contacts"])

    # Duplicate address on the same channel is rejected.
    r = await client.post(
        "/api/channels/contacts",
        headers=owner,
        json={"channel": "email", "address": "new.person@example.com"},
    )
    assert r.status_code == 409

    r = await client.delete(f"/api/channels/contacts/{contact_id}", headers=owner)
    assert r.status_code == 200

    r = await client.get(f"/api/channels/contacts/{contact_id}", headers=owner)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_contact_create_rejects_invalid_input(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)

    r = await client.post(
        "/api/channels/contacts", headers=owner, json={"channel": "email", "address": "   "}
    )
    assert r.status_code == 400

    r = await client.post(
        "/api/channels/contacts",
        headers=owner,
        json={"channel": "carrier-pigeon", "address": "coo@example.com"},
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Agent lifecycle
# ---------------------------------------------------------------------------


async def _create_agent(client: AsyncClient, headers: dict, name: str) -> str:
    r = await client.post(
        "/api/workforce/agents",
        headers=headers,
        json={"name": name, "role": "communication"},
    )
    assert r.status_code == 200, r.text
    return r.json()["agent"]["id"]


async def _list_agents(client: AsyncClient, headers: dict) -> list[dict]:
    r = await client.get("/api/workforce/agents", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["items"]


@pytest.mark.asyncio
async def test_archive_agent_hides_it_from_the_list(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    agent_id = await _create_agent(client, owner, "Archivable Agent")
    assert any(a["id"] == agent_id for a in await _list_agents(client, owner))

    r = await client.delete(f"/api/workforce/agents/{agent_id}", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    assert not any(a["id"] == agent_id for a in await _list_agents(client, owner))

    # Archiving twice returns 404 (no longer a company agent).
    r = await client.delete(f"/api/workforce/agents/{agent_id}", headers=owner)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_default_assistant_cannot_be_archived(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    agents = await _list_agents(client, owner)
    assistant = next(a for a in agents if a["slug"] == "assistant")

    r = await client.delete(f"/api/workforce/agents/{assistant['id']}", headers=owner)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_agent_status_toggle(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    agent_id = await _create_agent(client, owner, "Toggle Agent")

    r = await client.patch(
        f"/api/workforce/agents/{agent_id}/status", headers=owner, json={"status": "active"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["agent"]["status"] == "active"

    r = await client.patch(
        f"/api/workforce/agents/{agent_id}/status", headers=owner, json={"status": "standby"}
    )
    assert r.status_code == 200
    assert r.json()["agent"]["status"] == "standby"

    r = await client.patch(
        f"/api/workforce/agents/{agent_id}/status", headers=owner, json={"status": "bogus"}
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Passport
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_passport_autonomy_level_patch(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    agent_id = await _create_agent(client, owner, "Passport Agent")

    r = await client.patch(
        f"/api/govern/passports/{agent_id}", headers=owner, json={"autonomy_level": "auto"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["passport"]["autonomy_level"] == "auto"

    # Persisted and visible in the passports list.
    r = await client.get("/api/govern/passports", headers=owner)
    assert r.status_code == 200
    row = next(p for p in r.json()["items"] if p["id"] == agent_id)
    assert row["autonomy_level"] == "auto"

    r = await client.patch(
        f"/api/govern/passports/{agent_id}", headers=owner, json={"autonomy_level": "sometimes"}
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_passport_tools_and_scopes_patch(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    agent_id = await _create_agent(client, owner, "Tools Agent")

    r = await client.patch(
        f"/api/govern/passports/{agent_id}",
        headers=owner,
        json={
            "allowed_tools": ["send_email", "search_web"],
            "permission_scopes": ["platform:doc:write"],
        },
    )
    assert r.status_code == 200, r.text
    passport = r.json()["passport"]
    assert passport["allowed_tools"] == ["send_email", "search_web"]
    assert passport["permission_scopes"] == ["platform:doc:write"]
