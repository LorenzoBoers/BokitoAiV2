"""Channels: email (Resend), WhatsApp (Meta) with metering, widget, phone stub."""

from __future__ import annotations

import hashlib
import hmac
import json

from httpx import AsyncClient

from tests.conftest import auth


async def _connection(client: AsyncClient, owner: dict, **body) -> dict:
    r = await client.post("/api/connections", json=body, headers=auth(owner))
    assert r.status_code == 201, r.text
    return r.json()


async def _autonomous(client: AsyncClient, owner: dict) -> None:
    r = await client.post(
        "/api/govern/policy/posture", json={"posture": "autonomous"}, headers=auth(owner)
    )
    assert r.status_code == 200, r.text


async def test_email_inbound_creates_thread_and_agent_replies_with_disclosure(
    client: AsyncClient, owner: dict
) -> None:
    await _autonomous(client, owner)
    inbox = await _connection(
        client, owner, kind="email", provider="resend", name="Support", settings={"language": "en"}
    )
    payload = {
        "type": "email.received",
        "data": {
            "email_id": "em_1",
            "from": "Jane Doe <jane@customer.example>",
            "to": [inbox["address"]],
            "subject": "Invoice question",
            "text": "Hi, can you resend my invoice?",
            "headers": {"message-id": "<a1@customer.example>"},
        },
    }
    r = await client.post("/api/inbound/resend", json=payload)
    assert r.status_code == 200, r.text
    conv_id = r.json()["conversation_id"]
    assert r.json()["duplicate"] is False

    # Same Message-ID again is a no-op.
    r = await client.post("/api/inbound/resend", json=payload)
    assert r.json()["duplicate"] is True

    r = await client.get(f"/api/conversations/{conv_id}", headers=auth(owner))
    conv = r.json()
    assert conv["channel"] == "email"
    assert conv["subject"] == "Invoice question"
    assert conv["contact_id"]
    r = await client.get(f"/api/contacts/{conv['contact_id']}", headers=auth(owner))
    assert r.json()["email"] == "jane@customer.example"
    assert r.json()["name"] == "Jane Doe"

    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    messages = r.json()["items"]
    outbound = [m for m in messages if m["direction"] == "outbound"]
    assert outbound, messages
    assert "AI assistant" in outbound[-1]["body"]
    assert outbound[-1]["send_status"] == "sent"
    assert outbound[-1]["external_id"].endswith("@mock.bokito>")

    # A reply that references the outbound Message-ID threads into the same conversation.
    reply = {
        "type": "email.received",
        "data": {
            "email_id": "em_2",
            "from": "jane@customer.example",
            "to": [inbox["address"]],
            "subject": "Re: Invoice question",
            "text": "Thanks!",
            "headers": {
                "message-id": "<a2@customer.example>",
                "in-reply-to": outbound[-1]["external_id"],
            },
        },
    }
    r = await client.post("/api/inbound/resend", json=reply)
    assert r.json()["conversation_id"] == conv_id


async def test_email_unknown_recipient_and_disclosure_off(client: AsyncClient, owner: dict) -> None:
    r = await client.post(
        "/api/inbound/resend",
        json={"data": {"from": "x@y.z", "to": ["nobody@in.bokito.ai"], "text": "hi"}},
    )
    assert r.status_code == 404

    await _autonomous(client, owner)
    inbox = await _connection(
        client, owner, kind="email", provider="resend", name="Plain", disclosure_enabled=False
    )
    r = await client.post(
        "/api/inbound/resend",
        json={"data": {"from": "x@y.z", "to": [inbox["address"]], "subject": "Q", "text": "hi"}},
    )
    conv_id = r.json()["conversation_id"]
    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    outbound = [m for m in r.json()["items"] if m["direction"] == "outbound"]
    assert outbound and "AI assistant" not in outbound[-1]["body"]


def _meta_payload(phone_number_id: str, wa_id: str, text: str, msg_id: str) -> dict:
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": phone_number_id},
                            "contacts": [{"wa_id": wa_id, "profile": {"name": "Piet"}}],
                            "messages": [
                                {
                                    "from": wa_id,
                                    "id": msg_id,
                                    "type": "text",
                                    "text": {"body": text},
                                    "timestamp": "1700000000",
                                }
                            ],
                        }
                    }
                ]
            }
        ],
    }


async def test_whatsapp_webhook_signature_metering_and_status(
    client: AsyncClient, owner: dict, monkeypatch
) -> None:
    from bokito.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "meta_app_secret", "app-secret")
    monkeypatch.setattr(settings, "whatsapp_verify_token", "verify-me")

    r = await client.get(
        "/api/inbound/whatsapp",
        params={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42"},
    )
    assert r.status_code == 200 and r.text == "42"
    r = await client.get(
        "/api/inbound/whatsapp",
        params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42"},
    )
    assert r.status_code == 401

    await _autonomous(client, owner)
    await _connection(
        client,
        owner,
        kind="whatsapp",
        provider="meta",
        name="WA",
        credentials={"phone_number_id": "pn_1", "access_token": "tok"},
    )
    body = json.dumps(
        _meta_payload("pn_1", "31612345678", "Hallo, is mijn bestelling al klaar?", "wamid.1")
    ).encode()
    r = await client.post(
        "/api/inbound/whatsapp", content=body, headers={"content-type": "application/json"}
    )
    assert r.status_code == 401
    sig = "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()
    r = await client.post(
        "/api/inbound/whatsapp",
        content=body,
        headers={"content-type": "application/json", "X-Hub-Signature-256": sig},
    )
    assert r.status_code == 200, r.text
    assert r.json()["handled"] == 1

    r = await client.get("/api/conversations", params={"channel": "whatsapp"}, headers=auth(owner))
    conv = r.json()["items"][0]
    assert conv["external_id"] == "pn_1:31612345678"
    r = await client.get(f"/api/contacts/{conv['contact_id']}", headers=auth(owner))
    assert r.json()["phone"] == "+31612345678"
    assert r.json()["handles"]["whatsapp"] == "31612345678"

    r = await client.get(f"/api/conversations/{conv['id']}/messages", headers=auth(owner))
    outbound = [m for m in r.json()["items"] if m["direction"] == "outbound"]
    assert outbound and outbound[-1]["send_status"] == "sent"
    assert outbound[-1]["meta"]["category"] == "service"

    r = await client.get(f"/api/conversations/{conv['id']}/usage", headers=auth(owner))
    lines = {line["kind"]: line for line in r.json()["lines"]}
    assert "channel_message" in lines
    assert lines["channel_message"]["provider"] == "meta"
    assert lines["channel_message"]["cost_eur"] == 0.0

    status_body = json.dumps(
        {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": "pn_1"},
                                "statuses": [
                                    {
                                        "id": outbound[-1]["external_id"],
                                        "status": "delivered",
                                        "pricing": {"category": "service", "billable": False},
                                    }
                                ],
                            }
                        }
                    ]
                }
            ]
        }
    ).encode()
    sig = "sha256=" + hmac.new(b"app-secret", status_body, hashlib.sha256).hexdigest()
    r = await client.post(
        "/api/inbound/whatsapp",
        content=status_body,
        headers={"content-type": "application/json", "X-Hub-Signature-256": sig},
    )
    assert r.status_code == 200
    r = await client.get(f"/api/conversations/{conv['id']}/messages", headers=auth(owner))
    outbound = [m for m in r.json()["items"] if m["direction"] == "outbound"]
    assert outbound[-1]["send_status"] == "delivered"


def test_whatsapp_cost_outside_service_window() -> None:
    from datetime import timedelta

    from bokito.channels.whatsapp import message_cost
    from bokito.domain.base import utcnow
    from bokito.domain.conversation import Conversation

    conv = Conversation(last_inbound_at=utcnow() - timedelta(hours=30))
    category, cost = message_cost(conv)
    assert category == "utility" and cost > 0
    conv.last_inbound_at = utcnow() - timedelta(hours=1)
    assert message_cost(conv) == ("service", 0.0)


async def test_widget_session_and_thread(client: AsyncClient, owner: dict) -> None:
    await _autonomous(client, owner)
    widget = await _connection(
        client,
        owner,
        kind="widget",
        provider="bokito",
        name="Site",
        settings={"greeting": "Hi there", "language": "nl"},
    )
    key = widget["public_key"]
    r = await client.get(f"/api/livechat/{key}/config")
    assert r.status_code == 200, r.text
    assert r.json()["greeting"] == "Hi there"
    assert "AI-assistent" in r.json()["disclosure"]

    r = await client.post(
        f"/api/livechat/{key}/sessions",
        json={"name": "Visitor", "visitor_id": "v-1", "message": "Do you ship to Belgium?"},
    )
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    conv_id = r.json()["conversation_id"]

    r = await client.get(f"/api/livechat/{key}/messages", headers={"X-Visitor-Token": token})
    assert r.status_code == 200
    roles = [m["role"] for m in r.json()["messages"]]
    assert roles[0] == "visitor" and "agent" in roles

    r = await client.get(f"/api/livechat/{key}/messages", headers={"X-Visitor-Token": "bad.token"})
    assert r.status_code == 401

    r = await client.post(
        f"/api/livechat/{key}/messages",
        json={"body": "And to Germany?"},
        headers={"X-Visitor-Token": token},
    )
    assert r.status_code == 201
    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    inbound = [m for m in r.json()["items"] if m["direction"] == "inbound"]
    assert len(inbound) == 2

    # Resuming with the same visitor id returns the same conversation.
    r = await client.post(f"/api/livechat/{key}/sessions", json={"visitor_id": "v-1"})
    assert r.json()["conversation_id"] == conv_id

    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    conv_messages = r.json()["items"]
    assert all(m["kind"] == "message" for m in conv_messages if m["direction"] == "inbound")


async def test_phone_stub_creates_conversation_without_agent(
    client: AsyncClient, owner: dict
) -> None:
    await _autonomous(client, owner)
    phone = await _connection(client, owner, kind="phone", provider="stub", name="Main line")
    key = phone["public_key"]
    r = await client.post(
        f"/api/inbound/phone/{key}",
        json={"from": "+31201234567", "summary": "Wants a quote for 3 units", "call_id": "c1"},
    )
    assert r.status_code == 401
    r = await client.get(f"/api/connections/{phone['id']}", headers=auth(owner))
    # The secret is masked in the API; read it from the service for the test.
    import uuid

    from bokito import db as dbmod
    from bokito.domain.connection import Connection
    from bokito.services.connections import credentials_of

    async with dbmod.get_session_factory()() as session:
        conn = await session.get(Connection, uuid.UUID(phone["id"]))
        secret = credentials_of(conn)["secret"]
    r = await client.post(
        f"/api/inbound/phone/{key}",
        json={"from": "+31201234567", "summary": "Wants a quote for 3 units", "call_id": "c1"},
        headers={"X-Bokito-Secret": secret},
    )
    assert r.status_code == 200, r.text
    conv_id = r.json()["conversation_id"]
    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    messages = r.json()["items"]
    assert len(messages) == 1 and messages[0]["direction"] == "inbound"
    r = await client.get(f"/api/conversations/{conv_id}", headers=auth(owner))
    assert r.json()["channel"] == "phone"
    assert r.json()["subject"].startswith("Call from")
