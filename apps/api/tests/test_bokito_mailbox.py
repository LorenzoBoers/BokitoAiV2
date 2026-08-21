"""Built-in Bokito address: lazy creation, Resend inbound webhook, outbound payload."""

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


@pytest.mark.asyncio
async def test_bokito_address_lazy_created_and_stable(client: AsyncClient):
    headers = await _headers(client)

    first = await client.get("/api/email/bokito-address", headers=headers)
    assert first.status_code == 200, first.text
    address = first.json()["address"]
    assert address.startswith("test-")
    assert address.endswith("@in.bokito.ai")
    assert first.json()["is_enabled"] is True

    # Idempotent: the same address on every call.
    second = await client.get("/api/email/bokito-address", headers=headers)
    assert second.json()["address"] == address

    # Listed among the mailboxes as always-connected.
    accounts = await client.get("/api/email/accounts", headers=headers)
    assert accounts.status_code == 200
    row = next(a for a in accounts.json() if a["provider"] == "bokito")
    assert row["email_address"] == address
    assert row["status"] == "connected"
    assert row["legacy_status"] == "active"


@pytest.mark.asyncio
async def test_resend_inbound_webhook_ingests_signal(client: AsyncClient, monkeypatch):
    headers = await _headers(client)
    address = (
        await client.get("/api/email/bokito-address", headers=headers)
    ).json()["address"]

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
async def test_format_outbound_bokito_resend_payload():
    from app.channels.email import format_outbound
    from app.models.channel import ChannelAccount

    account = ChannelAccount(
        channel="email",
        address="test-abc123@in.bokito.ai",
        provider="bokito",
        display_name="Test Tenant (Bokito)",
    )
    payload = format_outbound(
        account,
        to_address="jane@example.com",
        subject="Re: Need help",
        body_text="We are on it.",
        in_reply_to="<abc-123@mail.example.com>",
        references="<abc-123@mail.example.com>",
    )
    assert payload["from"] == "Test Tenant (Bokito) <test-abc123@in.bokito.ai>"
    assert payload["to"] == ["jane@example.com"]
    assert payload["headers"]["In-Reply-To"] == "<abc-123@mail.example.com>"
    assert "We are on it." in payload["text"]
    assert payload["html"]
