"""Self-learning inbox rules: matching, learning, promotion, pipeline actions."""

import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.channel import Contact
from app.models.learning import Feedback, InboxRule
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services import inbox_rules
from app.services.email_sync import ensure_ai_live_since, is_backfill_message
from app.services.inbound_agent import create_action_suggestion


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
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
        status="open",
        has_unread=True,
    )


# ── sender keys & matching ───────────────────────────────────────


def test_sender_keys_order_and_normalization():
    keys = inbox_rules.sender_keys(
        "NoReply@GitHub.com", {"List-Id": "Deploys <deploys.github.com>"}
    )
    assert keys == [
        ("sender", "noreply@github.com"),
        ("list_id", "deploys.github.com"),
        ("domain", "github.com"),
    ]
    # No list header -> sender + domain only.
    assert inbox_rules.sender_keys("a@b.io") == [("sender", "a@b.io"), ("domain", "b.io")]
    # Not an email address -> nothing to match on.
    assert inbox_rules.sender_keys("widget-visitor-123") == []


def test_normalize_list_id_variants():
    assert inbox_rules.normalize_list_id("News <news.shop.nl>") == "news.shop.nl"
    assert inbox_rules.normalize_list_id("news.shop.nl") == "news.shop.nl"
    assert inbox_rules.normalize_list_id("") == ""


@pytest.mark.asyncio
async def test_find_matching_rule_prefers_most_specific(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    session_override.add(
        InboxRule(
            tenant_id=tenant.id,
            match_type="domain",
            match_value="github.com",
            action="mute_ai",
            status="active",
        )
    )
    session_override.add(
        InboxRule(
            tenant_id=tenant.id,
            match_type="sender",
            match_value="noreply@github.com",
            action="auto_close",
            status="active",
        )
    )
    # Paused rules never match.
    session_override.add(
        InboxRule(
            tenant_id=tenant.id,
            match_type="sender",
            match_value="alerts@github.com",
            action="auto_close",
            status="paused",
        )
    )
    await session_override.commit()

    rule = await inbox_rules.find_matching_rule(session_override, tenant.id, "noreply@github.com")
    assert rule is not None and rule.action == "auto_close"

    # Different sender on the same domain falls back to the domain rule.
    rule = await inbox_rules.find_matching_rule(session_override, tenant.id, "ci@github.com")
    assert rule is not None and rule.action == "mute_ai"

    # Paused sender rule does not apply, but the domain rule still does.
    rule = await inbox_rules.find_matching_rule(session_override, tenant.id, "alerts@github.com")
    assert rule is not None and rule.match_type == "domain"

    assert await inbox_rules.find_matching_rule(session_override, tenant.id, "x@other.io") is None


# ── learning (record_outcome) ────────────────────────────────────


@pytest.mark.asyncio
async def test_record_outcome_counts_and_signals_promotion(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)

    for expected in (1, 2):
        out = await inbox_rules.record_outcome(
            session_override,
            tenant.id,
            from_address="noreply@stripe.com",
            option_id="close",
        )
        assert out is not None
        assert out["observations"] == expected
        assert out["ready_to_activate"] is False
        await session_override.commit()

    out = await inbox_rules.record_outcome(
        session_override,
        tenant.id,
        from_address="noreply@stripe.com",
        option_id="close",
    )
    assert out is not None
    assert out["observations"] == 3
    assert out["ready_to_activate"] is True
    assert out["auto_promoted"] is False
    assert out["status"] == "suggested"
    await session_override.commit()

    # keep_open teaches nothing.
    assert (
        await inbox_rules.record_outcome(
            session_override, tenant.id, from_address="noreply@stripe.com", option_id="keep_open"
        )
        is None
    )


@pytest.mark.asyncio
async def test_record_outcome_auto_promotes_when_allowed(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    out = None
    for _ in range(3):
        out = await inbox_rules.record_outcome(
            session_override,
            tenant.id,
            from_address="alerts@datadog.com",
            option_id="create_task",
            auto_promote=True,
        )
        await session_override.commit()
    assert out is not None
    assert out["auto_promoted"] is True
    assert out["status"] == "active"
    assert out["action"] == "auto_task"

    # Once active, further outcomes are no-ops.
    assert (
        await inbox_rules.record_outcome(
            session_override, tenant.id, from_address="alerts@datadog.com", option_id="create_task"
        )
        is None
    )


@pytest.mark.asyncio
async def test_record_outcome_resets_on_inconsistent_choice(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    for _ in range(2):
        await inbox_rules.record_outcome(
            session_override, tenant.id, from_address="news@vendor.io", option_id="close"
        )
        await session_override.commit()

    out = await inbox_rules.record_outcome(
        session_override, tenant.id, from_address="news@vendor.io", option_id="create_task"
    )
    assert out is not None
    assert out["action"] == "auto_task"
    assert out["observations"] == 1
    assert out["ready_to_activate"] is False


@pytest.mark.asyncio
async def test_paused_rule_is_not_resuggested(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    session_override.add(
        InboxRule(
            tenant_id=tenant.id,
            match_type="sender",
            match_value="noreply@paused.io",
            action="auto_close",
            status="paused",
        )
    )
    await session_override.commit()

    out = await inbox_rules.record_outcome(
        session_override, tenant.id, from_address="noreply@paused.io", option_id="close"
    )
    assert out is None


# ── CRUD endpoints ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rules_crud_endpoints(client: AsyncClient, session_override):
    headers = await _auth_headers(client)

    created = await client.post(
        "/api/signals/rules",
        headers=headers,
        json={"match_type": "sender", "match_value": "NoReply@Ads.io ", "action": "auto_close"},
    )
    assert created.status_code == 200
    rule = created.json()
    assert rule["match_value"] == "noreply@ads.io"
    assert rule["status"] == "active"
    assert rule["source"] == "manual"

    listed = await client.get("/api/signals/rules", headers=headers)
    assert listed.status_code == 200
    assert any(r["id"] == rule["id"] for r in listed.json())

    patched = await client.patch(
        f"/api/signals/rules/{rule['id']}",
        headers=headers,
        json={"status": "paused", "action": "mute_ai"},
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "paused"
    assert patched.json()["action"] == "mute_ai"

    invalid = await client.post(
        "/api/signals/rules",
        headers=headers,
        json={"match_type": "sender", "match_value": "x@y.io", "action": "explode"},
    )
    assert invalid.status_code == 400

    deleted = await client.delete(f"/api/signals/rules/{rule['id']}", headers=headers)
    assert deleted.status_code == 200
    listed = await client.get("/api/signals/rules", headers=headers)
    assert not any(r["id"] == rule["id"] for r in listed.json())


# ── learn from resolving "No reply needed" cards ─────────────────


@pytest.mark.asyncio
async def test_resolving_close_three_times_suggests_rule(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = await _tenant(session_override)
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

    sender = "noreply@ci-service.io"
    suggestions = []
    for i in range(3):
        signal = _signal(tenant.id, sender, subject=f"Build #{i} finished")
        session_override.add(signal)
        await session_override.flush()
        result = await create_action_suggestion(
            session_override,
            tenant.id,
            signal,
            agent,
            summary="CI build notification.",
            reason="no_reply_address",
        )
        resolve = await client.post(
            f"/api/signals/{signal.id}/messages/{result['message_id']}/resolve",
            headers=headers,
            json={"action": "approved", "option_id": "close"},
        )
        assert resolve.status_code == 200
        suggestions.append(resolve.json().get("rule_suggestion"))

    assert suggestions[0] is not None and suggestions[0]["observations"] == 1
    assert suggestions[1]["observations"] == 2
    assert suggestions[2]["observations"] == 3
    assert suggestions[2]["ready_to_activate"] is True
    assert suggestions[2]["auto_promoted"] is False

    # Each resolution recorded a Feedback row for the learning loop.
    feedback = (
        (
            await session_override.execute(
                select(Feedback).where(
                    Feedback.tenant_id == tenant.id,
                    Feedback.comment == "no_reply_action:close",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(feedback) == 3

    # Confirming the prompt activates the rule.
    activate = await client.patch(
        f"/api/signals/rules/{suggestions[2]['id']}",
        headers=headers,
        json={"status": "active"},
    )
    assert activate.status_code == 200
    assert activate.json()["status"] == "active"


@pytest.mark.asyncio
async def test_autonomous_posture_auto_promotes_rule(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = await _tenant(session_override)
    tenant.settings_json = json.dumps({"autonomy_posture": "autonomous"})
    session_override.add(tenant)
    await session_override.commit()
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

    sender = "notifications@saas-tool.io"
    last = None
    for i in range(3):
        signal = _signal(tenant.id, sender, subject=f"Digest {i}")
        session_override.add(signal)
        await session_override.flush()
        result = await create_action_suggestion(
            session_override, tenant.id, signal, agent, summary="Digest.", reason="no_reply_address"
        )
        resolve = await client.post(
            f"/api/signals/{signal.id}/messages/{result['message_id']}/resolve",
            headers=headers,
            json={"action": "approved", "option_id": "close"},
        )
        assert resolve.status_code == 200
        last = resolve.json().get("rule_suggestion")

    assert last is not None
    assert last["auto_promoted"] is True
    assert last["status"] == "active"


# ── applying rules to inbound threads ────────────────────────────


@pytest.mark.asyncio
async def test_apply_rule_auto_close(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    rule = InboxRule(
        tenant_id=tenant.id,
        match_type="sender",
        match_value="noreply@github.com",
        action="auto_close",
        status="active",
    )
    signal = _signal(tenant.id, "noreply@github.com")
    session_override.add(rule)
    session_override.add(signal)
    await session_override.flush()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="user_message",
        direction="inbound",
        role="user",
        from_address="noreply@github.com",
        body_text="Deploy finished.",
        body_preview="Deploy finished.",
    )
    session_override.add(message)
    await session_override.commit()

    result = await inbox_rules.apply_rule_to_signal(
        session_override, tenant.id, signal, message, rule
    )
    assert result["delivery"] == "auto_closed"

    await session_override.refresh(signal)
    assert signal.status == "closed"
    assert signal.has_unread is False

    await session_override.refresh(rule)
    assert rule.hit_count == 1
    assert rule.last_hit_at is not None

    events = (
        (
            await session_override.execute(
                select(SignalEvent).where(
                    SignalEvent.signal_id == signal.id,
                    SignalEvent.event_type == "rule_applied",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(events) == 1
    payload = json.loads(events[0].payload_json)
    assert payload["action"] == "auto_close"
    assert payload["match_value"] == "noreply@github.com"


@pytest.mark.asyncio
async def test_apply_rule_auto_task_creates_task(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    rule = InboxRule(
        tenant_id=tenant.id,
        match_type="sender",
        match_value="invoices@supplier.nl",
        action="auto_task",
        status="active",
    )
    signal = _signal(tenant.id, "invoices@supplier.nl", subject="Invoice 2026-081")
    session_override.add(rule)
    session_override.add(signal)
    await session_override.flush()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="user_message",
        direction="inbound",
        role="user",
        from_address="invoices@supplier.nl",
        body_text="Please find attached invoice 2026-081.",
        body_preview="Please find attached invoice 2026-081.",
    )
    session_override.add(message)
    await session_override.commit()

    result = await inbox_rules.apply_rule_to_signal(
        session_override, tenant.id, signal, message, rule
    )
    assert result["delivery"] == "task_created"
    assert result.get("task_id")

    from app.models.orchestration import AgentTask
    from uuid import UUID

    task = await session_override.get(AgentTask, UUID(result["task_id"]))
    assert task is not None
    assert task.trigger_type == "inbox_rule"
    assert task.signal_id == signal.id

    # Thread stays open (parity with the manual "Create task" choice).
    await session_override.refresh(signal)
    assert signal.status == "open"


@pytest.mark.asyncio
async def test_apply_rule_mute_ai_leaves_thread_untouched(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    rule = InboxRule(
        tenant_id=tenant.id,
        match_type="domain",
        match_value="internal-tools.io",
        action="mute_ai",
        status="active",
    )
    signal = _signal(tenant.id, "reports@internal-tools.io")
    session_override.add(rule)
    session_override.add(signal)
    await session_override.flush()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="user_message",
        direction="inbound",
        role="user",
        from_address="reports@internal-tools.io",
        body_text="Daily report.",
        body_preview="Daily report.",
    )
    session_override.add(message)
    await session_override.commit()

    result = await inbox_rules.apply_rule_to_signal(
        session_override, tenant.id, signal, message, rule
    )
    assert result["delivery"] == "ai_skipped"

    await session_override.refresh(signal)
    assert signal.status == "open"
    assert signal.has_unread is True


# ── backfill AI-skip & contact hygiene ───────────────────────────


def test_backfill_cutoff_detection():
    settings = ensure_ai_live_since({})
    assert settings.get("ai_live_since")
    # Stamping is idempotent.
    assert ensure_ai_live_since(settings) == settings

    old = datetime.utcnow() - timedelta(days=10)
    fresh = datetime.utcnow() + timedelta(minutes=1)
    assert is_backfill_message(old, settings) is True
    assert is_backfill_message(fresh, settings) is False
    # No cutoff (legacy accounts) or unknown timestamp -> treat as live.
    assert is_backfill_message(old, {}) is False
    assert is_backfill_message(None, settings) is False


@pytest.mark.asyncio
async def test_ingest_skips_crm_contact_for_automated_sender(
    client: AsyncClient, session_override
):
    from app.channels.base import InboundMessage, ingest_inbound

    tenant = await _tenant(session_override)

    signal, should_process = await ingest_inbound(
        session_override,
        tenant.id,
        InboundMessage(
            channel="email",
            source="mock",
            sender_address="noreply@newsletter.io",
            sender_name="Newsletter",
            subject="Weekly digest",
            body_text="News...",
            external_id="auto-1",
        ),
    )
    assert should_process is True
    assert signal.contact_id is None
    contact = (
        await session_override.execute(
            select(Contact).where(
                Contact.tenant_id == tenant.id, Contact.address == "noreply@newsletter.io"
            )
        )
    ).scalar_one_or_none()
    assert contact is None

    # A real customer still gets a CRM contact.
    signal, _ = await ingest_inbound(
        session_override,
        tenant.id,
        InboundMessage(
            channel="email",
            source="mock",
            sender_address="klant@bedrijf.nl",
            sender_name="Klant",
            subject="Vraag over factuur",
            body_text="Hallo...",
            external_id="human-1",
        ),
    )
    assert signal.contact_id is not None
    contact = (
        await session_override.execute(
            select(Contact).where(
                Contact.tenant_id == tenant.id, Contact.address == "klant@bedrijf.nl"
            )
        )
    ).scalar_one_or_none()
    assert contact is not None
