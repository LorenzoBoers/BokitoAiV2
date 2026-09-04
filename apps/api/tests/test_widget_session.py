"""Cycle 14: widget session identify, pre-chat contact linking and office hours."""

from datetime import datetime, timezone, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.services.livechat_compat import office_hours_open
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
    assert "office_open" in config
    assert config["office_open"] is True  # hours disabled by default -> open
    assert config["pre_chat_form"] is False


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
    assert r.json()["pre_chat_form"] is False

    r = await client.put(
        "/api/settings/widget",
        headers=owner,
        json={
            "pre_chat_form": True,
            "offline_message": "We are closed. Back tomorrow.",
            "office_hours": {
                "enabled": True,
                "timezone": "Europe/Amsterdam",
                "days": [0, 1, 2, 3, 4],
                "start": "09:00",
                "end": "17:00",
            },
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["pre_chat_form"] is True
    assert data["offline_message"] == "We are closed. Back tomorrow."
    assert data["office_hours"]["enabled"] is True

    # Widget session reflects the new settings. Reachability stays a flag;
    # the session never carries an offline-chat banner message.
    session_data, _ = await _widget_session(client)
    assert session_data["agent_config"]["pre_chat_form"] is True
    assert "offline_message" not in session_data["agent_config"]

    # Invalid hours rejected.
    r = await client.put(
        "/api/settings/widget",
        headers=owner,
        json={"office_hours": {"enabled": True, "start": "morning", "end": "17:00"}},
    )
    assert r.status_code == 400

    # Reset for other tests.
    r = await client.put(
        "/api/settings/widget",
        headers=owner,
        json={"pre_chat_form": False, "office_hours": {"enabled": False}},
    )
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# Office hours evaluation (pure)
# ---------------------------------------------------------------------------


def test_office_hours_open_logic():
    hours = {
        "enabled": True,
        "timezone": "UTC",
        "days": [0, 1, 2, 3, 4],
        "start": "09:00",
        "end": "17:00",
    }
    # Wednesday 2026-07-22 12:00 UTC -> open
    wednesday_noon = datetime(2026, 7, 22, 12, 0, tzinfo=timezone.utc)
    assert office_hours_open(hours, now=wednesday_noon) is True
    # Wednesday 20:00 -> closed
    assert office_hours_open(hours, now=wednesday_noon + timedelta(hours=8)) is False
    # Saturday noon -> closed
    saturday_noon = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)
    assert office_hours_open(hours, now=saturday_noon) is False
    # Disabled -> always open
    assert office_hours_open({**hours, "enabled": False}, now=saturday_noon) is True
    # Broken config fails open
    assert office_hours_open({**hours, "timezone": "Mars/Olympus"}, now=saturday_noon) is True


@pytest.mark.asyncio
async def test_handoff_denied_outside_team_hours(client: AsyncClient, session_override):
    import json

    from app.models.auth import Tenant
    from app.models.signal import Signal
    from app.tools import execute_tool

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == TENANT_SLUG))).scalar_one()
    settings = json.loads(tenant.settings_json or "{}")
    livechat = settings.get("livechat_settings")
    if not isinstance(livechat, dict):
        livechat = {}
        settings["livechat_settings"] = livechat
    livechat["office_hours"] = {
        "enabled": True,
        "timezone": "UTC",
        "days": [],
        "start": "09:00",
        "end": "17:00",
    }
    tenant.settings_json = json.dumps(settings)
    session_override.add(tenant)
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
    assert callback.get("ai_paused") is False