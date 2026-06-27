"""Integration tests for the Complete Messaging Product plan."""

from __future__ import annotations

import base64
import json
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.channel import ChannelAccount
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalMessage


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_upload_attachment_local(client: AsyncClient):
    headers = await _auth_headers(client)
    png_bytes = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    res = await client.post(
        "/api/uploads",
        headers=headers,
        files={"file": ("pixel.png", png_bytes, "image/png")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "pixel.png"
    assert body["mime"] == "image/png"
    assert body["size"] == len(png_bytes)
    assert body["url"]
    assert body.get("schema_version") == 1


@pytest.mark.asyncio
async def test_notes_crud(client: AsyncClient):
    headers = await _auth_headers(client)
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "internal",
            "source": "mock",
            "subject": "Notes thread",
            "body_text": "Start",
        },
    )
    signal_id = ingest.json()["id"]

    created = await client.post(
        f"/api/signals/{signal_id}/notes",
        headers=headers,
        json={"body_text": "First note"},
    )
    assert created.status_code == 200
    note_id = created.json()["id"]

    listed = await client.get(f"/api/signals/{signal_id}/notes", headers=headers)
    assert listed.status_code == 200
    assert any(n["id"] == note_id for n in listed.json())

    updated = await client.patch(
        f"/api/signals/{signal_id}/notes/{note_id}",
        headers=headers,
        json={"body_text": "Updated note"},
    )
    assert updated.status_code == 200
    assert updated.json()["body_text"] == "Updated note"

    deleted = await client.delete(f"/api/signals/{signal_id}/notes/{note_id}", headers=headers)
    assert deleted.status_code == 200

    listed_after = await client.get(f"/api/signals/{signal_id}/notes", headers=headers)
    assert all(n["id"] != note_id for n in listed_after.json())


@pytest.mark.asyncio
async def test_reply_persists_attachments(client: AsyncClient):
    headers = await _auth_headers(client)
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "internal",
            "source": "mock",
            "subject": "Attach thread",
            "body_text": "Hello",
        },
    )
    signal_id = ingest.json()["id"]
    attachment = {
        "id": str(uuid4()),
        "name": "doc.pdf",
        "mime": "application/pdf",
        "size": 42,
        "url": "/api/uploads/files/test/doc.pdf",
        "schema_version": 1,
    }

    reply = await client.post(
        f"/api/signals/{signal_id}/reply",
        headers=headers,
        json={"body_text": "See attached", "attachments": [attachment]},
    )
    assert reply.status_code == 200
    assert reply.json()["attachments"] == [attachment]

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    outbound = [m for m in detail.json()["messages"] if m["direction"] == "outbound"]
    assert outbound
    assert outbound[-1]["attachments"] == [attachment]


@pytest.mark.asyncio
async def test_thread_includes_decision_options(client: AsyncClient, session_override):
    from app.models.auth import Tenant

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()

    signal = Signal(tenant_id=tenant.id, channel="internal", subject="Decision thread")
    session_override.add(signal)
    await session_override.flush()

    notification = Notification(
        tenant_id=tenant.id,
        kind="decision_request",
        title="Ship it?",
        body="Ready",
    )
    session_override.add(notification)
    await session_override.flush()

    options = [{"id": "approve", "label": "Approve"}, {"id": "reject", "label": "Reject"}]
    decision = DecisionRequest(
        tenant_id=tenant.id,
        notification_id=notification.id,
        signal_id=signal.id,
        title="Ship it?",
        summary="Ready",
        options_json=json.dumps(options),
        status="awaiting_human",
    )
    session_override.add(decision)
    await session_override.flush()

    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="decision_request",
        direction="inbound",
        body_text="Ship it?",
        decision_id=decision.id,
    )
    session_override.add(message)
    await session_override.commit()

    detail = await client.get(f"/api/signals/{signal.id}", headers=headers)
    assert detail.status_code == 200
    decision_msgs = [m for m in detail.json()["messages"] if m["kind"] == "decision_request"]
    assert decision_msgs
    payload = decision_msgs[0].get("payload") or {}
    assert payload.get("decision", {}).get("options") == options


@pytest.mark.asyncio
async def test_decisions_list_includes_signal_id(client: AsyncClient, session_override):
    from app.models.auth import Tenant

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = Signal(tenant_id=tenant.id, channel="internal", subject="Linked")
    session_override.add(signal)
    await session_override.flush()
    session_override.add(
        DecisionRequest(
            tenant_id=tenant.id,
            signal_id=signal.id,
            title="Linked decision",
            summary="Has thread",
            status="awaiting_human",
            options_json="[]",
        )
    )
    await session_override.commit()

    listed = await client.get("/api/notifications/decisions?status=awaiting_human", headers=headers)
    assert listed.status_code == 200
    match = next((d for d in listed.json() if d["title"] == "Linked decision"), None)
    assert match is not None
    assert match["signal_id"] == str(signal.id)


def test_email_format_outbound_html_and_threading():
    from app.channels.email import format_outbound

    account = ChannelAccount(
        tenant_id=uuid4(),
        channel="email",
        address="support@test.local",
        provider="gmail",
        settings_json=json.dumps({"signature_html": "<p>Best,<br>Team</p>"}),
    )
    payload = format_outbound(
        account,
        to_address="customer@example.com",
        subject="Re: Billing",
        body_text="Thanks for reaching out.",
        body_html="<p>Thanks for reaching out.</p>",
        cc="cc@example.com",
        bcc="bcc@example.com",
        in_reply_to="<msg-123@test>",
        references="<msg-122@test> <msg-123@test>",
    )
    assert "raw" in payload
    decoded = base64.urlsafe_b64decode(payload["raw"] + "==").decode("utf-8", "replace")
    assert "In-Reply-To: <msg-123@test>" in decoded
    assert "References:" in decoded
    assert "Cc: cc@example.com" in decoded
    assert "text/html" in decoded
    assert "Best,<br>Team" in decoded


@pytest.mark.asyncio
async def test_ingest_inbound_preserves_html_and_attachments(session_override):
    from app.channels.base import InboundMessage, ingest_inbound
    from app.models.auth import Tenant

    tenant = Tenant(slug="ingest-test", name="Ingest Test")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    inbound = InboundMessage(
        channel="email",
        source="mock",
        sender_address="sender@test.com",
        subject="HTML mail",
        body_text="Plain fallback",
        external_id=f"ext-{uuid4()}",
        metadata={
            "body_html": "<p><strong>Hello</strong></p>",
            "attachments": [{"id": "a1", "name": "file.pdf", "mime": "application/pdf", "size": 10, "url": "/x"}],
        },
    )
    signal, should_process = await ingest_inbound(session_override, tenant.id, inbound)
    assert should_process is True
    msg = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == signal.id)
        )
    ).scalar_one()
    assert msg.body_html == "<p><strong>Hello</strong></p>"
    assert json.loads(msg.attachments_json)[0]["name"] == "file.pdf"


@pytest.mark.asyncio
async def test_apply_attachments_injects_image_block():
    from app.services.agent.loop import AgentLoop

    loop = AgentLoop(AsyncMock(), uuid4(), None)
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    attachments = [{"name": "pixel.png", "mime": "image/png", "url": "http://test/pixel.png"}]
    messages = [{"role": "user", "content": "What is this?"}]

    with patch("app.services.storage.fetch_attachment_bytes", new=AsyncMock(return_value=png)):
        updated = await loop._apply_attachments_to_messages(messages, attachments)

    content = updated[0]["content"]
    assert isinstance(content, list)
    assert content[0]["type"] == "text"
    assert content[1]["type"] == "image"
    assert content[1]["source"]["media_type"] == "image/png"


def test_gmail_html_and_attachment_extraction():
    from app.services import email_sync

    payload = {
        "mimeType": "multipart/mixed",
        "parts": [
            {
                "mimeType": "multipart/alternative",
                "parts": [
                    {"mimeType": "text/plain", "body": {"data": base64.urlsafe_b64encode(b"Plain").decode()}},
                    {
                        "mimeType": "text/html",
                        "body": {"data": base64.urlsafe_b64encode(b"<p>HTML</p>").decode()},
                    },
                ],
            },
            {
                "mimeType": "application/pdf",
                "filename": "invoice.pdf",
                "body": {"attachmentId": "att-1", "size": 100},
            },
        ],
    }
    assert email_sync._extract_gmail_html(payload) == "<p>HTML</p>"
    attachments = email_sync._extract_gmail_attachments(payload)
    assert len(attachments) == 1
    assert attachments[0]["filename"] == "invoice.pdf"
