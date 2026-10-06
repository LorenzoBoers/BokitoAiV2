"""Bulk dismiss: close a whole kind of decision card at once."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.signal import Signal
from app.services.signal_decisions import recently_declined_decision


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _card(tenant_id, title: str, signal_id=None, action: str = "acknowledge") -> DecisionRequest:
    return DecisionRequest(
        tenant_id=tenant_id,
        title=title,
        summary="",
        status="awaiting_human",
        signal_id=signal_id,
        options_json=json.dumps(
            [
                {"id": "a", "label": "Ok", "action_type": action},
                {"id": "later", "label": "Later", "action_type": "defer"},
            ]
        ),
    )


@pytest.mark.asyncio
async def test_groups_and_dismiss_by_title(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = Signal(tenant_id=tenant.id, channel="email", subject="Invoice", status="open")
    session_override.add(signal)
    await session_override.flush()
    session_override.add_all(
        [
            _card(tenant.id, "No reply needed", signal.id),
            _card(tenant.id, "No reply needed"),
            _card(tenant.id, "No reply needed"),
            _card(tenant.id, "Turn on Banking?", action="enable_module"),
        ]
    )
    await session_override.commit()
    headers = await _auth_headers(client)

    groups = await client.get("/api/notifications/decisions/groups", headers=headers)
    assert groups.status_code == 200
    by_title = {g["title"]: g for g in groups.json()}
    assert by_title["No reply needed"]["count"] == 3
    assert by_title["No reply needed"]["without_thread"] == 2
    assert by_title["Turn on Banking?"]["count"] == 1

    dismissed = await client.post(
        "/api/notifications/decisions/dismiss",
        headers=headers,
        json={"title": "No reply needed"},
    )
    assert dismissed.status_code == 200
    assert dismissed.json() == {"dismissed": 3}

    remaining = (
        await session_override.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == tenant.id,
                DecisionRequest.status == "awaiting_human",
            )
        )
    ).scalars().all()
    assert [row.title for row in remaining] == ["Turn on Banking?"]

    closed = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.title == "No reply needed")
        )
    ).scalars().all()
    assert {row.status for row in closed} == {"deferred"}
    assert {row.chosen_option_id for row in closed} == {"dismissed"}
    assert all(row.resolved_by_user_id is not None for row in closed)

    # A dismissed proposal counts as declined for the cooldown.
    declined = await recently_declined_decision(session_override, tenant.id, title="No reply needed")
    assert declined is not None


@pytest.mark.asyncio
async def test_dismiss_without_thread_only_and_requires_a_filter(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = Signal(tenant_id=tenant.id, channel="email", subject="Quote", status="open")
    session_override.add(signal)
    await session_override.flush()
    session_override.add_all(
        [
            _card(tenant.id, "Connect KING?", action="setup_integration"),
            _card(tenant.id, "Send quote?", signal.id, action="send_reply"),
        ]
    )
    await session_override.commit()
    headers = await _auth_headers(client)

    empty = await client.post("/api/notifications/decisions/dismiss", headers=headers, json={})
    assert empty.status_code == 422

    result = await client.post(
        "/api/notifications/decisions/dismiss",
        headers=headers,
        json={"without_thread_only": True},
    )
    assert result.json() == {"dismissed": 1}
    remaining = (
        await session_override.execute(
            select(DecisionRequest.title).where(
                DecisionRequest.tenant_id == tenant.id,
                DecisionRequest.status == "awaiting_human",
            )
        )
    ).scalars().all()
    assert remaining == ["Send quote?"]
