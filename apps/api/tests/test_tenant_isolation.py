"""Cycle 1 tenant/session integrity: clean bootstrap, workspace switch, trigger threads."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant, User
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.signal import Signal
from app.models.trigger import Trigger
from app.services.auth import decode_access_token


@pytest.mark.asyncio
async def test_signup_creates_empty_tenant(client: AsyncClient, session_override):
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "fresh@example.com",
            "password": "test-password",
            "tenant_slug": "fresh-co",
            "tenant_name": "Fresh Co",
        },
    )
    assert signup.status_code == 200
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "fresh-co"))
    ).scalar_one()

    projects = (
        await session_override.execute(select(Project).where(Project.tenant_id == tenant.id))
    ).scalars().all()
    assert projects == [], "fresh tenant must not have demo projects"

    workstreams = (
        await session_override.execute(select(Workstream).where(Workstream.tenant_id == tenant.id))
    ).scalars().all()
    assert workstreams == [], "fresh tenant must not have demo workstreams"

    signals = (
        await session_override.execute(select(Signal).where(Signal.tenant_id == tenant.id))
    ).scalars().all()
    assert len(signals) == 1, "fresh tenant has one Platform check-in conversation"
    assert signals[0].channel == "internal"
    assert signals[0].subject == "Platform check-in"

    triggers = (
        await session_override.execute(select(Trigger).where(Trigger.tenant_id == tenant.id))
    ).scalars().all()
    assert len(triggers) == 1
    assert triggers[0].kind == "heartbeat"
    assert triggers[0].enabled is True
    assert triggers[0].name == "Platform check-in"

    user = (
        await session_override.execute(select(User).where(User.email == "fresh@example.com"))
    ).scalar_one()
    assert user.last_tenant_id == tenant.id


@pytest.mark.asyncio
async def test_switch_workspace_scopes_token(client: AsyncClient, session_override):
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "switcher@example.com",
            "password": "test-password",
            "tenant_slug": "first-co",
            "tenant_name": "First Co",
        },
    )
    token = signup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    first_tenant_id = decode_access_token(token)["tenant_id"]

    created = await client.post(
        "/api/app/workspaces",
        json={"name": "Second Co", "subdomain": "second-co"},
        headers=headers,
    )
    assert created.status_code == 200
    payload = created.json()
    # Workspace create must hand back a session scoped to the new tenant.
    assert payload.get("session", {}).get("access_token")
    new_token = payload["session"]["access_token"]
    assert decode_access_token(new_token)["tenant_id"] == payload["id"]
    assert payload["id"] != first_tenant_id

    # Member can switch back to the first workspace and gets a re-scoped token.
    switched = await client.post(
        "/api/auth/switch-workspace",
        json={"tenant_id": first_tenant_id},
        headers={"Authorization": f"Bearer {new_token}"},
    )
    assert switched.status_code == 200
    assert decode_access_token(switched.json()["access_token"])["tenant_id"] == first_tenant_id

    # Switching to a tenant without membership is forbidden.
    other = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    forbidden = await client.post(
        "/api/auth/switch-workspace",
        json={"tenant_id": str(other.id)},
        headers={"Authorization": f"Bearer {new_token}"},
    )
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_login_prefers_last_workspace(client: AsyncClient, session_override):
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "lastws@example.com",
            "password": "test-password",
            "tenant_slug": "last-a",
            "tenant_name": "Last A",
        },
    )
    token = signup.json()["access_token"]
    created = await client.post(
        "/api/app/workspaces",
        json={"name": "Last B", "subdomain": "last-b"},
        headers={"Authorization": f"Bearer {token}"},
    )
    second_tenant_id = created.json()["id"]

    # Workspace create persisted last_tenant_id; login must land there.
    login = await client.post(
        "/api/auth/login",
        json={"email": "lastws@example.com", "password": "test-password"},
    )
    assert login.status_code == 200
    assert decode_access_token(login.json()["access_token"])["tenant_id"] == second_tenant_id


@pytest.mark.asyncio
async def test_trigger_results_reuse_single_thread(client: AsyncClient, session_override):
    from app.models.agent import Agent
    from app.services.triggers import _surface_result

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id).limit(1)
        )
    ).scalars().first()
    trigger = Trigger(
        tenant_id=tenant.id,
        name="Daily scan",
        kind="interval",
        interval_minutes=1440,
        agent_id=agent.id,
    )
    session_override.add(trigger)
    await session_override.commit()

    await _surface_result(session_override, trigger, agent, "First result")
    await session_override.commit()
    await _surface_result(session_override, trigger, agent, "Second result")
    await session_override.commit()

    threads = (
        await session_override.execute(
            select(Signal).where(
                Signal.tenant_id == tenant.id, Signal.subject == "Daily scan"
            )
        )
    ).scalars().all()
    assert len(threads) == 1, "recurring trigger must reuse one thread"
    assert trigger.signal_id == threads[0].id


@pytest.mark.asyncio
async def test_onboarding_status_endpoint(client: AsyncClient):
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "onboard@example.com",
            "password": "test-password",
            "tenant_slug": "onboard-co",
            "tenant_name": "Onboard Co",
        },
    )
    headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
    resp = await client.get("/api/app/onboarding", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    step_ids = [step["id"] for step in data["steps"]]
    # Communication-first activation order, then profile and team.
    assert step_ids == ["email", "assistant", "first_decision", "watching", "company", "team"]
    assert data["completed"] is False
    by_id = {step["id"]: step["done"] for step in data["steps"]}
    # Only the hourly check-in is on from day one. A signup has no email channel
    # until the workspace creates a relay address or connects a mailbox.
    assert by_id["watching"] is True
    assert all(
        by_id[key] is False
        for key in ("email", "company", "assistant", "first_decision", "team")
    )
