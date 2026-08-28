"""Bokito relay addresses: explicit creation, limits, inbound webhook, outbound payload."""

import base64
import hashlib
import hmac
import json
import time

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

WEBHOOK_SECRET = "whsec_" + base64.b64encode(b"test-signing-key-1234").decode()


async def _headers(client: AsyncClient) -> dict[str, str]:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _svix_headers(body: bytes, *, secret: str = WEBHOOK_SECRET) -> dict[str, str]:
    msg_id = "msg_test_1"
    timestamp = str(int(time.time()))
    key = base64.b64decode(secret.removeprefix("whsec_"))
    signed = f"{msg_id}.{timestamp}.".encode() + body
    sig = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    return {
        "svix-id": msg_id,
        "svix-timestamp": timestamp,
        "svix-signature": f"v1,{sig}",
        "content-type": "application/json",
    }


async def _create_relay(client: AsyncClient, headers: dict[str, str], prefix: str):
    return await client.post(
        "/api/channels/email/relays", headers=headers, json={"prefix": prefix}
    )


def _receiving_configured(monkeypatch) -> None:
    """Platform-side Resend receiving, as it is in production."""
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "resend_webhook_secret", WEBHOOK_SECRET)
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")


@pytest.mark.asyncio
async def test_no_relay_until_created(client: AsyncClient):
    headers = await _headers(client)

    options = await client.get("/api/channels/email/relays", headers=headers)
    assert options.status_code == 200, options.text
    body = options.json()
    assert body["used"] == 0
    assert body["relays"] == []
    assert body["max_relays"] == 3
    assert body["domain"] == "in.bokito.ai"
    assert body["workspace_slug"] == "test"

    accounts = await client.get("/api/email/accounts", headers=headers)
    assert accounts.status_code == 200
    assert not [a for a in accounts.json() if a["provider"] == "bokito"]


@pytest.mark.asyncio
async def test_relay_address_uses_prefix_and_workspace_slug(client: AsyncClient, monkeypatch):
    headers = await _headers(client)
    _receiving_configured(monkeypatch)

    created = await _create_relay(client, headers, "Support Desk")
    assert created.status_code == 201, created.text
    row = created.json()
    # Prefix is slugified, the workspace slug keeps it unique on the domain.
    assert row["address"] == "support-desk-test@in.bokito.ai"
    assert row["kind"] == "email_relay"
    assert row["state"] == "active"
    assert row["capabilities"] == ["receive", "send"]
    assert "sync" not in row["capabilities"]

    listed = await client.get("/api/channels/email/relays", headers=headers)
    assert listed.json()["used"] == 1

    # Shows up as a sendable mailbox for the composer.
    accounts = await client.get("/api/email/accounts", headers=headers)
    relay = next(a for a in accounts.json() if a["provider"] == "bokito")
    assert relay["email_address"] == row["address"]
    assert relay["can_send"] is True


@pytest.mark.asyncio
async def test_relay_validation_limit_and_duplicates(client: AsyncClient):
    headers = await _headers(client)

    too_short = await _create_relay(client, headers, "ab")
    assert too_short.status_code == 400

    reserved = await _create_relay(client, headers, "postmaster")
    assert reserved.status_code == 400

    first = await _create_relay(client, headers, "info")
    assert first.status_code == 201

    duplicate = await _create_relay(client, headers, "info")
    assert duplicate.status_code == 409
    error = duplicate.json()["error"]
    assert error["suggestion"].endswith("@in.bokito.ai")
    assert error["suggestion"].startswith("info-")

    assert (await _create_relay(client, headers, "sales")).status_code == 201
    assert (await _create_relay(client, headers, "billing")).status_code == 201

    over_limit = await _create_relay(client, headers, "orders")
    assert over_limit.status_code == 409


@pytest.mark.asyncio
async def test_relay_setup_required_without_webhook_secret(client: AsyncClient, monkeypatch):
    headers = await _headers(client)
    _receiving_configured(monkeypatch)
    created = await _create_relay(client, headers, "support")
    assert created.status_code == 201
    assert created.json()["state"] == "active"

    # Mail cannot reach a relay while platform receiving is unconfigured, and
    # the row says so instead of claiming to be ready.
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "resend_webhook_secret", "")
    rows = (await client.get("/api/channels", headers=headers)).json()["channels"]
    relay = next(r for r in rows if r["kind"] == "email_relay")
    assert relay["state"] == "setup_required"
    assert relay["state_reason"] == "inbound_webhook"


@pytest.mark.asyncio
async def test_relay_can_be_removed(client: AsyncClient):
    headers = await _headers(client)
    created = await _create_relay(client, headers, "support")
    relay_id = created.json()["id"]

    removed = await client.delete(f"/api/channels/accounts/{relay_id}", headers=headers)
    assert removed.status_code == 200
    rows = (await client.get("/api/channels", headers=headers)).json()["channels"]
    assert not [r for r in rows if r["kind"] == "email_relay"]


@pytest.mark.asyncio
async def test_resend_inbound_webhook_ingests_signal(client: AsyncClient, monkeypatch):
    headers = await _headers(client)
    address = (await _create_relay(client, headers, "support")).json()["address"]

    from app.config import get_settings
    from app.routers import inbound as inbound_module

    settings = get_settings()
    monkeypatch.setattr(settings, "resend_webhook_secret", WEBHOOK_SECRET)
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")

    async def fake_fetch(email_id: str, api_key: str) -> dict:
        return {
            "html": "<p>Hello from a <b>customer</b></p>",
            "text": "Hello from a customer",
            "subject": "Need help with my order",
            "headers": {
                "Message-ID": "<abc-123@mail.example.com>",
                "From": "Jane Customer <jane@example.com>",
            },
        }

    async def fake_attachments(email_id: str, api_key: str, tenant_id) -> list[dict]:
        return []

    monkeypatch.setattr(inbound_module, "_fetch_received_email", fake_fetch)
    monkeypatch.setattr(inbound_module, "_fetch_attachments", fake_attachments)

    event = {
        "type": "email.received",
        "data": {
            "email_id": "re_inbound_1",
            "from": "jane@example.com",
            "to": [address],
            "subject": "Need help with my order",
        },
    }
    body = json.dumps(event).encode()

    # Wrong signature is rejected.
    bad = await client.post(
        "/api/inbound/resend",
        content=body,
        headers={**_svix_headers(body), "svix-signature": "v1,invalid"},
    )
    assert bad.status_code == 403

    res = await client.post("/api/inbound/resend", content=body, headers=_svix_headers(body))
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["ok"] is True
    signal_id = payload["signal_id"]

    # Replay of the same email_id dedupes into the same signal.
    replay = await client.post("/api/inbound/resend", content=body, headers=_svix_headers(body))
    assert replay.status_code == 200
    assert replay.json()["signal_id"] == signal_id
    assert replay.json()["processing"] is False

    # Unknown recipients are dropped without error (catch-all domain).
    other = {
        "type": "email.received",
        "data": {"email_id": "re_inbound_2", "to": ["nobody@in.bokito.ai"]},
    }
    other_body = json.dumps(other).encode()
    dropped = await client.post(
        "/api/inbound/resend", content=other_body, headers=_svix_headers(other_body)
    )
    assert dropped.status_code == 200
    assert dropped.json()["dropped"] == "unknown_recipient"


@pytest.mark.asyncio
async def test_format_outbound_relay_resend_payload():
    from app.channels.email import format_outbound
    from app.models.channel import ChannelAccount

    account = ChannelAccount(
        channel="email",
        address="support-test@in.bokito.ai",
        provider="bokito",
        display_name="Support",
    )
    payload = format_outbound(
        account,
        to_address="jane@example.com",
        subject="Re: Need help",
        body_text="We are on it.",
        in_reply_to="<abc-123@mail.example.com>",
        references="<abc-123@mail.example.com>",
    )
    assert payload["from"] == "Support <support-test@in.bokito.ai>"
    assert payload["to"] == ["jane@example.com"]
    assert payload["headers"]["In-Reply-To"] == "<abc-123@mail.example.com>"
    assert "We are on it." in payload["text"]
    assert payload["html"]
