"""Cycle 28: email correctness — upload auth, reply threading, compose fidelity,
and inbound attachment ingestion."""

import base64
import json
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.models.signal import Signal, SignalMessage
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session: AsyncSession) -> Tenant:
    existing = (await session.execute(select(Tenant).limit(1))).scalars().first()
    if existing:
        return existing
    tenant = Tenant(slug=f"t-{uuid4().hex[:8]}", name="Fidelity Test")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


# --- Upload serving auth ------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_serving_requires_auth(client: AsyncClient):
    # Unauthenticated request first (the client cookie jar is still empty).
    probe = await client.get(f"/api/uploads/files/{uuid4()}/nope.txt")
    assert probe.status_code == 401

    headers = await _login(client)
    upload = await client.post(
        "/api/uploads",
        headers=headers,
        files={"file": ("invoice.txt", b"factuur 42", "text/plain")},
    )
    assert upload.status_code == 200
    from urllib.parse import urlparse

    # Request via the test host so the client cookie jar applies.
    path = urlparse(upload.json()["url"]).path

    # Bearer access.
    ok = await client.get(path, headers=headers)
    assert ok.status_code == 200
    assert ok.content == b"factuur 42"

    # Cookie access (login stored the refresh cookie in the client jar).
    cookie_ok = await client.get(path)
    assert cookie_ok.status_code == 200, cookie_ok.text

    # A token for a different tenant is rejected.
    from app.services.auth import create_access_token

    foreign = create_access_token(uuid4(), uuid4(), "other@tenant.test")
    forbidden = await client.get(path, headers={"Authorization": f"Bearer {foreign}"})
    assert forbidden.status_code == 403


# --- Reply threading ----------------------------------------------------------


@pytest.mark.asyncio
async def test_reply_context_uses_rfc_message_id(session_override: AsyncSession):
    from app.channels.outbound import _reply_context

    tenant = await _tenant(session_override)
    signal = Signal(
        tenant_id=tenant.id, channel="email", subject="BTW vraag", contact_email="k@x.nl"
    )
    session_override.add(signal)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            direction="inbound",
            external_id="graph-provider-id-123",
            metadata_json=json.dumps(
                {
                    "rfc_message_id": "<abc@mail.example.com>",
                    "references": "<root@mail.example.com>",
                }
            ),
        )
    )
    await session_override.commit()

    in_reply_to, references, provider_id = await _reply_context(session_override, signal.id)
    assert in_reply_to == "<abc@mail.example.com>"
    assert references == "<root@mail.example.com> <abc@mail.example.com>"
    assert provider_id == "graph-provider-id-123"


@pytest.mark.asyncio
async def test_reply_context_never_falls_back_to_provider_id(session_override: AsyncSession):
    from app.channels.outbound import _reply_context

    tenant = await _tenant(session_override)
    signal = Signal(tenant_id=tenant.id, channel="email", subject="x", contact_email="k@x.nl")
    session_override.add(signal)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            direction="inbound",
            external_id="provider-only-id",
        )
    )
    await session_override.commit()

    in_reply_to, references, provider_id = await _reply_context(session_override, signal.id)
    assert in_reply_to is None
    assert references is None
    assert provider_id == "provider-only-id"


def _account(provider: str) -> ChannelAccount:
    return ChannelAccount(
        tenant_id=uuid4(), channel="email", provider=provider, address="me@firm.nl"
    )


def test_gmail_format_includes_rfc_headers_thread_and_attachment():
    from app.channels.email import format_outbound

    payload = format_outbound(
        _account("gmail"),
        to_address="client@x.nl",
        subject="Re: BTW",
        body_text="Antwoord",
        in_reply_to="<abc@mail.example.com>",
        references="<root@x> <abc@mail.example.com>",
        thread_provider_id="gmail-thread-9",
        attachment_payloads=[{"name": "f.pdf", "mime": "application/pdf", "data": b"%PDF"}],
    )
    assert payload["threadId"] == "gmail-thread-9"
    raw = base64.urlsafe_b64decode(payload["raw"] + "===").decode("utf-8", "replace")
    assert "In-Reply-To: <abc@mail.example.com>" in raw
    assert "References: <root@x> <abc@mail.example.com>" in raw
    assert "f.pdf" in raw


def test_outlook_format_has_no_bogus_headers_and_carries_attachments():
    from app.channels.email import format_outbound

    payload = format_outbound(
        _account("outlook"),
        to_address="client@x.nl",
        subject="Re: BTW",
        body_text="Antwoord",
        cc="a@x.nl, b@x.nl",
        bcc="c@x.nl",
        in_reply_to="<abc@mail.example.com>",
        attachment_payloads=[{"name": "f.pdf", "mime": "application/pdf", "data": b"%PDF"}],
    )
    message = payload["message"]
    # Graph rejects In-Reply-To in internetMessageHeaders — must not be set.
    assert "internetMessageHeaders" not in message
    assert [r["emailAddress"]["address"] for r in message["ccRecipients"]] == ["a@x.nl", "b@x.nl"]
    assert [r["emailAddress"]["address"] for r in message["bccRecipients"]] == ["c@x.nl"]
    att = message["attachments"][0]
    assert att["@odata.type"] == "#microsoft.graph.fileAttachment"
    assert base64.b64decode(att["contentBytes"]) == b"%PDF"


@pytest.mark.asyncio
async def test_outlook_reply_uses_graph_reply_endpoint():
    from app.channels import email as email_adapter

    account = _account("outlook")
    account.credentials_json = json.dumps({"access_token": "tok"})
    calls: list[tuple[str, dict]] = []

    class _Resp:
        status_code = 202

    async def fake_post(url, payload, token):
        calls.append((url, payload))
        return _Resp()

    with patch.object(email_adapter, "_post_send", new=AsyncMock(side_effect=fake_post)):
        status = await email_adapter.send_via_provider(
            account,
            to_address="client@x.nl",
            subject="Re: BTW",
            body_text="Antwoord",
            reply_to_provider_id="graph-id-1",
        )
    assert status == "sent"
    url, payload = calls[0]
    assert url.endswith("/me/messages/graph-id-1/reply")
    # Subject is read-only on Graph replies.
    assert "subject" not in payload["message"]


# --- Compose fidelity ---------------------------------------------------------


@pytest.mark.asyncio
async def test_send_email_passes_cc_html_attachments(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    captured: dict = {}

    async def fake_deliver(session, signal, **kwargs):
        captured.update(kwargs)
        return "sent"

    attachment = {
        "id": "a1",
        "name": "jaarrekening.pdf",
        "mime": "application/pdf",
        "size": 4,
        "url": "http://localhost:8000/api/uploads/files/x/y.pdf",
    }
    with patch("app.routers.email.deliver_outbound", new=AsyncMock(side_effect=fake_deliver)):
        res = await client.post(
            "/api/email/send",
            headers=headers,
            json={
                "to_addresses": "client@x.nl",
                "cc": "cc@x.nl",
                "bcc": "bcc@x.nl",
                "subject": "Jaarrekening",
                "body_text": "Zie bijlage",
                "body_html": "<p>Zie <b>bijlage</b></p>",
                "attachments": [attachment],
            },
        )
    assert res.status_code == 200
    assert captured["cc"] == "cc@x.nl"
    assert captured["bcc"] == "bcc@x.nl"
    assert captured["body_html"] == "<p>Zie <b>bijlage</b></p>"
    assert captured["attachments"] == [attachment]

    from uuid import UUID

    msg_id = UUID(res.json()["id"])
    row = (
        await session_override.execute(select(SignalMessage).where(SignalMessage.id == msg_id))
    ).scalar_one()
    assert json.loads(row.attachments_json) == [attachment]
    assert json.loads(row.metadata_json)["cc"] == "cc@x.nl"
    assert row.body_html == "<p>Zie <b>bijlage</b></p>"


# --- Inbound attachment ingestion --------------------------------------------


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _FakeHttpClient:
    def __init__(self, responses: dict[str, dict]):
        self.responses = responses
        self.requested: list[str] = []

    async def get(self, url, headers=None, params=None):
        self.requested.append(url)
        for fragment, payload in self.responses.items():
            if fragment in url:
                return _FakeResponse(200, payload)
        return _FakeResponse(404, {})


@pytest.mark.asyncio
async def test_outlook_attachments_are_downloaded_and_served(
    session_override: AsyncSession, tmp_path
):
    from app.services import email_sync

    tenant = await _tenant(session_override)
    item = {"message_id": "m-1", "has_attachments": True, "attachments": []}
    fake = _FakeHttpClient(
        {
            "/me/messages/m-1/attachments": {
                "value": [
                    {
                        "@odata.type": "#microsoft.graph.fileAttachment",
                        "name": "factuur.pdf",
                        "contentType": "application/pdf",
                        "contentBytes": base64.b64encode(b"%PDF-1.7 test").decode(),
                    },
                    {"@odata.type": "#microsoft.graph.itemAttachment", "name": "skip.msg"},
                ]
            }
        }
    )
    with patch("app.services.storage.settings.storage_local_path", str(tmp_path)):
        await email_sync._hydrate_outlook_attachments(fake, "tok", tenant.id, item)

    assert len(item["attachments"]) == 1
    att = item["attachments"][0]
    assert att["name"] == "factuur.pdf"
    assert att["mime"] == "application/pdf"
    assert att["size"] == len(b"%PDF-1.7 test")
    assert "/api/uploads/files/" in att["url"]


@pytest.mark.asyncio
async def test_gmail_attachments_are_downloaded_and_served(
    session_override: AsyncSession, tmp_path
):
    from app.services import email_sync

    tenant = await _tenant(session_override)
    data = base64.urlsafe_b64encode(b"csv;data").decode()
    item = {
        "message_id": "g-1",
        "attachments": [
            {"filename": "omzet.csv", "mime": "text/csv", "size": 8, "attachment_id": "att-9"}
        ],
    }
    fake = _FakeHttpClient({"/messages/g-1/attachments/att-9": {"data": data}})
    with patch("app.services.storage.settings.storage_local_path", str(tmp_path)):
        await email_sync._hydrate_gmail_attachments(fake, "tok", tenant.id, item)

    assert len(item["attachments"]) == 1
    att = item["attachments"][0]
    assert att["name"] == "omzet.csv"
    assert "/api/uploads/files/" in att["url"]


@pytest.mark.asyncio
async def test_graph_parser_captures_rfc_id_and_attachment_flag():
    from app.services.email_sync import _parse_graph_message

    parsed = _parse_graph_message(
        {
            "id": "m-1",
            "subject": "Vraag",
            "from": {"emailAddress": {"address": "k@x.nl", "name": "Klant"}},
            "body": {"contentType": "html", "content": "<p>Hoi</p>"},
            "bodyPreview": "Hoi",
            "conversationId": "c-1",
            "hasAttachments": True,
            "internetMessageId": "<xyz@outlook.com>",
        }
    )
    assert parsed is not None
    assert parsed["rfc_message_id"] == "<xyz@outlook.com>"
    assert parsed["has_attachments"] is True


def test_gmail_parser_captures_rfc_id():
    from app.services.email_sync import _parse_gmail_message

    parsed = _parse_gmail_message(
        {
            "id": "g-1",
            "threadId": "t-1",
            "payload": {
                "headers": [
                    {"name": "From", "value": "Klant <k@x.nl>"},
                    {"name": "Subject", "value": "Vraag"},
                    {"name": "Message-ID", "value": "<gm@mail.gmail.com>"},
                    {"name": "References", "value": "<earlier@x>"},
                ]
            },
        }
    )
    assert parsed["rfc_message_id"] == "<gm@mail.gmail.com>"
    assert parsed["references"] == "<earlier@x>"


# --- Received time fidelity ----------------------------------------------------


def test_graph_parser_captures_received_time_as_naive_utc():
    from app.services.email_sync import _parse_graph_message

    parsed = _parse_graph_message(
        {
            "id": "m-2",
            "subject": "Bestelling",
            "from": {"emailAddress": {"address": "shop@ryses.be", "name": "Ryses"}},
            "body": {"contentType": "html", "content": "<p>Order</p>"},
            "conversationId": "c-2",
            # 14:18 local (UTC+2) == 12:18 UTC
            "receivedDateTime": "2026-08-18T12:18:00Z",
        }
    )
    assert parsed is not None
    received = parsed["received_at"]
    assert received is not None and received.tzinfo is None
    assert received.isoformat() == "2026-08-18T12:18:00"


def test_gmail_parser_captures_internal_date():
    from calendar import timegm

    from app.services.email_sync import _parse_gmail_message

    # internalDate is UTC epoch milliseconds.
    epoch_ms = timegm((2026, 8, 18, 12, 18, 0)) * 1000
    parsed = _parse_gmail_message(
        {
            "id": "g-2",
            "threadId": "t-2",
            "internalDate": str(epoch_ms),
            "payload": {"headers": [{"name": "From", "value": "Klant <k@x.nl>"}]},
        }
    )
    received = parsed["received_at"]
    assert received is not None and received.tzinfo is None
    assert received.isoformat() == "2026-08-18T12:18:00"


@pytest.mark.asyncio
async def test_ingest_uses_provider_received_time(session_override: AsyncSession):
    from datetime import datetime, timedelta

    from app.channels.base import InboundMessage, ingest_inbound

    tenant = await _tenant(session_override)
    received = datetime.utcnow() - timedelta(hours=3)
    inbound = InboundMessage(
        channel="email",
        source="outlook",
        sender_address=f"tijd-{uuid4().hex[:6]}@x.nl",
        subject="Timing",
        body_text="Wanneer kwam dit binnen?",
        external_id=f"ext-{uuid4().hex}",
        thread_external_id=f"conv-{uuid4().hex}",
        received_at=received,
    )
    signal, _ = await ingest_inbound(session_override, tenant.id, inbound)

    msg = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.external_id == inbound.external_id)
        )
    ).scalar_one()
    assert abs((msg.received_at - received).total_seconds()) < 1
    assert abs((msg.created_at - received).total_seconds()) < 1
    assert abs((signal.last_message_at - received).total_seconds()) < 1


def test_iso_marks_naive_datetimes_as_utc():
    from datetime import datetime

    from app.services.signal_threads import _iso

    assert _iso(datetime(2026, 8, 18, 12, 18)) == "2026-08-18T12:18:00Z"
    assert _iso(None) is None


def test_sync_window_days_defaults_and_clamps():
    from app.services.email_sync import account_sync_window_days

    assert account_sync_window_days({}) == 30
    assert account_sync_window_days({"sync_window_days": 90}) == 90
    assert account_sync_window_days({"sync_window_days": 0}) == 0
    assert account_sync_window_days({"sync_window_days": -5}) == 0
    assert account_sync_window_days({"sync_window_days": "garbage"}) == 30


def test_html_to_text_skips_style_script_and_head():
    from app.services.email_sync import html_to_text

    # Google-style notification mail: CSS wrapped in an HTML comment inside
    # <style>. That comment body must never leak into previews/agent text.
    html = (
        "<html><head><title>Alert</title>"
        "<style><!-- * {box-sizing:border-box} body {margin:0; padding:0} "
        "a[x-apple-data-detectors] {color:inherit!important} --></style>"
        "</head><body>"
        "<script>var tracked = true;</script>"
        "<p>A new sign-in was detected.</p>"
        "<p>If this was you, no action is needed.</p>"
        "</body></html>"
    )
    text = html_to_text(html)
    assert "box-sizing" not in text
    assert "tracked" not in text
    assert "Alert" not in text
    assert "A new sign-in was detected." in text
    assert "If this was you, no action is needed." in text
