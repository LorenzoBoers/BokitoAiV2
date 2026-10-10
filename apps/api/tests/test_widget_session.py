"""Cycle 14: widget session identify, pre-chat contact linking and team availability."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

TENANT_SLUG = "test"


async def _owner_headers(client: AsyncClient) -> dict:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _widget_session(client: AsyncClient) -> tuple[dict, dict]:
    r = await client.post(
        "/api/livechat/session/start",
        json={"tenant_subdomain": TENANT_SLUG, "auth_mode": "anonymous"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return data, {"Authorization": f"Bearer {data['session_token']}"}


# ---------------------------------------------------------------------------
# Session start payload
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_start_exposes_availability(client: AsyncClient):
    data, _headers = await _widget_session(client)
    config = data["agent_config"]
    assert isinstance(config["team_available"], bool)
    assert config["pre_chat_form"] is True


# ---------------------------------------------------------------------------
# Identify
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_identify_links_contact_and_thread(client: AsyncClient):
    _data, widget = await _widget_session(client)

    # Create a conversation so identify can rename the thread.
    r = await client.post("/api/livechat/conversation", headers=widget, json={})
    assert r.status_code == 200, r.text
    conversation_id = r.json()["conversation_id"]

    r = await client.post(
        "/api/livechat/session/identify",
        headers=widget,
        json={
            "name": "Vera Visitor",
            "email": "Vera@Example.com",
            "conversation_id": conversation_id,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["contact"]["name"] == "Vera Visitor"
    assert body["contact"]["email"] == "vera@example.com"

    # Operator side: the thread now carries the visitor's real name.
    owner = await _owner_headers(client)
    r = await client.get(f"/api/signals/{conversation_id}", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["thread"]["contact_name"] == "Vera Visitor"


@pytest.mark.asyncio
async def test_session_identify_validation(client: AsyncClient):
    _data, widget = await _widget_session(client)

    r = await client.post(
        "/api/livechat/session/identify", headers=widget, json={"name": "", "email": ""}
    )
    assert r.status_code == 400

    r = await client.post(
        "/api/livechat/session/identify",
        headers=widget,
        json={"name": "X", "email": "not-an-email"},
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Widget settings API
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_widget_settings_roundtrip(client: AsyncClient):
    owner = await _owner_headers(client)

    r = await client.get("/api/settings/widget", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["pre_chat_form"] is True

    r = await client.put(
        "/api/settings/widget",
        headers=owner,
        json={
            "pre_chat_form": True,
            "offline_message": "We are closed. Back tomorrow.",
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["pre_chat_form"] is True
    assert data["offline_message"] == "We are closed. Back tomorrow."
    assert "office_hours" not in data
    assert isinstance(data["team_available"], bool)

    # Widget session reflects the new settings. Reachability stays a flag;
    # the session never carries an offline-chat banner message.
    session_data, _ = await _widget_session(client)
    assert session_data["agent_config"]["pre_chat_form"] is True
    assert "offline_message" not in session_data["agent_config"]


    # Reset for other tests.
    r = await client.put(
        "/api/settings/widget",
        headers=owner,
        json={"pre_chat_form": False},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_handoff_denied_when_nobody_is_available(client: AsyncClient, session_override):
    from app.models.auth import Membership, Tenant, User
    from app.models.signal import Signal
    from app.tools import execute_tool

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == TENANT_SLUG))).scalar_one()
    members = (
        await session_override.execute(
            select(User).join(Membership, Membership.user_id == User.id).where(Membership.tenant_id == tenant.id)
        )
    ).scalars().all()
    for member in members:
        member.away = True
        session_override.add(member)
    signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        source="widget",
        subject="Visitor chat",
    )
    session_override.add(signal)
    await session_override.commit()

    denied = await execute_tool(
        session_override,
        tenant.id,
        None,
        "handoff_to_human",
        {"signal_id": str(signal.id), "reason": "Need a person"},
        signal_id=signal.id,
        trust="external",
    )
    assert denied.get("status") == "denied"
    assert denied.get("reason") == "team_away"

    callback = await execute_tool(
        session_override,
        tenant.id,
        None,
        "request_callback",
        {"signal_id": str(signal.id), "reason": "Call me later"},
        signal_id=signal.id,
        trust="external",
    )
    assert callback.get("ok") is True
    await session_override.refresh(signal)
    assert signal.ai_handling is None