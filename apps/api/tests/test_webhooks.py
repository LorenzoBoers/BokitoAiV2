"""Outbound webhooks (settings CRUD, HMAC delivery, lifecycle emits) + public API v1."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _headers(client: AsyncClient) -> dict[str, str]:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class _FakeResponse:
    def __init__(self, status_code: int = 200):
        self.status_code = status_code


def _patch_enqueue_noop(monkeypatch):
    """Keep deliveries pending so tests can assert + deliver deterministically."""

    async def _noop(delivery_id: str):
        return None

    monkeypatch.setattr("app.workers.tasks.enqueue_webhook_delivery", _noop)


# --- settings CRUD ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_webhook_crud(client: AsyncClient):
    headers = await _headers(client)

    create = await client.post(
        "/api/settings/webhooks",
        headers=headers,
        json={"url": "https://example.com/hook", "events": ["signal.closed"], "description": "CRM"},
    )
    assert create.status_code == 200, create.text
    endpoint = create.json()
    assert endpoint["secret"].startswith("whsec_")
    assert endpoint["events"] == ["signal.closed"]
    assert endpoint["active"] is True

    listing = await client.get("/api/settings/webhooks", headers=headers)
    assert listing.status_code == 200
    body = listing.json()
    assert "signal.created" in body["events"]  # event catalogue for the UI
    assert any(e["id"] == endpoint["id"] for e in body["items"])

    bad = await client.post(
        "/api/settings/webhooks",
        headers=headers,
        json={"url": "https://example.com/x", "events": ["no.such.event"]},
    )
    assert bad.status_code == 400

    patched = await client.patch(
        f"/api/settings/webhooks/{endpoint['id']}",
        headers=headers,
        json={"active": False, "events": ["*"]},
    )
    assert patched.status_code == 200
    assert patched.json()["active"] is False
    assert patched.json()["events"] == ["*"]

    deleted = await client.delete(f"/api/settings/webhooks/{endpoint['id']}", headers=headers)
    assert deleted.status_code == 200
    listing2 = await client.get("/api/settings/webhooks", headers=headers)
    assert all(e["id"] != endpoint["id"] for e in listing2.json()["items"])


# --- delivery + signing ----------------------------------------------------------


@pytest.mark.asyncio
async def test_test_delivery_signs_payload(client: AsyncClient, monkeypatch):
    from app.services.webhooks import sign_payload

    headers = await _headers(client)
    captured: dict = {}

    async def fake_send(url, send_headers, body):
        captured.update(url=url, headers=send_headers, body=body)
        return _FakeResponse(200)

    monkeypatch.setattr("app.services.webhooks._send", fake_send)

    create = await client.post(
        "/api/settings/webhooks",
        headers=headers,
        json={"url": "https://example.com/hook", "events": ["*"]},
    )
    endpoint = create.json()

    test = await client.post(
        f"/api/settings/webhooks/{endpoint['id']}/test", headers=headers
    )
    assert test.status_code == 200, test.text
    delivery = test.json()
    assert delivery["status"] == "delivered"
    assert delivery["attempts"] == 1
    assert delivery["status_code"] == 200

    assert captured["url"] == "https://example.com/hook"
    assert captured["headers"]["X-Bokito-Event"] == "test.ping"
    expected = sign_payload(
        endpoint["secret"], captured["headers"]["X-Bokito-Timestamp"], captured["body"]
    )
    assert captured["headers"]["X-Bokito-Signature"] == expected


@pytest.mark.asyncio
async def test_failed_delivery_records_error(client: AsyncClient, monkeypatch):
    headers = await _headers(client)

    async def fake_send(url, send_headers, body):
        return _FakeResponse(500)

    monkeypatch.setattr("app.services.webhooks._send", fake_send)
    monkeypatch.setattr("app.services.webhooks._RETRY_DELAYS_S", (0.0, 0.0))

    create = await client.post(
        "/api/settings/webhooks",
        headers=headers,
        json={"url": "https://example.com/broken", "events": ["*"]},
    )
    endpoint = create.json()
    test = await client.post(f"/api/settings/webhooks/{endpoint['id']}/test", headers=headers)
    delivery = test.json()
    assert delivery["status"] == "failed"
    assert delivery["attempts"] == 3
    assert "500" in delivery["error"]

    listing = await client.get("/api/settings/webhooks", headers=headers)
    row = next(e for e in listing.json()["items"] if e["id"] == endpoint["id"])
    assert row["last_status"] == "failed"


# --- lifecycle emits -------------------------------------------------------------


@pytest.mark.asyncio
async def test_signal_lifecycle_emits_events(client: AsyncClient, monkeypatch, session_override):
    headers = await _headers(client)
    _patch_enqueue_noop(monkeypatch)

    create = await client.post(
        "/api/settings/webhooks",
        headers=headers,
        json={"url": "https://example.com/hook", "events": ["*"]},
    )
    endpoint = create.json()

    # Inbound signal (mock email channel) -> signal.created
    inbound = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={"subject": "Webhook test", "body_text": "Hello", "contact_email": "c@x.com"},
    )
    assert inbound.status_code == 200, inbound.text
    signal_id = inbound.json()["id"]

    deliveries = await client.get(
        f"/api/settings/webhooks/{endpoint['id']}/deliveries", headers=headers
    )
    events = [d["event"] for d in deliveries.json()["items"]]
    assert "signal.created" in events

    # Close it -> signal.closed
    close = await client.patch(
        f"/api/signals/{signal_id}", headers=headers, json={"status": "closed"}
    )
    assert close.status_code == 200, close.text
    deliveries = await client.get(
        f"/api/settings/webhooks/{endpoint['id']}/deliveries", headers=headers
    )
    events = [d["event"] for d in deliveries.json()["items"]]
    assert "signal.closed" in events

    # Deliver one pending row manually (worker path) and verify payload shape.
    from app.models.webhook import WebhookDelivery
    from app.services.webhooks import perform_delivery

    captured: dict = {}

    async def fake_send(url, send_headers, body):
        captured.update(body=body)
        return _FakeResponse(200)

    monkeypatch.setattr("app.services.webhooks._send", fake_send)
    row = (
        (
            await session_override.execute(
                select(WebhookDelivery).where(WebhookDelivery.event == "signal.closed")
            )
        )
        .scalars()
        .first()
    )
    delivered = await perform_delivery(session_override, row)
    assert delivered.status == "delivered"
    import json as _json

    payload = _json.loads(captured["body"])
    assert payload["event"] == "signal.closed"
    assert payload["data"]["signal_id"] == signal_id
    assert payload["data"]["status"] == "closed"


@pytest.mark.asyncio
async def test_unsubscribed_events_are_not_delivered(client: AsyncClient, monkeypatch):
    headers = await _headers(client)
    _patch_enqueue_noop(monkeypatch)

    create = await client.post(
        "/api/settings/webhooks",
        headers=headers,
        json={"url": "https://example.com/hook", "events": ["signal.closed"]},
    )
    endpoint = create.json()

    inbound = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={"subject": "No sub", "body_text": "Hello", "contact_email": "c@x.com"},
    )
    assert inbound.status_code == 200

    deliveries = await client.get(
        f"/api/settings/webhooks/{endpoint['id']}/deliveries", headers=headers
    )
    assert deliveries.json()["items"] == []


# --- public API v1 ---------------------------------------------------------------


async def _api_token(client: AsyncClient, headers: dict) -> str:
    r = await client.post(
        "/api/govern/tokens", headers=headers, json={"name": "Public API", "scopes": []}
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.mark.asyncio
async def test_public_api_requires_token(client: AsyncClient):
    r = await client.get("/api/public/v1/signals")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_public_api_create_and_read_signals(client: AsyncClient, monkeypatch):
    headers = await _headers(client)
    _patch_enqueue_noop(monkeypatch)
    token = await _api_token(client, headers)
    api = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/public/v1/signals",
        headers=api,
        json={
            "subject": "Order sync failed",
            "body": "Order 1234 failed to sync from the shop.",
            "contact_name": "Shop Bot",
            "priority": "high",
            "tags": ["shop", "sync"],
        },
    )
    assert create.status_code == 200, create.text
    created = create.json()
    assert created["channel"] == "api"
    assert created["priority"] == "high"
    assert created["tags"] == ["shop", "sync"]

    listing = await client.get("/api/public/v1/signals?channel=api", headers=api)
    assert listing.status_code == 200
    assert listing.json()["total"] >= 1
    assert any(s["id"] == created["id"] for s in listing.json()["items"])

    detail = await client.get(f"/api/public/v1/signals/{created['id']}", headers=api)
    assert detail.status_code == 200
    body = detail.json()
    assert body["subject"] == "Order sync failed"
    assert len(body["messages"]) == 1
    assert "Order 1234" in body["messages"][0]["body_text"]

    # The pushed signal also lands in the operator inbox.
    inbox = await client.get("/api/signals?channel=api", headers=headers)
    assert inbox.status_code == 200
    data = inbox.json()
    flat = data["items"] if isinstance(data, dict) and "items" in data else data
    assert any(s.get("id") == created["id"] for s in flat)


@pytest.mark.asyncio
async def test_public_api_validation(client: AsyncClient):
    headers = await _headers(client)
    token = await _api_token(client, headers)
    api = {"Authorization": f"Bearer {token}"}

    empty = await client.post(
        "/api/public/v1/signals", headers=api, json={"subject": "  ", "body": ""}
    )
    assert empty.status_code == 400

    bad_priority = await client.post(
        "/api/public/v1/signals",
        headers=api,
        json={"subject": "X", "body": "Y", "priority": "asap"},
    )
    assert bad_priority.status_code == 400

    bad_status = await client.get("/api/public/v1/signals?status=weird", headers=api)
    assert bad_status.status_code == 400
