"""Continue a website chat on WhatsApp: settings, link, claim by code."""

import hashlib
import hmac
import json
from datetime import datetime, timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import get_settings
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

APP_SECRET = "meta-test-secret"
PHONE_NUMBER_ID = "999888777666555"


async def _owner(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _setup(client: AsyncClient, headers: dict, monkeypatch) -> str:
    monkeypatch.setattr(get_settings(), "meta_app_secret", APP_SECRET)
    res = await client.post(
        "/api/channels/accounts",
        json={
            "channel": "whatsapp",
            "provider": "whatsapp_cloud",
            "address": PHONE_NUMBER_ID,
            "display_name": "Support WhatsApp",
            "credentials": {"access_token": "EAAG-test", "waba_id": "WABA1"},
        },
        headers=headers,
    )
    assert res.status_code == 200, res.text
    account_id = res.json()["id"]
    res = await client.put(
        "/api/settings/widget",
        json={"whatsapp_handover": {"enabled": True, "account_id": account_id, "number": "+31 97 0101"}},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    state = res.json()["whatsapp_handover"]
    assert state["enabled"] is True and state["ready"] is True and state["number_known"] is False

    async def fake_send(account, *, to_address, body_text):
        return "sent"

    from app.channels import whatsapp as whatsapp_adapter

    monkeypatch.setattr(whatsapp_adapter, "send_message", fake_send)
    return account_id


async def _widget_conversation(client: AsyncClient) -> str:
    r = await client.post(
        "/api/livechat/session/start", json={"tenant_subdomain": "test", "auth_mode": "anonymous"}
    )
    widget = {"Authorization": f"Bearer {r.json()['session_token']}"}
    r = await client.post("/api/livechat/conversation", headers=widget, json={})
    conversation_id = r.json()["conversation_id"]
    r = await client.post(
        "/api/livechat/session/identify",
        headers=widget,
        json={"name": "Vera Visitor", "email": "vera@example.com", "conversation_id": conversation_id},
    )
    assert r.status_code == 200, r.text
    return conversation_id


async def _post(client: AsyncClient, text: str, *, wamid: str, sender: str = "31655500011"):
    payload = {
        "object": "whatsapp_business_account",
        "entry": [{"id": "WABA1", "changes": [{"field": "messages", "value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "+31 97 0101", "phone_number_id": PHONE_NUMBER_ID},
            "contacts": [{"profile": {"name": "Vera"}, "wa_id": sender}],
            "messages": [{"from": sender, "id": wamid, "timestamp": "1700000000",
                          "type": "text", "text": {"body": text}}],
        }}]}],
    }
    body = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return await client.post(
        "/api/channels/whatsapp/webhook",
        content=body,
        headers={"Content-Type": "application/json", "X-Hub-Signature-256": signature},
    )


async def _offer(session, conversation_id: str, language: str = "nl") -> dict:
    from app.models.auth import Tenant
    from app.models.signal import Signal
    from app.services.whatsapp_handover import create_handover

    signal = await session.get(Signal, UUID(conversation_id))
    tenant = await session.get(Tenant, signal.tenant_id)
    result = await create_handover(session, tenant, signal, language=language)
    await session.commit()
    return result


@pytest.mark.asyncio
async def test_settings_validate_account(client: AsyncClient):
    headers = await _owner(client)
    res = await client.put(
        "/api/settings/widget",
        json={"whatsapp_handover": {"enabled": True, "account_id": ""}},
        headers=headers,
    )
    assert res.status_code == 422
    res = await client.get("/api/settings/widget", headers=headers)
    assert res.json()["whatsapp_handover"]["ready"] is False


@pytest.mark.asyncio
async def test_offer_builds_prefilled_link(client: AsyncClient, session_override, monkeypatch):
    headers = await _owner(client)
    await _setup(client, headers, monkeypatch)
    conversation_id = await _widget_conversation(client)

    first = await _offer(session_override, conversation_id)
    assert first["link"].startswith("https://wa.me/31970101?text=")
    assert f"ref {first['code']}" in first["prefilled_text"]
    assert first["prefilled_text"].startswith("Ik ga verder")
    again = await _offer(session_override, conversation_id, language="en")
    assert again["code"] == first["code"]
    assert again["prefilled_text"].startswith("I am continuing")


@pytest.mark.asyncio
async def test_claim_continues_conversation(client: AsyncClient, session_override, monkeypatch):
    from app.models.auth import User
    from app.models.channel import Contact
    from app.models.customer_verify import HandoverCode
    from app.models.signal import Signal
    from app.services.ai_handling import is_held
    from app.services.ownership import set_owner
    import app.routers.channels as channels_router

    queued: list[str] = []

    async def fake_enqueue(tenant_id, signal_id):
        queued.append(signal_id)

    monkeypatch.setattr(channels_router, "enqueue_signal_processing", fake_enqueue)
    headers = await _owner(client)
    await _setup(client, headers, monkeypatch)
    conversation_id = await _widget_conversation(client)

    widget = await session_override.get(Signal, UUID(conversation_id))
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user_id = user.id
    widget_contact_id = widget.contact_id
    set_owner(widget, "user", user_id)
    session_override.add(widget)
    await session_override.commit()
    offer = await _offer(session_override, conversation_id)

    res = await _post(client, offer["prefilled_text"], wamid="wamid.handover1")
    assert res.status_code == 200, res.text
    result = res.json()["results"][0]
    assert result["handover"] is True
    assert queued == []
    new_id = UUID(result["signal_id"])

    session_override.expire_all()
    whatsapp = await session_override.get(Signal, new_id)
    assert whatsapp.assignee_kind == "user" and whatsapp.assigned_user_id == user_id
    assert is_held(whatsapp)
    contact = await session_override.get(Contact, whatsapp.contact_id)
    assert contact.id == widget_contact_id or contact.merged_into_id == widget_contact_id or (
        await session_override.get(Contact, widget_contact_id)
    ).merged_into_id == contact.id
    widget = await session_override.get(Signal, UUID(conversation_id))
    assert widget.status == "closed"
    code = (
        await session_override.execute(select(HandoverCode).where(HandoverCode.code == offer["code"]))
    ).scalar_one()
    assert code.used_at is not None and code.to_signal_id == new_id

    detail = await client.get(f"/api/signals/{new_id}", headers=headers)
    bodies = [m["body_text"] for m in detail.json()["messages"]]
    assert any(b.startswith("Fijn dat je hier verder gaat") for b in bodies)

    # A used code does not hand over twice.
    res = await _post(client, offer["prefilled_text"], wamid="wamid.handover2", sender="31655500022")
    assert "handover" not in res.json()["results"][0]


@pytest.mark.asyncio
async def test_expired_or_missing_code_is_a_normal_conversation(
    client: AsyncClient, session_override, monkeypatch
):
    from app.models.customer_verify import HandoverCode
    import app.routers.channels as channels_router

    queued: list[str] = []

    async def fake_enqueue(tenant_id, signal_id):
        queued.append(signal_id)

    monkeypatch.setattr(channels_router, "enqueue_signal_processing", fake_enqueue)
    headers = await _owner(client)
    await _setup(client, headers, monkeypatch)
    conversation_id = await _widget_conversation(client)
    offer = await _offer(session_override, conversation_id)

    row = (
        await session_override.execute(select(HandoverCode).where(HandoverCode.code == offer["code"]))
    ).scalar_one()
    row.expires_at = datetime.utcnow() - timedelta(minutes=1)
    session_override.add(row)
    await session_override.commit()

    res = await _post(client, offer["prefilled_text"], wamid="wamid.expired1")
    assert "handover" not in res.json()["results"][0]
    res = await _post(client, "Hallo, ik heb een vraag", wamid="wamid.plain1", sender="31655500033")
    assert "handover" not in res.json()["results"][0]
    assert len(queued) == 2
