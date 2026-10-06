"""Rule suggestions: validated values, inline cards, bulk-sender proposal."""

import json
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.learning import InboxRule
from app.models.notification import DecisionRequest
from app.models.signal import Signal
from app.services import inbox_rules
from app.services.inbound_agent import acknowledge_automated_mail
from app.tools import execute_tool


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


def _signal(tenant_id, sender: str, subject: str = "Automated notice") -> Signal:
    return Signal(
        tenant_id=tenant_id,
        channel="email",
        source="mock",
        subject=subject,
        contact_email=sender,
        contact_name="Shop news",
        status="open",
    )


def test_normalize_match_value_per_type():
    assert inbox_rules.normalize_match_value("sender", " News@Shop.NL ") == "news@shop.nl"
    assert inbox_rules.normalize_match_value("sender", "Shop news") == ""
    assert inbox_rules.normalize_match_value("domain", "@Shop.nl") == "shop.nl"
    assert inbox_rules.normalize_match_value("domain", "news@shop.nl") == "shop.nl"
    assert inbox_rules.normalize_match_value("domain", "shop") == ""
    assert inbox_rules.normalize_match_value("list_id", "News <news.shop.nl>") == "news.shop.nl"
    assert inbox_rules.normalize_match_value("list_id", "") == ""
    assert inbox_rules.normalize_match_value("subject", "x") == ""


@pytest.mark.asyncio
async def test_suggest_tool_rejects_values_that_cannot_match(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    bad = await execute_tool(
        session_override,
        tenant.id,
        None,
        "suggest_inbox_rule",
        {"match_type": "sender", "match_value": "Shop news", "action": "auto_close"},
    )
    assert "error" in bad and "full email address" in bad["error"]
    bad_action = await execute_tool(
        session_override,
        tenant.id,
        None,
        "suggest_inbox_rule",
        {"match_type": "sender", "match_value": "news@shop.nl", "action": "archive"},
    )
    assert "error" in bad_action
    rules = (await session_override.execute(select(InboxRule).where(InboxRule.tenant_id == tenant.id))).scalars().all()
    assert rules == []


@pytest.mark.asyncio
async def test_suggest_tool_in_conversation_raises_inline_card(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    signal = _signal(tenant.id, "news@shop.nl")
    session_override.add(signal)
    await session_override.commit()

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "suggest_inbox_rule",
        {
            "match_type": "list_id",
            "match_value": "News <news.shop.nl>",
            "action": "auto_close",
            "reason": "Weekly newsletter",
        },
        signal_id=signal.id,
    )
    assert result["rule"]["match_value"] == "news.shop.nl"
    assert result["rule"]["status"] == "suggested"
    assert result["decision"] is not None

    decision = await session_override.get(DecisionRequest, UUID(result["decision"]["decision_request_id"]))
    assert decision.signal_id == signal.id
    assert decision.status == "awaiting_human"
    options = json.loads(decision.options_json)
    assert options[0]["action_type"] == "activate_inbox_rule"
    assert options[0]["payload"]["rule_id"] == result["rule"]["id"]

    # Approving the card activates the rule.
    headers = await _auth_headers(client)
    approved = await client.post(
        f"/api/notifications/decisions/{decision.id}/approve",
        headers=headers,
        json={"option_id": "activate"},
    )
    assert approved.status_code == 200
    rule = await session_override.get(InboxRule, UUID(result["rule"]["id"]))
    await session_override.refresh(rule)
    assert rule.status == "active"


@pytest.mark.asyncio
async def test_mailbox_setting_archives_automated_mail(client: AsyncClient, session_override):
    from app.models.channel import ChannelAccount
    from app.services.signal_tags import signal_tag_names

    tenant = await _tenant(session_override)
    account = (
        await session_override.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id, ChannelAccount.channel == "email"
            )
        )
    ).scalars().first()
    assert account is not None
    headers = await _auth_headers(client)

    listed = await client.get("/api/channels", headers=headers)
    row = next(r for r in listed.json()["channels"] if r["id"] == str(account.id))
    assert row["archive_automated_mail"] is False

    patched = await client.patch(
        f"/api/channels/accounts/{account.id}", headers=headers, json={"archive_automated_mail": True}
    )
    assert patched.status_code == 200
    assert patched.json()["archive_automated_mail"] is True

    signal = _signal(tenant.id, "noreply@shop.example", "Your receipt")
    signal.channel_account_id = account.id
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(account)

    result = await acknowledge_automated_mail(
        session_override, tenant.id, signal, None, summary="Receipt", reason="no_reply_address"
    )
    assert result["delivery"] == "archived"
    await session_override.refresh(signal)
    assert signal.status == "closed"
    assert signal.has_unread is False
    assert "automated" in await signal_tag_names(session_override, signal.id)


@pytest.mark.asyncio
async def test_third_automated_thread_proposes_auto_close(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    sender = "noreply@bank.example"
    threads = [_signal(tenant.id, sender, f"Statement {i}") for i in range(3)]
    session_override.add_all(threads)
    await session_override.commit()

    # First two acknowledgements: note only.
    for signal in threads[:2]:
        result = await acknowledge_automated_mail(
            session_override, tenant.id, signal, None, summary="Statement ready", reason="no_reply_address"
        )
        assert result["rule_suggested"] is False
    cards = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.tenant_id == tenant.id)
        )
    ).scalars().all()
    assert cards == []

    # Third thread from the same sender: suggested rule + inline card.
    result = await acknowledge_automated_mail(
        session_override, tenant.id, threads[2], None, summary="Statement ready", reason="no_reply_address"
    )
    assert result["rule_suggested"] is True
    rule = (
        await session_override.execute(
            select(InboxRule).where(InboxRule.tenant_id == tenant.id, InboxRule.match_value == sender)
        )
    ).scalar_one()
    assert rule.status == "suggested"
    assert rule.action == "auto_close"
    assert rule.observations == 3
    cards = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.tenant_id == tenant.id)
        )
    ).scalars().all()
    assert len(cards) == 1
    assert cards[0].signal_id == threads[2].id
    assert cards[0].title == inbox_rules.rule_decision_title(inbox_rules.serialize_rule(rule))

    # A fourth message does not stack a second card while the first is open.
    fourth = _signal(tenant.id, sender, "Statement 4")
    session_override.add(fourth)
    await session_override.commit()
    await acknowledge_automated_mail(
        session_override, tenant.id, fourth, None, summary="Statement ready", reason="no_reply_address"
    )
    cards = (
        await session_override.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == tenant.id, DecisionRequest.status == "awaiting_human"
            )
        )
    ).scalars().all()
    assert len(cards) == 1
