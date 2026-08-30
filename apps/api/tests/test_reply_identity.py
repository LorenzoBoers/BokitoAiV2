"""Reply identity: clean suggestion storage, send-as attribution, signatures."""

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.channel import ChannelAccount
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.services.inbound_agent import create_reply_suggestion


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _seeded(session):
    tenant = (
        await session.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    agent = (
        (
            await session.execute(
                select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
            )
        )
        .scalars()
        .first()
    )
    account = (
        (
            await session.execute(
                select(ChannelAccount).where(
                    ChannelAccount.tenant_id == tenant.id,
                    ChannelAccount.channel == "email",
                )
            )
        )
        .scalars()
        .first()
    )
    return tenant, agent, account


def _email_signal(tenant, account, agent=None, subject="Question") -> Signal:
    return Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject=subject,
        contact_email="customer@example.com",
        channel_account_id=account.id if account else None,
        agent_id=agent.id if agent else None,
        status="open",
    )


# ── clean suggestion storage ─────────────────────────────────────


@pytest.mark.asyncio
async def test_suggestion_stores_clean_body_and_internal_note(client, session_override):
    await _auth_headers(client)
    tenant, agent, account = await _seeded(session_override)
    signal = _email_signal(tenant, account, agent)
    session_override.add(signal)
    await session_override.flush()

    raw = (
        "De kennisbank bevat geen informatie over dit product.\n"
        "---\n"
        "Hallo,\n\nBedankt voor je vraag. We zoeken dit voor je uit.\n\n"
        "Met vriendelijke groet,\nBokito Assistent\n"
        "INTERNAL_NOTE: company.md is leeg; vul de productbeschrijving aan."
    )
    result = await create_reply_suggestion(
        session_override, tenant.id, signal, agent, reply_text=raw
    )
    assert result.get("suggestion") is True

    decision = await session_override.get(DecisionRequest, uuid.UUID(result["decision_id"]))
    # Summary (shown on the card and emailed to the approver) is the clean body.
    assert decision.summary.startswith("Hallo,")
    assert "Interne notitie" not in decision.summary
    assert "INTERNAL_NOTE" not in decision.summary
    assert "Met vriendelijke groet" not in decision.summary
    assert "kennisbank" not in decision.summary

    options = json.loads(decision.options_json)
    send = next(o for o in options if o["id"] == "send")
    assert send["payload"]["body_text"].startswith("Hallo,")
    assert "INTERNAL_NOTE" not in send["payload"]["body_text"]
    assert "company.md" in send["payload"]["internal_note"]

    # Suggestion notes stay on the card payload — not a second timeline message.
    notes = (
        (
            await session_override.execute(
                select(SignalMessage).where(
                    SignalMessage.signal_id == signal.id,
                    SignalMessage.kind == "internal_note",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(notes) == 0


# ── send-as attribution on approval ──────────────────────────────


async def _suggestion_on_thread(session, tenant, agent, account):
    signal = _email_signal(tenant, account, agent, subject="Send-as test")
    session.add(signal)
    await session.flush()
    result = await create_reply_suggestion(
        session, tenant.id, signal, agent, reply_text="Hallo,\n\nDit is het antwoord."
    )
    return signal, result


async def _outbound_messages(session, signal_id):
    return (
        (
            await session.execute(
                select(SignalMessage).where(
                    SignalMessage.signal_id == signal_id,
                    SignalMessage.direction == "outbound",
                    SignalMessage.kind != "decision_request",
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_approve_defaults_to_user_identity(client, session_override):
    headers = await _auth_headers(client)
    tenant, agent, account = await _seeded(session_override)
    signal, result = await _suggestion_on_thread(session_override, tenant, agent, account)

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{result['message_id']}/resolve",
        headers=headers,
        json={"action": "approved", "option_id": "send"},
    )
    assert resolve.status_code == 200

    outbound = await _outbound_messages(session_override, signal.id)
    assert len(outbound) == 1
    sent = outbound[0]
    assert sent.role == "user"
    assert sent.author_user_id is not None
    assert sent.author_agent_id is None
    meta = json.loads(sent.metadata_json)
    assert meta["send_as"] == "user"


@pytest.mark.asyncio
async def test_approve_send_as_agent_keeps_agent_identity(client, session_override):
    headers = await _auth_headers(client)
    tenant, agent, account = await _seeded(session_override)
    signal, result = await _suggestion_on_thread(session_override, tenant, agent, account)

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{result['message_id']}/resolve",
        headers=headers,
        json={"action": "approved", "option_id": "send", "send_as": "agent"},
    )
    assert resolve.status_code == 200

    outbound = await _outbound_messages(session_override, signal.id)
    assert len(outbound) == 1
    sent = outbound[0]
    assert sent.role == "assistant"
    assert sent.author_agent_id == agent.id
    assert sent.author_user_id is None
    meta = json.loads(sent.metadata_json)
    assert meta["send_as"] == "agent"
    # The approving human stays traceable.
    assert meta.get("approved_by_user_id")


@pytest.mark.asyncio
async def test_resolve_rejects_invalid_send_as(client, session_override):
    headers = await _auth_headers(client)
    tenant, agent, account = await _seeded(session_override)
    signal, result = await _suggestion_on_thread(session_override, tenant, agent, account)

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{result['message_id']}/resolve",
        headers=headers,
        json={"action": "approved", "option_id": "send", "send_as": "robot"},
    )
    assert resolve.status_code == 400


# ── signature resolution ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_signature_precedence_user_agent_mailbox(client, session_override):
    from app.channels.email import _append_signature
    from app.services.signatures import resolve_signature_html

    await _auth_headers(client)
    tenant, agent, account = await _seeded(session_override)
    user = (
        (
            await session_override.execute(
                select(User).where(User.email == "test@bokito.dev")
            )
        )
        .scalars()
        .first()
    )
    if user is None:
        from scripts.seed import TEST_EMAIL

        user = (
            (await session_override.execute(select(User).where(User.email == TEST_EMAIL)))
            .scalars()
            .first()
        )
    assert user is not None

    # No custom signatures: dynamic default from the user identity.
    resolved = await resolve_signature_html(
        session_override, tenant.id, send_as="user", user_id=user.id, agent_id=agent.id
    )
    assert resolved is not None
    assert "Met vriendelijke groet" in resolved or "Kind regards" in resolved
    identity = (user.display_name or user.email).strip()
    assert identity in resolved

    # Agent signature only: used for both identities (fallback for user).
    agent.settings_json = json.dumps({"email_signature_html": "<p>Team Bokito</p>"})
    session_override.add(agent)
    await session_override.flush()
    resolved = await resolve_signature_html(
        session_override, tenant.id, send_as="agent", agent_id=agent.id
    )
    assert resolved == "<p>Team Bokito</p>"
    resolved = await resolve_signature_html(
        session_override, tenant.id, send_as="user", user_id=user.id, agent_id=agent.id
    )
    assert resolved == "<p>Team Bokito</p>"

    # User signature wins for user identity; agent identity keeps its own.
    user_settings = json.loads(user.settings_json or "{}")
    user_settings["email_signature_html"] = "<p>Groet, Test User</p>"
    user.settings_json = json.dumps(user_settings)
    session_override.add(user)
    await session_override.flush()
    resolved = await resolve_signature_html(
        session_override, tenant.id, send_as="user", user_id=user.id, agent_id=agent.id
    )
    assert resolved == "<p>Groet, Test User</p>"
    resolved = await resolve_signature_html(
        session_override, tenant.id, send_as="agent", user_id=user.id, agent_id=agent.id
    )
    assert resolved == "<p>Team Bokito</p>"

    # Exactly one signature in the outgoing HTML: the override replaces the
    # mailbox signature instead of stacking on it.
    mailbox_settings = json.loads(account.settings_json or "{}")
    mailbox_settings["signature_html"] = "<p>Mailbox sig</p>"
    account.settings_json = json.dumps(mailbox_settings)
    out_html = _append_signature("<p>Body</p>", account, override="<p>Groet, Test User</p>")
    assert out_html.count("Groet, Test User") == 1
    assert "Mailbox sig" not in out_html
    # Without an identity signature the mailbox fallback applies.
    out_html = _append_signature("<p>Body</p>", account, override=None)
    assert "Mailbox sig" in out_html


# ── settings endpoints ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_profile_signature_roundtrip(client):
    headers = await _auth_headers(client)
    saved = await client.patch(
        "/api/auth/profile",
        headers=headers,
        json={"email_signature_html": "<p>Met vriendelijke groet,<br>Test</p>"},
    )
    assert saved.status_code == 200
    me = await client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert (
        me.json()["user"]["email_signature_html"]
        == "<p>Met vriendelijke groet,<br>Test</p>"
    )

    # Clearing removes it.
    cleared = await client.patch(
        "/api/auth/profile", headers=headers, json={"email_signature_html": ""}
    )
    assert cleared.status_code == 200
    me = await client.get("/api/auth/me", headers=headers)
    assert me.json()["user"]["email_signature_html"] == ""


@pytest.mark.asyncio
async def test_agent_signature_roundtrip(client, session_override):
    headers = await _auth_headers(client)
    tenant, agent, _ = await _seeded(session_override)

    saved = await client.patch(
        f"/api/workforce/agents/{agent.id}",
        headers=headers,
        json={"email_signature_html": "<p>Bokito Assistent</p>"},
    )
    assert saved.status_code == 200
    assert saved.json()["agent"]["email_signature_html"] == "<p>Bokito Assistent</p>"


@pytest.mark.asyncio
async def test_reply_send_as_setting_roundtrip(client):
    headers = await _auth_headers(client)

    got = await client.get("/api/settings/ai-modes", headers=headers)
    assert got.status_code == 200
    assert got.json()["reply_send_as"] == "user"

    saved = await client.put(
        "/api/settings/ai-modes", headers=headers, json={"reply_send_as": "agent"}
    )
    assert saved.status_code == 200
    assert saved.json()["reply_send_as"] == "agent"

    got = await client.get("/api/settings/ai-modes", headers=headers)
    assert got.json()["reply_send_as"] == "agent"

    invalid = await client.put(
        "/api/settings/ai-modes", headers=headers, json={"reply_send_as": "nobody"}
    )
    assert invalid.status_code == 400

    # Restore the default for other tests.
    await client.put(
        "/api/settings/ai-modes", headers=headers, json={"reply_send_as": "user"}
    )
