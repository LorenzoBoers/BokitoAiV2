"""Tests for Signal thread inbox-parity API."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_signal_threads_list_patch_pin(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": "Customer question",
            "body_text": "Need help",
            "contact_email": "c@test.com",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]

    listed = await client.get("/api/signals?view=all_open&folder=external", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["itemsTotal"] >= 1

    patched = await client.patch(
        f"/api/signals/{signal_id}",
        headers=headers,
        json={"priority": "high"},
    )
    assert patched.status_code == 200
    assert patched.json()["priority"] == "high"

    pinned = await client.post(f"/api/signals/{signal_id}/pin", headers=headers)
    assert pinned.status_code == 200
    pins = await client.get("/api/signals/pins", headers=headers)
    assert signal_id in pins.json()["thread_ids"]


@pytest.mark.asyncio
async def test_internal_decision_thread(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    from app.models.auth import Tenant

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.models.notification import Notification
    from app.services.signal_decisions import ingest_decision_request

    notification = Notification(
        tenant_id=tenant.id,
        kind="decision_request",
        title="Approve deploy?",
        body="Ready to ship",
    )
    session_override.add(notification)
    await session_override.flush()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        notification_id=notification.id,
        title="Approve deploy?",
        summary="Ready to ship",
        options_json="[]",
        status="awaiting_human",
    )
    session_override.add(decision)
    await session_override.flush()
    await ingest_decision_request(session_override, tenant.id, notification, decision)
    await session_override.commit()

    listed = await client.get(
        "/api/signals?view=awaiting_decision&folder=internal",
        headers=headers,
    )
    assert listed.status_code == 200
    assert listed.json()["itemsTotal"] >= 1

    detail = await client.get(f"/api/signals/{listed.json()['items'][0]['id']}", headers=headers)
    assert detail.status_code == 200
    kinds = [m.get("kind") for m in detail.json()["messages"]]
    assert "decision_request" in kinds


@pytest.mark.asyncio
async def test_channel_filter_and_inbox_folder(client: AsyncClient, session_override):
    headers = await _auth_headers(client)

    email = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": "Email thread",
            "body_text": "Hello",
            "contact_email": "a@test.com",
        },
    )
    assert email.status_code == 200
    widget = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "widget",
            "source": "mock",
            "subject": "Webchat thread",
            "body_text": "Hi from webchat",
            "contact_email": "b@test.com",
        },
    )
    assert widget.status_code == 200

    # An assistant chat should stay out of the shared inbox folder.
    conv = await client.post("/api/chat/conversations", json={"title": "My chat"}, headers=headers)
    assert conv.status_code == 200

    by_channel = await client.get("/api/signals?view=all&channel=widget", headers=headers)
    assert by_channel.status_code == 200
    channels = {item["channel"] for item in by_channel.json()["items"]}
    assert channels == {"widget"}

    inbox = await client.get("/api/signals?view=all&folder=inbox", headers=headers)
    assert inbox.status_code == 200
    inbox_channels = {item["channel"] for item in inbox.json()["items"]}
    assert "assistant" not in inbox_channels
    assert {"email", "widget"}.issubset(inbox_channels)


@pytest.mark.asyncio
async def test_tag_filter(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": "Billing question",
            "body_text": "Invoice issue",
            "contact_email": "billing@test.com",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]
    patched = await client.patch(
        f"/api/signals/{signal_id}",
        headers=headers,
        json={"tags": ["billing"]},
    )
    assert patched.status_code == 200

    tagged = await client.get("/api/signals?view=all&tag=billing", headers=headers)
    assert tagged.status_code == 200
    ids = {item["id"] for item in tagged.json()["items"]}
    assert signal_id in ids

    untagged = await client.get("/api/signals?view=all&tag=does-not-exist", headers=headers)
    assert untagged.status_code == 200
    assert untagged.json()["itemsTotal"] == 0


@pytest.mark.asyncio
async def test_signal_model_extensions(session_override):
    from app.models.auth import Tenant

    tenant = Tenant(slug="sig-ext", name="Sig Ext")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    sig = Signal(tenant_id=tenant.id, channel="internal", subject="Agent thread", project_id=None)
    session_override.add(sig)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=sig.id,
            tenant_id=tenant.id,
            kind="decision_request",
            direction="inbound",
            body_text="Choose",
        )
    )
    await session_override.commit()
    row = (await session_override.execute(select(SignalMessage))).scalar_one()
    assert row.kind == "decision_request"
