"""Agent assignment: lead agent, project agents, and channel visibility ACL."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient, email: str, password: str) -> dict:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _create_member(session: AsyncSession, email: str) -> None:
    from app.models.auth import Membership, Tenant, User
    from app.services.auth import hash_password

    tenant = (await session.execute(select(Tenant))).scalars().first()
    user = User(
        email=email,
        password_hash=hash_password(TEST_PASSWORD),
        display_name="Member",
        email_verified=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    session.add(Membership(tenant_id=tenant.id, user_id=user.id, role="member"))
    await session.commit()


# ---------------------------------------------------------------------------
# Lead agent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lead_agent_transfer_and_archive_guard(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)

    r = await client.get("/api/workforce/agents", headers=owner)
    assert r.status_code == 200
    agents = r.json()["items"] if isinstance(r.json(), dict) else r.json()
    lead = next(a for a in agents if a.get("is_lead"))
    assert lead["name"] == "Test Assistant"

    # Create a second company agent to transfer the lead to.
    r = await client.post(
        "/api/workforce/agents",
        headers=owner,
        json={"name": "Support Agent", "role": "assistant"},
    )
    assert r.status_code in (200, 201), r.text
    created = r.json()
    new_agent_id = (created.get("agent") or created)["id"]

    # The lead cannot be archived while it holds the label.
    r = await client.delete(f"/api/workforce/agents/{lead['id']}", headers=owner)
    assert r.status_code == 409

    # Transfer the lead label.
    r = await client.patch(f"/api/workforce/agents/{new_agent_id}/lead", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["agent"]["is_lead"] is True

    # Exactly one lead remains.
    r = await client.get("/api/workforce/agents", headers=owner)
    agents = r.json()["items"] if isinstance(r.json(), dict) else r.json()
    leads = [a for a in agents if a.get("is_lead")]
    assert len(leads) == 1
    assert leads[0]["id"] == new_agent_id

    # The previous lead can now be archived.
    r = await client.delete(f"/api/workforce/agents/{lead['id']}", headers=owner)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_lead_transfer_requires_admin(client: AsyncClient, session_override: AsyncSession):
    await _create_member(session_override, "member-lead@example.com")
    member = await _login(client, "member-lead@example.com", TEST_PASSWORD)
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)

    r = await client.get("/api/workforce/agents", headers=owner)
    agents = r.json()["items"] if isinstance(r.json(), dict) else r.json()
    lead = next(a for a in agents if a.get("is_lead"))

    r = await client.patch(f"/api/workforce/agents/{lead['id']}/lead", headers=member)
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Project agents
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_project_agents_crud_and_default(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)

    r = await client.post(
        "/api/workforce/projects",
        headers=owner,
        json={"name": "Roster Project", "slug": "roster", "autonomous_scope": "draft"},
    )
    assert r.status_code == 200, r.text
    project_id = r.json()["id"]

    r = await client.get("/api/workforce/agents", headers=owner)
    agents = r.json()["items"] if isinstance(r.json(), dict) else r.json()
    assistant = next(a for a in agents if a["name"] == "Test Assistant")

    # Add to roster as default.
    r = await client.post(
        f"/api/workforce/projects/{project_id}/agents",
        headers=owner,
        json={"agent_id": assistant["id"], "is_default": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_default"] is True

    # Duplicate add is a conflict.
    r = await client.post(
        f"/api/workforce/projects/{project_id}/agents",
        headers=owner,
        json={"agent_id": assistant["id"]},
    )
    assert r.status_code == 409

    r = await client.get(f"/api/workforce/projects/{project_id}/agents", headers=owner)
    assert r.status_code == 200
    roster = r.json()
    assert len(roster) == 1
    assert roster[0]["agent_id"] == assistant["id"]

    # Projects list exposes roster chips.
    r = await client.get("/api/workforce/projects", headers=owner)
    listed = next(p for p in r.json() if p["id"] == project_id)
    assert listed["agents"] and listed["agents"][0]["agent_id"] == assistant["id"]

    # Unset default via PATCH.
    r = await client.patch(
        f"/api/workforce/projects/{project_id}/agents/{assistant['id']}",
        headers=owner,
        json={"is_default": False},
    )
    assert r.status_code == 200
    assert r.json()["is_default"] is False

    # Remove from roster.
    r = await client.delete(
        f"/api/workforce/projects/{project_id}/agents/{assistant['id']}", headers=owner
    )
    assert r.status_code == 200
    r = await client.get(f"/api/workforce/projects/{project_id}/agents", headers=owner)
    assert r.json() == []


@pytest.mark.asyncio
async def test_project_default_agent_routes_thread(
    client: AsyncClient, session_override: AsyncSession
):
    from uuid import UUID

    from app.models.agent import Agent
    from app.models.signal import Signal
    from app.services.signal_threads import _resolve_thread_agent

    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)

    r = await client.post(
        "/api/workforce/projects",
        headers=owner,
        json={"name": "Routing Project", "slug": "routing", "autonomous_scope": "draft"},
    )
    project_id = r.json()["id"]

    r = await client.post(
        "/api/workforce/agents",
        headers=owner,
        json={"name": "Project Specialist", "role": "assistant"},
    )
    created = r.json()
    specialist_id = (created.get("agent") or created)["id"]

    r = await client.post(
        f"/api/workforce/projects/{project_id}/agents",
        headers=owner,
        json={"agent_id": specialist_id, "is_default": True},
    )
    assert r.status_code == 200, r.text

    tenant_id = (
        (await session_override.execute(select(Agent.tenant_id))).scalars().first()
    )
    signal = Signal(
        tenant_id=tenant_id,
        channel="internal",
        subject="Project thread",
        project_id=UUID(project_id),
    )
    session_override.add(signal)
    await session_override.commit()

    agent = await _resolve_thread_agent(session_override, tenant_id, signal)
    assert agent is not None
    assert str(agent.id) == specialist_id


# ---------------------------------------------------------------------------
# Channel visibility ACL
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_channel_visibility_acl(client: AsyncClient, session_override: AsyncSession):
    from app.models.channel import ChannelAccount
    from app.models.signal import Signal

    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    await _create_member(session_override, "member-vis@example.com")
    member = await _login(client, "member-vis@example.com", TEST_PASSWORD)

    account = (
        (await session_override.execute(select(ChannelAccount))).scalars().first()
    )
    signal = Signal(
        tenant_id=account.tenant_id,
        channel="email",
        subject="Restricted mailbox thread",
        channel_account_id=account.id,
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    # Default: everyone sees the account and the thread.
    r = await client.get("/api/signals", headers=member)
    assert any(item["id"] == str(signal.id) for item in r.json()["items"])

    # Restrict the account to nobody (selected with empty list).
    r = await client.patch(
        f"/api/channels/accounts/{account.id}/visibility",
        headers=owner,
        json={"mode": "selected", "user_ids": []},
    )
    assert r.status_code == 200, r.text
    assert r.json()["visibility"]["mode"] == "selected"

    # Members can no longer update visibility themselves.
    r = await client.patch(
        f"/api/channels/accounts/{account.id}/visibility",
        headers=member,
        json={"mode": "everyone", "user_ids": []},
    )
    assert r.status_code == 403

    # Thread list is filtered for the member, not for the owner.
    r = await client.get("/api/signals", headers=member)
    assert not any(item["id"] == str(signal.id) for item in r.json()["items"])
    r = await client.get("/api/signals", headers=owner)
    assert any(item["id"] == str(signal.id) for item in r.json()["items"])

    # Detail 404s for the member.
    r = await client.get(f"/api/signals/{signal.id}", headers=member)
    assert r.status_code == 404
    r = await client.get(f"/api/signals/{signal.id}", headers=owner)
    assert r.status_code == 200

    # Account lists are filtered for the member.
    r = await client.get("/api/channels/accounts", headers=member)
    assert not any(a["id"] == str(account.id) for a in r.json()["accounts"])
    r = await client.get("/api/email/accounts", headers=member)
    assert not any(a.get("uuid") == str(account.id) for a in r.json())
    r = await client.get("/api/channels/accounts", headers=owner)
    assert any(a["id"] == str(account.id) for a in r.json()["accounts"])

    # Granting the member access restores everything.
    from app.models.auth import User

    member_user = (
        await session_override.execute(select(User).where(User.email == "member-vis@example.com"))
    ).scalar_one()
    r = await client.patch(
        f"/api/channels/accounts/{account.id}/visibility",
        headers=owner,
        json={"mode": "selected", "user_ids": [str(member_user.id)]},
    )
    assert r.status_code == 200

    r = await client.get("/api/signals", headers=member)
    assert any(item["id"] == str(signal.id) for item in r.json()["items"])
    r = await client.get(f"/api/signals/{signal.id}", headers=member)
    assert r.status_code == 200
    r = await client.get("/api/channels/accounts", headers=member)
    assert any(a["id"] == str(account.id) for a in r.json()["accounts"])
