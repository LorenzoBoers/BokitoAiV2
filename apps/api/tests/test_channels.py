"""Channel accounts, inbound webhooks, and contact pairing."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_channel_accounts_crud(client: AsyncClient, unparked_channels):
    headers = await _login(client)

    created = await client.post(
        "/api/channels/accounts",
        json={"channel": "slack", "provider": "slack", "address": "T123", "display_name": "Team"},
        headers=headers,
    )
    assert created.status_code == 200
    data = created.json()
    assert data["channel"] == "slack"
    assert data["inbound_secret"]

    listed = await client.get("/api/channels/accounts", headers=headers)
    assert listed.status_code == 200
    accounts = listed.json()["accounts"]
    channels = {a["channel"] for a in accounts}
    assert "slack" in channels
    # Seeded email account is included too
    assert "email" in channels

    deleted = await client.delete(f"/api/channels/accounts/{data['id']}", headers=headers)
    assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_email_inbound_webhook_creates_signal(client: AsyncClient):
    headers = await _login(client)

    account = await client.post(
        "/api/channels/accounts",
        json={"channel": "email", "provider": "mock", "address": "inbox@test.local"},
        headers=headers,
    )
    account_data = account.json()
    secret = account_data["inbound_secret"]

    # Wrong secret rejected
    bad = await client.post(
        f"/api/channels/email/inbound/{account_data['id']}",
        json={"from_address": "a@b.c", "subject": "x", "body_text": "y"},
        headers={"X-Bokito-Secret": "nope"},
    )
    assert bad.status_code == 403

    res = await client.post(
        f"/api/channels/email/inbound/{account_data['id']}",
        json={
            "from_address": "customer@example.com",
            "from_name": "Customer",
            "subject": "Invoice question",
            "body_text": "Where is my invoice?",
            "message_id": "msg-1",
            "thread_id": "thr-1",
        },
        headers={"X-Bokito-Secret": secret},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["processing"] is True
    signal_id = body["signal_id"]

    # Same provider message id is deduped (no second processing)
    res2 = await client.post(
        f"/api/channels/email/inbound/{account_data['id']}",
        json={
            "from_address": "customer@example.com",
            "subject": "Invoice question",
            "body_text": "Where is my invoice?",
            "message_id": "msg-1",
            "thread_id": "thr-1",
        },
        headers={"X-Bokito-Secret": secret},
    )
    assert res2.json()["signal_id"] == signal_id
    assert res2.json()["processing"] is False

    # Follow-up in the same provider thread lands on the same Signal
    res3 = await client.post(
        f"/api/channels/email/inbound/{account_data['id']}",
        json={
            "from_address": "customer@example.com",
            "subject": "Re: Invoice question",
            "body_text": "Any update?",
            "message_id": "msg-2",
            "thread_id": "thr-1",
        },
        headers={"X-Bokito-Secret": secret},
    )
    assert res3.json()["signal_id"] == signal_id

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert detail.status_code == 200
    assert len(detail.json()["messages"]) == 2


@pytest.mark.asyncio
async def test_reply_in_same_provider_thread_reopens_closed_signal(client: AsyncClient):
    """A follow-up in the same email thread reopens the closed conversation."""
    headers = await _login(client)
    account = await client.post(
        "/api/channels/accounts",
        json={"channel": "email", "provider": "mock", "address": "reopen@test.local"},
        headers=headers,
    )
    account_id = account.json()["id"]
    secret = account.json()["inbound_secret"]

    res = await client.post(
        f"/api/channels/email/inbound/{account_id}",
        json={
            "from_address": "returning@example.com",
            "subject": "Order status",
            "body_text": "Where is my order?",
            "message_id": "reopen-1",
            "thread_id": "thr-reopen",
        },
        headers={"X-Bokito-Secret": secret},
    )
    signal_id = res.json()["signal_id"]

    closed = await client.patch(
        f"/api/signals/{signal_id}", headers=headers, json={"status": "closed"}
    )
    assert closed.status_code == 200, closed.text

    res2 = await client.post(
        f"/api/channels/email/inbound/{account_id}",
        json={
            "from_address": "returning@example.com",
            "subject": "Re: Order status",
            "body_text": "It arrived, thanks!",
            "message_id": "reopen-2",
            "thread_id": "thr-reopen",
        },
        headers={"X-Bokito-Secret": secret},
    )
    assert res2.json()["signal_id"] == signal_id

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["thread"]["status"] == "open"
    assert len(detail.json()["messages"]) == 2


@pytest.mark.asyncio
async def test_contact_pairing_flow(client: AsyncClient):
    headers = await _login(client)

    account = await client.post(
        "/api/channels/accounts",
        json={
            "channel": "email",
            "provider": "mock",
            "address": "paired@test.local",
            "require_pairing": True,
        },
        headers=headers,
    )
    account_data = account.json()
    secret = account_data["inbound_secret"]
    assert account_data["require_pairing"] is True

    res = await client.post(
        f"/api/channels/email/inbound/{account_data['id']}",
        json={
            "from_address": "stranger@example.com",
            "subject": "Hello",
            "body_text": "First contact",
            "message_id": "pair-1",
        },
        headers={"X-Bokito-Secret": secret},
    )
    assert res.status_code == 200
    # Message stored but not processed until approved
    assert res.json()["processing"] is False

    contacts = await client.get("/api/channels/contacts?status=pending", headers=headers)
    pending = contacts.json()["contacts"]
    target = next(c for c in pending if c["address"] == "stranger@example.com")
    assert target["status"] == "pending"

    approved = await client.patch(
        f"/api/channels/contacts/{target['id']}", json={"status": "approved"}, headers=headers
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    # Next message from the approved contact is processed
    res2 = await client.post(
        f"/api/channels/email/inbound/{account_data['id']}",
        json={
            "from_address": "stranger@example.com",
            "subject": "Hello again",
            "body_text": "Second contact",
            "message_id": "pair-2",
        },
        headers={"X-Bokito-Secret": secret},
    )
    assert res2.json()["processing"] is True

    # Block the contact: messages are dropped
    blocked = await client.patch(
        f"/api/channels/contacts/{target['id']}", json={"status": "blocked"}, headers=headers
    )
    assert blocked.status_code == 200
    res3 = await client.post(
        f"/api/channels/email/inbound/{account_data['id']}",
        json={
            "from_address": "stranger@example.com",
            "subject": "Spam",
            "body_text": "Buy now",
            "message_id": "pair-3",
        },
        headers={"X-Bokito-Secret": secret},
    )
    assert res3.json().get("dropped") == "blocked_contact"


@pytest.mark.asyncio
async def test_contact_threads_include_cross_channel_history(client: AsyncClient, session_override):
    """A widget contact with the same email shares one thread history."""
    from datetime import datetime

    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.models.channel import Contact
    from app.models.signal import Signal

    headers = await _login(client)

    account = await client.post(
        "/api/channels/accounts",
        json={"channel": "email", "provider": "mock", "address": "cross@test.local"},
        headers=headers,
    )
    secret = account.json()["inbound_secret"]
    res = await client.post(
        f"/api/channels/email/inbound/{account.json()['id']}",
        json={
            "from_address": "sam@example.com",
            "from_name": "Sam",
            "subject": "Email question",
            "body_text": "Hi via email",
            "message_id": "cross-1",
        },
        headers={"X-Bokito-Secret": secret},
    )
    email_signal_id = res.json()["signal_id"]

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    widget_contact = Contact(
        tenant_id=tenant.id,
        channel="widget",
        address="sam@example.com",
        display_name="Sam",
        status="approved",
        last_seen_at=datetime.utcnow(),
    )
    session_override.add(widget_contact)
    await session_override.flush()
    widget_signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        source="widget",
        subject="Chat conversation",
        contact_id=widget_contact.id,
        contact_email="sam@example.com",
        contact_name="Sam",
        status="open",
        priority="normal",
        last_message_at=datetime.utcnow(),
    )
    session_override.add(widget_signal)
    await session_override.commit()

    email_contact = (
        await session_override.execute(
            select(Contact).where(
                Contact.tenant_id == tenant.id,
                Contact.channel == "email",
                Contact.address == "sam@example.com",
            )
        )
    ).scalar_one()

    r = await client.get(f"/api/channels/contacts/{email_contact.id}/threads", headers=headers)
    assert r.status_code == 200, r.text
    thread_ids = {t["id"] for t in r.json()["threads"]}
    assert email_signal_id in thread_ids
    assert str(widget_signal.id) in thread_ids


@pytest.mark.asyncio
async def test_parked_channel_cannot_be_connected(client: AsyncClient):
    """Slack ships parked: the connect endpoint refuses new accounts."""
    headers = await _login(client)

    res = await client.post(
        "/api/channels/accounts",
        json={"channel": "slack", "provider": "slack", "address": "T404"},
        headers=headers,
    )
    assert res.status_code == 400
    assert "not available" in res.json()["error"]["message"]


@pytest.mark.asyncio
async def test_parked_channel_hidden_from_channel_list(
    client: AsyncClient, unparked_channels, monkeypatch: pytest.MonkeyPatch
):
    """An existing Slack row disappears from /api/channels once slack is parked."""
    from app.config import get_settings

    headers = await _login(client)
    created = await client.post(
        "/api/channels/accounts",
        json={"channel": "slack", "provider": "slack", "address": "T777"},
        headers=headers,
    )
    assert created.status_code == 200

    listed = await client.get("/api/channels", headers=headers)
    assert listed.status_code == 200
    assert "slack" in {row["channel"] for row in listed.json()["channels"]}

    monkeypatch.setattr(get_settings(), "parked_channels", "slack")
    parked = await client.get("/api/channels", headers=headers)
    assert parked.status_code == 200
    assert "slack" not in {row["channel"] for row in parked.json()["channels"]}


@pytest.mark.asyncio
async def test_slack_url_verification(client: AsyncClient, unparked_channels):
    headers = await _login(client)
    account = await client.post(
        "/api/channels/accounts",
        json={"channel": "slack", "provider": "slack", "address": "T999"},
        headers=headers,
    )
    account_id = account.json()["id"]

    res = await client.post(
        f"/api/channels/slack/events/{account_id}",
        json={"type": "url_verification", "challenge": "abc123"},
    )
    assert res.status_code == 200
    assert res.json()["challenge"] == "abc123"

    # Event without valid signature is rejected
    res2 = await client.post(
        f"/api/channels/slack/events/{account_id}",
        json={"type": "event_callback", "event": {"type": "message", "text": "hi"}},
    )
    assert res2.status_code == 403


@pytest.mark.asyncio
async def test_slack_signed_event_creates_signal(client: AsyncClient, unparked_channels):
    import hashlib
    import hmac
    import json as jsonlib
    import time

    headers = await _login(client)
    account = await client.post(
        "/api/channels/accounts",
        json={
            "channel": "slack",
            "provider": "slack",
            "address": "T555",
            "credentials": {"signing_secret": "shh", "bot_token": ""},
        },
        headers=headers,
    )
    account_id = account.json()["id"]

    payload = {
        "type": "event_callback",
        "event": {
            "type": "message",
            "user": "U42",
            "text": "Hello from Slack",
            "channel": "C1",
            "ts": "1700000000.000100",
        },
    }
    body = jsonlib.dumps(payload).encode()
    ts = str(int(time.time()))
    sig = "v0=" + hmac.new(b"shh", f"v0:{ts}:{body.decode()}".encode(), hashlib.sha256).hexdigest()

    res = await client.post(
        f"/api/channels/slack/events/{account_id}",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Slack-Request-Timestamp": ts,
            "X-Slack-Signature": sig,
        },
    )
    assert res.status_code == 200
    assert res.json()["ok"] is True
    signal_id = res.json()["signal_id"]

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["thread"]["channel"] == "slack"
