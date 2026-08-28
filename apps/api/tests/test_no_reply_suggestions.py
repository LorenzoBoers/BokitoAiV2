"""Automated/no-reply mail: suggest an action (close / task / keep open), never a reply."""

import json
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.services.automated_mail import (
    classify_automated_email,
    clip_with_ellipsis,
    extract_no_reply_summary,
    is_no_reply_address,
)
from app.services.inbound_agent import create_action_suggestion


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


# ── detection heuristics ─────────────────────────────────────────


def test_no_reply_address_patterns():
    positives = [
        "noreply@github.com",
        "no-reply@stripe.com",
        "no_reply@service.io",
        "donotreply@bank.nl",
        "do-not-reply@microsoft.com",
        "notifications@linear.app",
        "notification-service@app.io",
        "alerts@monitoring.io",
        "alert-bot@datadog.com",
        "mailer-daemon@googlemail.com",
        "postmaster@outlook.com",
        "bounces@sendgrid.net",
        "bounce+abc@mailer.io",
        "newsletter@nrc.nl",
    ]
    for addr in positives:
        assert is_no_reply_address(addr), addr

    negatives = [
        "lorenzo@bokito.ai",
        "klant@bedrijf.nl",
        "info@accountant.nl",
        "support@vendor.com",
        # Words containing the patterns mid-string must not match.
        "annareply@example.com",
        "",
        "not-an-email",
    ]
    for addr in negatives:
        assert not is_no_reply_address(addr), addr


def test_classify_automated_headers():
    # Address wins first.
    out = classify_automated_email("noreply@x.io")
    assert out == {"automated": True, "reason": "no_reply_address"}

    # RFC auto-submitted marks generated mail even from a plain address.
    out = classify_automated_email("system@erp.nl", {"auto-submitted": "auto-generated"})
    assert out["automated"] and out["reason"] == "auto_submitted"

    # Auto-Submitted: no is explicitly human.
    assert not classify_automated_email("x@y.nl", {"auto-submitted": "no"})["automated"]

    out = classify_automated_email("news@shop.nl", {"precedence": "bulk"})
    assert out["automated"] and out["reason"] == "bulk_precedence"

    out = classify_automated_email("team@saas.io", {"list-unsubscribe": "<mailto:u@x.io>"})
    assert out["automated"] and out["reason"] == "mailing_list"

    out = classify_automated_email("mailer@relay.io", {"return-path": "<>"})
    assert out["automated"] and out["reason"] == "null_return_path"

    # A normal customer email stays non-automated.
    assert not classify_automated_email("klant@bedrijf.nl", {"return-path": "<klant@bedrijf.nl>"})[
        "automated"
    ]


def test_clip_with_ellipsis_cuts_on_a_word():
    raw = (
        "Hallo Lorenzo, Best verkocht Topmerken Help Mijn account Verkoop Zoeken "
        "Artikelen zijn bevestigd We willen u alleen laten weten dat de volgende "
        "item(s) van uw Fruugo bestelling 242125383 zijn bevestigd."
    )
    out = clip_with_ellipsis(raw, 80)
    assert out.endswith("...")
    assert "beves" not in out
    assert "  " not in out


def test_extract_no_reply_sentinel():
    assert extract_no_reply_summary("NO_REPLY_NEEDED: GitHub deploy succeeded") == (
        "GitHub deploy succeeded"
    )
    assert extract_no_reply_summary("no_reply_needed - invoice receipt from Stripe") == (
        "invoice receipt from Stripe"
    )
    assert (
        extract_no_reply_summary("NO_REPLY_NEEDED")
        == "Automated notification; no reply needed."
    )
    assert extract_no_reply_summary("Dear customer, here is your answer.") is None
    assert extract_no_reply_summary("") is None


# ── action suggestion decision ───────────────────────────────────


@pytest.mark.asyncio
async def test_action_suggestion_card_options(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    from app.models.agent import Agent

    agent = (
        (
            await session_override.execute(
                select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
            )
        )
        .scalars()
        .first()
    )

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Your deploy succeeded",
        contact_email="noreply@github.com",
        status="open",
    )
    session_override.add(signal)
    await session_override.flush()

    result = await create_action_suggestion(
        session_override,
        tenant.id,
        signal,
        agent,
        summary="Deploy notification from GitHub.",
        reason="no_reply_address",
    )
    assert result["suggestion"] is True
    assert result["kind"] == "action_suggestion"
    assert result["delivery"] == "no_reply_needed"

    decision = await session_override.get(DecisionRequest, UUID(result["decision_id"]))
    assert decision is not None
    assert decision.status == "awaiting_human"
    options = json.loads(decision.options_json)
    by_id = {o["id"]: o for o in options}
    assert by_id["close"]["action_type"] == "close_thread"
    assert by_id["close"]["payload"]["signal_id"] == str(signal.id)
    assert by_id["create_task"]["action_type"] == "create_task"
    assert by_id["keep_open"]["action_type"] == "defer"

    # No reply option anywhere on the card.
    assert not any(o.get("action_type") in ("send_reply", "send_email") for o in options)

    # No outbound message was produced.
    outbound = (
        (
            await session_override.execute(
                select(SignalMessage).where(
                    SignalMessage.signal_id == signal.id,
                    SignalMessage.direction == "outbound",
                )
            )
        )
        .scalars()
        .all()
    )
    assert outbound == []


@pytest.mark.asyncio
async def test_approving_close_option_closes_thread(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    from app.models.agent import Agent

    agent = (
        (
            await session_override.execute(
                select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
            )
        )
        .scalars()
        .first()
    )

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Password changed",
        contact_email="no-reply@accounts.google.com",
        status="open",
    )
    session_override.add(signal)
    await session_override.flush()

    result = await create_action_suggestion(
        session_override,
        tenant.id,
        signal,
        agent,
        summary="Google account notification.",
        reason="no_reply_address",
    )
    message_id = result["message_id"]

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{message_id}/resolve",
        headers=headers,
        json={"action": "approved", "option_id": "close"},
    )
    assert resolve.status_code == 200

    await session_override.refresh(signal)
    assert signal.status == "closed"

    decision = await session_override.get(DecisionRequest, UUID(result["decision_id"]))
    await session_override.refresh(decision)
    assert decision.status == "approved"
    assert decision.chosen_option_id == "close"


@pytest.mark.asyncio
async def test_keep_open_option_leaves_thread_open(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    from app.models.agent import Agent

    agent = (
        (
            await session_override.execute(
                select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
            )
        )
        .scalars()
        .first()
    )

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Weekly digest",
        contact_email="newsletter@vendor.com",
        status="open",
    )
    session_override.add(signal)
    await session_override.flush()

    result = await create_action_suggestion(
        session_override,
        tenant.id,
        signal,
        agent,
        summary="Weekly vendor digest.",
        reason="no_reply_address",
    )

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{result['message_id']}/resolve",
        headers=headers,
        json={"action": "deferred", "option_id": "keep_open"},
    )
    assert resolve.status_code == 200

    await session_override.refresh(signal)
    assert signal.status == "open"


# ── close_thread tool ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_close_thread_tool(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    from app.models.auth import User
    from app.tools import execute_tool
    from scripts.seed import TEST_EMAIL

    user = (
        (await session_override.execute(select(User).where(User.email == TEST_EMAIL)))
        .scalars()
        .first()
    )
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Bounce notice",
        contact_email="mailer-daemon@googlemail.com",
        status="open",
        has_unread=True,
    )
    session_override.add(signal)
    await session_override.commit()

    result = await execute_tool(
        session_override,
        tenant.id,
        user.id if user else None,
        "close_thread",
        {"signal_id": str(signal.id)},
        approved=True,
    )
    assert result.get("ok") is True
    assert result.get("status") == "closed"

    await session_override.refresh(signal)
    assert signal.status == "closed"
    assert signal.has_unread is False

    # Idempotent on an already-closed thread.
    again = await execute_tool(
        session_override,
        tenant.id,
        user.id if user else None,
        "close_thread",
        {"signal_id": str(signal.id)},
        approved=True,
    )
    assert again.get("ok") is True
    assert again.get("already_closed") is True


@pytest.mark.asyncio
async def test_create_task_option_opens_agenda_task(client: AsyncClient, session_override):
    from app.models.orchestration import AgentTask
    from app.services.inbound_agent import create_action_suggestion

    headers = await _auth_headers(client)
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    from app.models.agent import Agent

    agent = (
        (
            await session_override.execute(
                select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
            )
        )
        .scalars()
        .first()
    )

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Payment declined",
        contact_email="payments@play.google.com",
        status="open",
    )
    session_override.add(signal)
    await session_override.flush()

    result = await create_action_suggestion(
        session_override,
        tenant.id,
        signal,
        agent,
        summary="Play Store receipt.",
        reason="no_reply_address",
    )
    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{result['message_id']}/resolve",
        headers=headers,
        json={"action": "approved", "option_id": "create_task"},
    )
    assert resolve.status_code == 200, resolve.text
    task_id = resolve.json().get("task_id")
    assert task_id
    task = await session_override.get(AgentTask, UUID(task_id))
    assert task is not None
    assert task.signal_id == signal.id
