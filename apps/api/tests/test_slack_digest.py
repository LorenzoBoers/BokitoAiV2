"""Slack decision notify (Block Kit + interactions) and digest mails."""

import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock
from urllib.parse import urlencode

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_decision_blocks_carry_decision_id():
    from app.models.notification import DecisionRequest
    from app.services.slack_notify import decision_blocks

    decision = DecisionRequest(
        tenant_id=__import__("uuid").uuid4(),
        title="Approve refund",
        summary="Customer asks for a refund",
        status="awaiting_human",
    )
    blocks = decision_blocks(decision, link="https://app.example/t/x")
    actions = next(b for b in blocks if b["type"] == "actions")
    values = {
        el["action_id"]: json.loads(el["value"])
        for el in actions["elements"]
        if el.get("value")
    }
    assert values["decision_approve"]["decision_id"] == str(decision.id)
    assert values["decision_approve"]["verdict"] == "approve"
    assert values["decision_reject"]["verdict"] == "reject"


async def _make_decision(session, tenant_id):
    """Signal + decision_request message + DecisionRequest wired together."""
    from app.models.notification import DecisionRequest
    from app.models.signal import Signal, SignalMessage

    signal = Signal(tenant_id=tenant_id, channel="internal", subject="Approve refund")
    session.add(signal)
    await session.flush()
    decision = DecisionRequest(
        tenant_id=tenant_id,
        signal_id=signal.id,
        title="Approve refund",
        summary="Customer asks for a refund",
        status="awaiting_human",
        options_json=json.dumps([{"id": "approve", "label": "Approve"}, {"id": "reject", "label": "Reject"}]),
    )
    session.add(decision)
    await session.flush()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind="decision_request",
        direction="inbound",
        role="assistant",
        subject=decision.title,
        body_text=decision.summary,
        decision_id=decision.id,
    )
    session.add(message)
    await session.flush()
    decision.message_id = message.id
    await session.commit()
    return decision


def _signed_interaction_headers(secret: str, body: bytes) -> dict:
    ts = str(int(time.time()))
    sig = "v0=" + hmac.new(secret.encode(), f"v0:{ts}:{body.decode()}".encode(), hashlib.sha256).hexdigest()
    return {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Slack-Request-Timestamp": ts,
        "X-Slack-Signature": sig,
    }


@pytest.mark.asyncio
async def test_slack_interaction_approves_decision(client: AsyncClient, session_override, monkeypatch):
    from app.models.auth import Tenant
    from app.services import slack_notify

    headers = await _login(client)
    account = await client.post(
        "/api/channels/accounts",
        json={
            "channel": "slack",
            "provider": "slack",
            "address": "T777",
            "credentials": {"signing_secret": "shh2", "bot_token": "xoxb-test"},
        },
        headers=headers,
    )
    assert account.status_code == 200, account.text

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    decision = await _make_decision(session_override, tenant.id)

    # No outbound Slack calls in tests: user mapping resolves to nobody.
    monkeypatch.setattr(slack_notify, "_map_slack_user", AsyncMock(return_value=None))

    payload = {
        "type": "block_actions",
        "team": {"id": "T777"},
        "user": {"id": "U123", "username": "tester"},
        "response_url": "",
        "actions": [
            {
                "action_id": "decision_approve",
                "value": json.dumps({"decision_id": str(decision.id), "verdict": "approve"}),
            }
        ],
    }
    body = urlencode({"payload": json.dumps(payload)}).encode()

    res = await client.post(
        "/api/channels/slack/interactions",
        content=body,
        headers=_signed_interaction_headers("shh2", body),
    )
    assert res.status_code == 200, res.text
    assert res.json().get("ok") is True

    await session_override.refresh(decision)
    assert decision.status == "approved"

    # A second click reports already_resolved instead of double-resolving.
    res2 = await client.post(
        "/api/channels/slack/interactions",
        content=body,
        headers=_signed_interaction_headers("shh2", body),
    )
    assert res2.status_code == 200
    assert res2.json().get("already_resolved") is True


@pytest.mark.asyncio
async def test_slack_interaction_rejects_bad_signature(client: AsyncClient):
    headers = await _login(client)
    await client.post(
        "/api/channels/accounts",
        json={
            "channel": "slack",
            "provider": "slack",
            "address": "T888",
            "credentials": {"signing_secret": "real", "bot_token": "xoxb-test"},
        },
        headers=headers,
    )
    payload = {"type": "block_actions", "team": {"id": "T888"}, "actions": []}
    body = urlencode({"payload": json.dumps(payload)}).encode()
    res = await client.post(
        "/api/channels/slack/interactions",
        content=body,
        headers=_signed_interaction_headers("wrong-secret", body),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_digest_requires_opt_in_and_sends(client: AsyncClient, session_override, monkeypatch):
    from app.services import transactional_mail
    from app.services.digest_mail import send_tenant_digests

    headers = await _login(client)
    # Ensure there is digest-worthy content (an open external thread).
    r = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "test",
            "subject": "Digest content",
            "body_text": "Open question",
            "contact_email": "digest@example.com",
        },
    )
    assert r.status_code == 200, r.text

    sent_mails: list[tuple[str, str]] = []

    async def _fake_send_mail(to, subject, text, html=None, *, kind="generic"):
        sent_mails.append((to, subject))
        return True

    monkeypatch.setattr(transactional_mail, "send_mail", _fake_send_mail)

    # Nobody opted in yet: nothing goes out.
    assert await send_tenant_digests(session_override, period="daily") == 0

    # Opt the test user in for the daily digest.
    prefs = await client.get("/api/user/notification-preferences", headers=headers)
    rows = prefs.json()["rows"]
    for row in rows:
        if row["id"] == "digest-daily":
            row["channels"]["email"] = True
    r = await client.patch(
        "/api/user/notification-preferences", headers=headers, json={"rows": rows}
    )
    assert r.status_code == 200, r.text

    sent = await send_tenant_digests(session_override, period="daily")
    assert sent >= 1
    assert any("Daily digest" in subject for _, subject in sent_mails)
