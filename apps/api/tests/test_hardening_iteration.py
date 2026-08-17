"""Completeness iteration: tenant isolation, input validation, and persistence
fixes surfaced by the backend audit.

- Feedback requires an existing message inside the caller's tenant.
- Malformed UUID filters narrow to empty results instead of widening them.
- Workforce config persists across requests.
- Body UUIDs return 400 instead of 500.
- Defer with days snoozes the linked thread.
"""

import uuid as uuid_lib
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_feedback_on_unknown_message_is_404(client: AsyncClient):
    headers = await _login(client)
    r = await client.post(
        f"/api/messages/{uuid_lib.uuid4()}/feedback",
        headers=headers,
        json={"sentiment": "up"},
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_feedback_on_own_message_succeeds(client: AsyncClient, session_override):
    headers = await _login(client)

    from app.models.auth import Tenant
    from app.models.signal import Signal, SignalMessage

    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    signal = Signal(tenant_id=tenant.id, channel="email", subject="Feedback test")
    session_override.add(signal)
    await session_override.commit()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="agent_message",
        direction="outbound",
        role="assistant",
        body_text="Suggested reply",
    )
    session_override.add(message)
    await session_override.commit()

    r = await client.post(
        f"/api/messages/{message.id}/feedback",
        headers=headers,
        json={"sentiment": "down", "comment": "Too formal"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["sentiment"] == "down"


@pytest.mark.asyncio
async def test_bad_uuid_filters_return_empty_not_everything(client: AsyncClient, session_override):
    headers = await _login(client)

    from app.models.auth import Tenant
    from app.models.notification import DecisionRequest
    from app.models.signal import Signal

    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    session_override.add(Signal(tenant_id=tenant.id, channel="email", subject="Filter test"))
    session_override.add(
        DecisionRequest(tenant_id=tenant.id, title="Pending decision", status="awaiting_human")
    )
    await session_override.commit()

    # Malformed thread filter on decisions: must not list every decision.
    r = await client.get(
        "/api/workforce/messages", headers=headers, params={"thread_id": "not-a-uuid"}
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    items = payload["items"] if isinstance(payload, dict) else payload
    assert items == []

    # Malformed connection filter on signals: empty page, not the whole inbox.
    r = await client.get("/api/signals", headers=headers, params={"connection_id": "nope"})
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


@pytest.mark.asyncio
async def test_workforce_config_persists(client: AsyncClient):
    headers = await _login(client)

    r = await client.patch(
        "/api/workforce/workforce/config",
        headers=headers,
        json={"autonomy_level": "high", "check_interval_sec": 600},
    )
    assert r.status_code == 200, r.text
    assert r.json()["autonomy_level"] == "high"

    r = await client.get("/api/workforce/workforce/config", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["autonomy_level"] == "high"
    assert body["check_interval_sec"] == 600
    # Untouched keys keep their defaults.
    assert body["sleep_mode"] == "hybrid"


@pytest.mark.asyncio
async def test_trigger_agent_bad_uuid_is_400(client: AsyncClient):
    headers = await _login(client)
    r = await client.post(
        "/api/workforce/workforce/trigger-agent",
        headers=headers,
        json={"agent_id": "definitely-not-a-uuid", "instruction": "hello"},
    )
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_defer_with_days_snoozes_thread(client: AsyncClient, session_override):
    headers = await _login(client)

    from app.models.auth import Tenant
    from app.models.notification import DecisionRequest
    from app.models.signal import Signal

    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    signal = Signal(tenant_id=tenant.id, channel="email", subject="Defer test", status="open")
    session_override.add(signal)
    await session_override.commit()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=signal.id,
        title="Approve reply?",
        status="awaiting_human",
        options_json='[{"id": "approve"}, {"id": "later"}]',
    )
    session_override.add(decision)
    await session_override.commit()

    r = await client.post(
        f"/api/workforce/messages/{decision.id}/defer", headers=headers, json={"days": 3}
    )
    assert r.status_code == 200, r.text

    await session_override.refresh(signal)
    assert signal.status == "pending"
    assert signal.snoozed_until is not None
    assert signal.snoozed_until > datetime.utcnow()
