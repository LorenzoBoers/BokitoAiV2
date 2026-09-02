"""Unit tests for SMTP/IMAP mailbox provider (mocked sockets, no live mail)."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.models.channel import ChannelAccount
from app.services import smtp_imap
from app.services.channel_registry import resolve_channel
from app.services.smtp_imap import (
    SmtpImapError,
    fetch_inbox_since_sync,
    is_connected,
    normalize_credentials,
    send_smtp_sync,
    verify_mailbox_sync,
)


def _creds(**overrides):
    base = {
        "username": "user@example.com",
        "password": "secret",
        "imap_host": "imap.example.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_ssl": False,
        "smtp_starttls": True,
        "verified_at": "",
    }
    base.update(overrides)
    return base


def test_normalize_credentials_defaults():
    out = normalize_credentials(
        {
            "email": "a@example.com",
            "password": "x",
            "imap_host": "imap.example.com",
            "smtp_host": "smtp.example.com",
        }
    )
    assert out["username"] == "a@example.com"
    assert out["imap_port"] == 993
    assert out["imap_ssl"] is True
    assert out["smtp_port"] == 587
    assert out["smtp_starttls"] is True
    assert out["smtp_ssl"] is False


def test_normalize_credentials_rejects_missing_host():
    with pytest.raises(SmtpImapError) as exc:
        normalize_credentials(
            {"email": "a@example.com", "password": "x", "imap_host": "", "smtp_host": "s"}
        )
    assert exc.value.code == "invalid_imap"


def test_is_connected_requires_verified_at():
    assert not is_connected(_creds())
    assert is_connected(_creds(verified_at="2026-01-01T00:00:00+00:00"))


def test_verify_mailbox_stamps_verified_at():
    imap = MagicMock()
    smtp = MagicMock()
    with (
        patch.object(smtp_imap, "_imap_connect", return_value=imap),
        patch.object(smtp_imap, "_smtp_connect", return_value=smtp),
    ):
        out = verify_mailbox_sync(_creds())
    assert out["verified_at"]
    datetime.fromisoformat(out["verified_at"])
    imap.logout.assert_called()
    smtp.quit.assert_called()


def test_verify_mailbox_maps_network_error():
    with patch.object(
        smtp_imap,
        "_imap_connect",
        side_effect=SmtpImapError("network_unreachable", "unreachable"),
    ):
        with pytest.raises(SmtpImapError) as exc:
            verify_mailbox_sync(_creds())
    assert exc.value.code == "network_unreachable"


def test_fetch_inbox_advances_uid_cursor():
    raw = (
        b"From: Alice <alice@example.com>\r\n"
        b"To: user@example.com\r\n"
        b"Subject: Hello\r\n"
        b"Message-ID: <msg-1@example.com>\r\n"
        b"Date: Mon, 1 Jan 2024 12:00:00 +0000\r\n"
        b"Content-Type: text/plain; charset=utf-8\r\n"
        b"\r\n"
        b"Body text\r\n"
    )
    client = MagicMock()
    client.select.return_value = ("OK", [b"1"])
    client.uid.side_effect = [
        ("OK", [b"10 11"]),
        ("OK", [(b"11 (UID 11 RFC822 {n})", raw)]),
    ]
    with patch.object(smtp_imap, "_imap_connect", return_value=client):
        items, cursor = fetch_inbox_since_sync(_creds(verified_at="x"), "10")
    assert cursor == "11"
    assert len(items) == 1
    assert items[0]["from_address"] == "alice@example.com"
    assert items[0]["subject"] == "Hello"
    assert items[0]["body_text"].strip() == "Body text"
    assert items[0]["rfc_message_id"] == "<msg-1@example.com>"


def test_send_smtp_builds_headers():
    captured: dict = {}

    class FakeSMTP:
        def send_message(self, msg, from_addr=None, to_addrs=None):
            captured["subject"] = msg["Subject"]
            captured["to"] = msg["To"]
            captured["in_reply_to"] = msg["In-Reply-To"]
            captured["references"] = msg["References"]
            captured["from_addr"] = from_addr
            captured["to_addrs"] = to_addrs
            # HTML alternative present
            captured["is_multipart"] = msg.is_multipart()

        def quit(self):
            pass

    with patch.object(smtp_imap, "_smtp_connect", return_value=FakeSMTP()):
        send_smtp_sync(
            _creds(verified_at="x"),
            from_address="user@example.com",
            from_display_name="Support",
            to_address="alice@example.com",
            subject="Re: Hello",
            body_text="Hi",
            body_html="<p>Hi</p>",
            in_reply_to="<msg-1@example.com>",
            references="<msg-1@example.com>",
        )
    assert captured["subject"] == "Re: Hello"
    assert captured["to"] == "alice@example.com"
    assert captured["in_reply_to"] == "<msg-1@example.com>"
    assert captured["references"] == "<msg-1@example.com>"
    assert captured["is_multipart"] is True
    assert "alice@example.com" in captured["to_addrs"]


def test_registry_smtp_imap_connected_without_access_token():
    import json

    account = ChannelAccount(
        tenant_id=uuid4(),
        channel="email",
        provider="smtp_imap",
        address="user@example.com",
        display_name="User",
        is_enabled=True,
        credentials_json=json.dumps(_creds(verified_at="2026-01-01T00:00:00+00:00")),
        settings_json=json.dumps(
            {
                "sync_folders": [
                    {"id": "inbox", "display_name": "Inbox", "is_selected": True}
                ],
                "last_sync_at": datetime.utcnow().isoformat(),
            }
        ),
    )
    row = resolve_channel(account)
    assert row["capabilities"] == ["receive", "send", "sync"]
    credentials = next(c for c in row["checks"] if c["id"] == "credentials")
    assert credentials["state"] == "ok"
    assert row["state"] in ("active", "connecting", "degraded")


def test_registry_smtp_imap_not_verified():
    import json

    account = ChannelAccount(
        tenant_id=uuid4(),
        channel="email",
        provider="smtp_imap",
        address="user@example.com",
        display_name="User",
        is_enabled=True,
        credentials_json=json.dumps(_creds(verified_at="")),
        settings_json="{}",
    )
    row = resolve_channel(account)
    credentials = next(c for c in row["checks"] if c["id"] == "credentials")
    assert credentials["state"] == "fail"
    assert row["state"] == "action_required"
