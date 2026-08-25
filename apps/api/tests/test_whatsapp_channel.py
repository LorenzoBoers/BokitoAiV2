"""WhatsApp Cloud API channel: webhook verification, inbound ingest, outbound."""

import hashlib
import hmac
import json

import pytest
from httpx import AsyncClient

from app.config import get_settings
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

APP_SECRET = "meta-test-secret"
VERIFY_TOKEN = "verify-me"
PHONE_NUMBER_ID = "111222333444555"


async def _login(client: AsyncClient) -> dict:
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _configure(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "meta_app_secret", APP_SECRET)
    monkeypatch.setattr(settings, "whatsapp_verify_token", VERIFY_TOKEN)


def _sign(body: bytes) -> str:
    return "sha256=" + hmac.new(APP_SECRET.encode(), body, hashlib.sha256).hexdigest()


def _webhook_payload(
    *,
    phone_number_id: str = PHONE_NUMBER_ID,
    messages: list[dict] | None = None,
    statuses: list[dict] | None = None,
    contacts: list[dict] | None = None,
) -> dict:
    value: dict = {
        "messaging_product": "whatsapp",
        "metadata": {"display_phone_number": "+3197000000000", "phone_number_id": phone_number_id},
    }
    if contacts is not None:
        value["contacts"] = contacts
    if messages is not None:
        value["messages"] = messages
    if statuses is not None:
        value["statuses"] = statuses
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": "WABA1", "changes": [{"field": "messages", "value": value}]}],
    }


def _text_message(wamid: str, body: str, *, sender: str = "31612345678") -> dict:
    return {
        "from": sender,
        "id": wamid,
        "timestamp": "1700000000",
        "type": "text",
        "text": {"body": body},
    }


async def _create_account(client: AsyncClient, headers: dict) -> dict:
    res = await client.post(
        "/api/channels/accounts",
        json={
            "channel": "whatsapp",
            "provider": "whatsapp_cloud",
            "address": PHONE_NUMBER_ID,
            "display_name": "Test nummer",
            "credentials": {"access_token": "EAAG-test", "waba_id": "WABA1"},
        },
        headers=headers,
    )
    assert res.status_code == 200
    return res.json()


async def _post_webhook(client: AsyncClient, payload: dict, *, signature: str | None = None):
    body = json.dumps(payload).encode()
    return await client.post(
        "/api/channels/whatsapp/webhook",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Hub-Signature-256": signature if signature is not None else _sign(body),
        },
    )


@pytest.mark.asyncio
async def test_webhook_verification_handshake(client: AsyncClient, monkeypatch):
    _configure(monkeypatch)
    res = await client.get(
        "/api/channels/whatsapp/webhook",
        params={"hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "c-42"},
    )
    assert res.status_code == 200
    assert res.text == "c-42"

    bad = await client.get(
        "/api/channels/whatsapp/webhook",
        params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "c-42"},
    )
    assert bad.status_code == 403


@pytest.mark.asyncio
async def test_webhook_rejects_invalid_signature(client: AsyncClient, monkeypatch):
    _configure(monkeypatch)
    payload = _webhook_payload(messages=[_text_message("wamid.sig", "Hoi")])
    res = await _post_webhook(client, payload, signature="sha256=deadbeef")
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_inbound_message_creates_signal_and_dedupes(client: AsyncClient, monkeypatch):
    _configure(monkeypatch)
    headers = await _login(client)
    await _create_account(client, headers)

    payload = _webhook_payload(
        contacts=[{"profile": {"name": "Jan Jansen"}, "wa_id": "31612345678"}],
        messages=[_text_message("wamid.msg1", "Waar blijft mijn bestelling?")],
    )
    res = await _post_webhook(client, payload)
    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == 1
    signal_id = results[0]["signal_id"]

    # Same wamid is deduped onto the same signal.
    res2 = await _post_webhook(client, payload)
    assert res2.json()["results"][0]["signal_id"] == signal_id

    # A follow-up from the same number threads into the same Signal.
    followup = _webhook_payload(
        contacts=[{"profile": {"name": "Jan Jansen"}, "wa_id": "31612345678"}],
        messages=[_text_message("wamid.msg2", "Is er al nieuws?")],
    )
    res3 = await _post_webhook(client, followup)
    assert res3.json()["results"][0]["signal_id"] == signal_id

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert detail.status_code == 200
    thread = detail.json()["thread"]
    assert thread["channel"] == "whatsapp"
    assert len(detail.json()["messages"]) == 2


@pytest.mark.asyncio
async def test_unknown_phone_number_id_is_ignored(client: AsyncClient, monkeypatch):
    _configure(monkeypatch)
    payload = _webhook_payload(
        phone_number_id="000000000000",
        messages=[_text_message("wamid.unknown", "Hallo")],
    )
    res = await _post_webhook(client, payload)
    assert res.status_code == 200
    assert res.json()["results"][0]["ignored"] == "no_account"


@pytest.mark.asyncio
async def test_status_updates_are_ignored(client: AsyncClient, monkeypatch):
    _configure(monkeypatch)
    headers = await _login(client)
    await _create_account(client, headers)

    payload = _webhook_payload(
        statuses=[{"id": "wamid.out1", "status": "delivered", "recipient_id": "31612345678"}]
    )
    res = await _post_webhook(client, payload)
    assert res.status_code == 200
    assert res.json()["results"] == []


@pytest.mark.asyncio
async def test_media_message_gets_placeholder(client: AsyncClient, monkeypatch):
    _configure(monkeypatch)
    headers = await _login(client)
    await _create_account(client, headers)

    payload = _webhook_payload(
        contacts=[{"profile": {"name": "Piet"}, "wa_id": "31687654321"}],
        messages=[
            {
                "from": "31687654321",
                "id": "wamid.media1",
                "timestamp": "1700000100",
                "type": "image",
                "image": {"id": "MEDIA1", "mime_type": "image/jpeg", "caption": "Kapotte lamp"},
            }
        ],
    )
    res = await _post_webhook(client, payload)
    assert res.status_code == 200
    signal_id = res.json()["results"][0]["signal_id"]

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    message = detail.json()["messages"][0]
    assert "[Image received]" in message["body_text"]
    assert "Kapotte lamp" in message["body_text"]


def test_format_outbound_payload():
    from app.channels.whatsapp import format_outbound

    payload = format_outbound("31612345678", "Uw bestelling is onderweg.")
    assert payload["messaging_product"] == "whatsapp"
    assert payload["to"] == "31612345678"
    assert payload["type"] == "text"
    assert payload["text"]["body"] == "Uw bestelling is onderweg."


def test_send_error_status_mapping():
    from app.channels.whatsapp import _send_error_status

    assert (
        _send_error_status(400, {"error": {"code": 131047, "message": "Re-engagement message"}})
        == "failed:outside_service_window"
    )
    assert _send_error_status(401, {"error": {"code": 190, "message": "expired"}}) == "failed:auth"
    assert _send_error_status(400, {"error": {"code": 100, "message": "bad param"}}) == "failed:bad param"


@pytest.mark.asyncio
async def test_reply_delivers_via_whatsapp_adapter(client: AsyncClient, monkeypatch):
    _configure(monkeypatch)
    headers = await _login(client)
    await _create_account(client, headers)

    payload = _webhook_payload(
        contacts=[{"profile": {"name": "Jan"}, "wa_id": "31611111111"}],
        messages=[_text_message("wamid.reply1", "Kan ik ruilen?", sender="31611111111")],
    )
    res = await _post_webhook(client, payload)
    signal_id = res.json()["results"][0]["signal_id"]

    sent: dict = {}

    async def fake_send(account, *, to_address, body_text):
        sent["to"] = to_address
        sent["body"] = body_text
        return "sent"

    from app.channels import whatsapp as whatsapp_adapter

    monkeypatch.setattr(whatsapp_adapter, "send_message", fake_send)

    reply = await client.post(
        f"/api/signals/{signal_id}/reply",
        json={"body_text": "Ja hoor, dat kan binnen 30 dagen."},
        headers=headers,
    )
    assert reply.status_code == 200
    assert sent["to"] == "31611111111"
    assert sent["body"] == "Ja hoor, dat kan binnen 30 dagen."
