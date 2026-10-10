"""Layered AI handling: resolution, safeguards, permissions, lifecycle, API, breaker."""

import json
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.ai_handling_converge import converge_sqlite
from app.models.agent import Agent
from app.models.audit import AuditEvent
from app.models.auth import Membership, Tenant
from app.models.channel import ChannelAccount, Contact
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services import ai_handling as svc


def _tenant(settings: dict | None = None) -> Tenant:
    return Tenant(slug=f"aih-{uuid4().hex[:6]}", name="Acme", settings_json=json.dumps(settings or {}))


def _allow(mode: str = "autonomous", **extra) -> dict:
    return {
        "ai_handling": {"default": {"mode": mode}, **extra},
        "tool_allowances": {"messaging": "allow"},
    }


def _account(mode: str | None = None, **cfg) -> ChannelAccount:
    ai_config = dict(cfg)
    if mode:
        ai_config["ai_handling"] = {"mode": mode}
    return ChannelAccount(
        tenant_id=uuid4(),
        channel="email",
        address="help@acme.test",
        provider="gmail",
        settings_json=json.dumps({"ai_config": ai_config}),
    )


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------


def test_most_specific_layer_wins():
    tenant = _tenant(_allow("assisted"))
    account = _account("autonomous")
    contact = Contact(tenant_id=uuid4(), address="a@b.c", ai_handling=json.dumps({"mode": "manual"}))
    signal = Signal(tenant_id=uuid4(), channel="email")

    assert svc.resolve_ai_handling(tenant).effective == "assisted"
    assert svc.resolve_ai_handling(tenant, account).effective == "autonomous"

    handling = svc.resolve_ai_handling(tenant, account, contact, signal)
    assert handling.effective == "manual"
    assert handling.source == "contact"
    assert handling.inherited == "manual"
    assert handling.own is None
    assert handling.until_close is False

    signal.ai_handling = "assisted"
    signal.ai_handling_reason = "operator"
    handling = svc.resolve_ai_handling(tenant, account, contact, signal)
    assert handling.effective == "assisted"
    assert handling.source == "conversation"
    assert handling.reason == "operator"
    assert handling.until_close is True


def test_scope_reports_own_and_inherited():
    tenant = _tenant(_allow("manual"))
    account = _account("autonomous")
    channel = svc.resolve_ai_handling(tenant, account, scope="channel")
    assert channel.own == "autonomous"
    assert channel.inherited == "manual"
    assert channel.inherited_source == "workspace"

    workspace = svc.resolve_ai_handling(tenant, scope="workspace")
    assert workspace.own == "manual"
    assert workspace.inherited_source == "default"


def test_tenant_without_settings_defaults_to_assisted():
    handling = svc.resolve_ai_handling(_tenant())
    assert handling.requested == "assisted"
    assert handling.source == "workspace"


def test_legacy_values_normalize():
    assert svc.normalize_mode("auto") == "autonomous"
    assert svc.normalize_mode("suggest") == "assisted"
    assert svc.normalize_mode("off") == "manual"
    assert svc.normalize_mode({"mode": "assisted"}) == "assisted"
    assert svc.normalize_mode("nonsense") is None


def test_breaker_caps_channel_at_assisted():
    tenant = _tenant(_allow())
    account = _account("autonomous", breaker_tripped_at="2026-01-01T00:00:00")
    handling = svc.resolve_ai_handling(tenant, account, scope="channel")
    assert handling.effective == "assisted"
    assert handling.clamped_by == "breaker"

    # Manual still wins over the breaker cap.
    signal = Signal(tenant_id=uuid4(), channel="email", ai_handling="manual")
    assert svc.resolve_ai_handling(tenant, account, None, signal).effective == "manual"


def test_privacy_off_forces_manual():
    tenant = _tenant({**_allow(), "privacy": {"llm_may_use_message_bodies": False}})
    assert svc.governance_ceiling(tenant) == ("manual", "privacy")
    handling = svc.resolve_ai_handling(tenant)
    assert handling.effective == "manual"
    assert handling.clamped_by == "privacy"


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


def test_can_set_lowering_is_free_raising_is_guarded():
    assert svc.can_set("owner", "workspace", "autonomous")
    assert svc.can_set("admin", "channel", "autonomous")
    assert svc.can_set("member", "channel", "manual")
    assert svc.can_set("member", "contact", None)
    assert not svc.can_set("member", "workspace", "manual")
    assert not svc.can_set("member", "channel", "autonomous")
    assert not svc.can_set("member", "contact", "autonomous")
    assert not svc.can_set("member", "conversation", "autonomous", inherited_effective="assisted")
    assert svc.can_set("member", "conversation", "autonomous", inherited_effective="autonomous")


# ---------------------------------------------------------------------------
# Safeguards
# ---------------------------------------------------------------------------


async def _persisted_tenant(session: AsyncSession, settings: dict) -> Tenant:
    tenant = _tenant(settings)
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


@pytest.mark.asyncio
async def test_safeguards_downgrade_autonomous(session_override: AsyncSession):
    tenant = await _persisted_tenant(session_override, _allow())
    signal = Signal(tenant_id=tenant.id, channel="email", certainty=3, status="open")
    session_override.add(signal)
    await session_override.commit()

    handling = svc.resolve_ai_handling(tenant, None, None, signal)
    assert handling.effective == "autonomous"
    run_mode, reason = await svc.apply_safeguards(session_override, tenant, signal, handling)
    assert (run_mode, reason) == ("assisted", "low_certainty")
    await session_override.commit()
    event = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == signal.id,
                SignalEvent.event_type == "ai_handling_downgraded",
            )
        )
    ).scalars().first()
    assert event is not None

    signal.certainty = 9
    pending = Contact(tenant_id=tenant.id, address="new@x.test", status="pending")
    run_mode, reason = await svc.apply_safeguards(
        session_override, tenant, signal, handling, contact=pending
    )
    assert (run_mode, reason) == ("assisted", "new_contact")

    # Widget visitors are always pending: that safeguard skips the widget.
    widget = Signal(tenant_id=tenant.id, channel="widget", certainty=9, status="open")
    session_override.add(widget)
    await session_override.commit()
    run_mode, _ = await svc.apply_safeguards(
        session_override, tenant, widget, svc.resolve_ai_handling(tenant, None, None, widget),
        contact=pending,
    )
    assert run_mode == "autonomous"


@pytest.mark.asyncio
async def test_safeguards_leave_assisted_alone(session_override: AsyncSession):
    tenant = await _persisted_tenant(session_override, _allow("assisted"))
    signal = Signal(tenant_id=tenant.id, channel="email", certainty=1)
    session_override.add(signal)
    await session_override.commit()
    handling = svc.resolve_ai_handling(tenant, None, None, signal)
    assert await svc.apply_safeguards(session_override, tenant, signal, handling) == ("assisted", None)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_close_clears_and_assignment_does_not_hold(session_override: AsyncSession):
    tenant = await _persisted_tenant(session_override, _allow())
    signal = Signal(tenant_id=tenant.id, channel="email", status="open", ai_handling="assisted")
    session_override.add(signal)
    await session_override.commit()

    signal.status = "closed"
    svc.on_status_change(session_override, signal)
    assert signal.ai_handling is None

    # Owner and AI handling are two settings: assigning a person keeps the
    # channel's handling (the agent drafts for them).
    signal.status = "open"
    user_id = uuid4()
    signal.assigned_user_id = user_id
    signal.assignee_kind = "user"
    svc.on_assignment_change(session_override, signal, before_assignee=None, before_kind="team")
    assert signal.ai_handling is None

    # A customer handoff is not released by moving it to a team or another person.
    svc.hold_conversation(session_override, signal, reason=svc.REASON_HANDOFF)
    signal.assigned_user_id = None
    signal.assignee_kind = "team"
    svc.on_assignment_change(session_override, signal, before_assignee=user_id, before_kind="user")
    assert signal.ai_handling == "manual"
    assert signal.ai_handling_reason == svc.REASON_HANDOFF

    # Handing it to an agent explicitly releases every hold.
    signal.agent_id = uuid4()
    signal.assignee_kind = "agent"
    svc.on_assignment_change(session_override, signal, before_assignee=None, before_kind="team")
    assert signal.ai_handling is None


# ---------------------------------------------------------------------------
# Converge mapping (SQLite dev / Alembic 055)
# ---------------------------------------------------------------------------


def test_converge_maps_legacy_settings():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE tenants (id TEXT PRIMARY KEY, settings_json TEXT)"))
        conn.execute(
            text(
                "CREATE TABLE channel_accounts (id TEXT PRIMARY KEY, tenant_id TEXT, "
                "channel TEXT, settings_json TEXT)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE signals (id TEXT PRIMARY KEY, ai_paused BOOLEAN, "
                "ai_handling TEXT, ai_handling_reason TEXT)"
            )
        )
        conn.execute(
            text("INSERT INTO tenants VALUES ('t1', :s)"),
            {
                "s": json.dumps(
                    {
                        "channel_ai_modes": {"email": "off"},
                        "inbox": {"autonomous_reply": True, "certainty_threshold": 8},
                    }
                )
            },
        )
        conn.execute(text("INSERT INTO channel_accounts VALUES ('a1', 't1', 'email', '{}')"))
        conn.execute(
            text("INSERT INTO channel_accounts VALUES ('a2', 't1', 'widget', '{}')")
        )
        conn.execute(
            text("INSERT INTO channel_accounts VALUES ('a3', 't1', 'email', :s)"),
            {"s": json.dumps({"ai_config": {"mode": "suggest", "tone": "formal"}})},
        )
        conn.execute(text("INSERT INTO signals VALUES ('s1', 1, NULL, NULL)"))
        conn.execute(text("INSERT INTO signals VALUES ('s2', 0, NULL, NULL)"))

        converge_sqlite(conn)
        converge_sqlite(conn)  # idempotent

        settings = json.loads(conn.execute(text("SELECT settings_json FROM tenants")).scalar())
        assert settings["ai_handling"]["default"]["mode"] == "assisted"
        assert settings["ai_handling"]["safeguards"]["certainty_threshold"] == 8
        assert "channel_ai_modes" not in settings
        assert "inbox" not in settings

        rows = {
            r[0]: json.loads(r[1])["ai_config"]
            for r in conn.execute(text("SELECT id, settings_json FROM channel_accounts"))
        }
        assert rows["a1"]["ai_handling"] == {"mode": "manual"}
        assert rows["a2"]["ai_handling"] == {"mode": "autonomous"}
        assert "ai_handling" not in rows["a3"]
        assert "mode" not in rows["a3"]
        assert rows["a3"]["tone"] == "formal"

        signals = dict(conn.execute(text("SELECT id, ai_handling FROM signals")).all())
        assert signals == {"s1": "manual", "s2": None}
        columns = [r[1] for r in conn.execute(text("PRAGMA table_info(signals)"))]
        assert "ai_paused" not in columns


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


async def _headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _seed_tenant(session: AsyncSession) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _email_account(session: AsyncSession, tenant: Tenant) -> ChannelAccount:
    return (
        await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id, ChannelAccount.channel == "email"
            )
        )
    ).scalars().first()


@pytest.mark.asyncio
async def test_overview_and_workspace_roundtrip(client: AsyncClient, session_override: AsyncSession):
    headers = await _headers(client)
    overview = await client.get("/api/ai-handling", headers=headers)
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert [entry["id"] for entry in body["catalog"]] == ["autonomous", "assisted", "manual"]
    assert body["can_raise"] is True
    assert body["disclosure"]["enabled"] is True
    assert "Test Tenant" in (body["disclosure_preview"] or "")

    saved = await client.put(
        "/api/ai-handling/workspace/current", headers=headers, json={"mode": "manual"}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["effective"] == "manual"
    audits = (
        await session_override.execute(
            select(AuditEvent).where(AuditEvent.action == "ai_handling:changed")
        )
    ).scalars().all()
    assert len(audits) == 1

    cleared = await client.put(
        "/api/ai-handling/workspace/current", headers=headers, json={"mode": None}
    )
    assert cleared.status_code == 400


@pytest.mark.asyncio
async def test_metrics_count_open_conversations_by_mode(client: AsyncClient, session_override: AsyncSession):
    headers = await _headers(client)
    await client.put("/api/ai-handling/workspace/current", headers=headers, json={"mode": "manual"})
    metrics = await client.get("/api/ai-handling/metrics", headers=headers)
    assert metrics.status_code == 200, metrics.text
    body = metrics.json()
    assert body["days"] == 30
    assert set(body["open_by_mode"]) == {"autonomous", "assisted", "manual"}
    assert sum(body["open_by_mode"].values()) == body["open_total"]
    assert body["open_by_mode"]["autonomous"] == 0


@pytest.mark.asyncio
async def test_govern_ask_caps_autonomous_channel(client: AsyncClient, session_override: AsyncSession):
    headers = await _headers(client)
    tenant = await _seed_tenant(session_override)
    tenant.settings_json = json.dumps({"tool_allowances": {"messaging": "ask"}})
    session_override.add(tenant)
    await session_override.commit()
    account = await _email_account(session_override, tenant)

    res = await client.put(
        f"/api/ai-handling/channel/{account.id}", headers=headers, json={"mode": "autonomous"}
    )
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["requested"] == "autonomous"
    assert payload["own"] == "autonomous"
    assert payload["ceiling"] == "assisted"
    assert payload["effective"] == "assisted"
    assert payload["clamped_by"] == "govern"


@pytest.mark.asyncio
async def test_member_cannot_raise_channel(client: AsyncClient, session_override: AsyncSession):
    headers = await _headers(client)
    tenant = await _seed_tenant(session_override)
    membership = (
        await session_override.execute(select(Membership).where(Membership.tenant_id == tenant.id))
    ).scalars().first()
    membership.role = "member"
    session_override.add(membership)
    await session_override.commit()
    account = await _email_account(session_override, tenant)

    denied = await client.put(
        f"/api/ai-handling/channel/{account.id}", headers=headers, json={"mode": "autonomous"}
    )
    assert denied.status_code == 403
    lowered = await client.put(
        f"/api/ai-handling/channel/{account.id}", headers=headers, json={"mode": "manual"}
    )
    assert lowered.status_code == 200, lowered.text

    preview = await client.get(
        f"/api/ai-handling/channel/{account.id}/preview",
        headers=headers,
        params={"mode": "autonomous"},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["allowed"] is False
    assert preview.json()["evidence"]["days"] == 30

    settings = await client.put(
        "/api/ai-handling/settings",
        headers=headers,
        json={"disclosure": {"enabled": False, "text": ""}},
    )
    assert settings.status_code == 403


@pytest.mark.asyncio
async def test_contact_override_logs_on_open_threads(client: AsyncClient, session_override: AsyncSession):
    headers = await _headers(client)
    tenant = await _seed_tenant(session_override)
    contact = Contact(tenant_id=tenant.id, address="vip@client.test", display_name="VIP")
    session_override.add(contact)
    await session_override.flush()
    thread = Signal(tenant_id=tenant.id, channel="email", status="open", contact_id=contact.id)
    session_override.add(thread)
    await session_override.commit()

    res = await client.put(
        f"/api/ai-handling/contact/{contact.id}", headers=headers, json={"mode": "manual"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["source"] == "contact"

    detail = await client.get(f"/api/signals/{thread.id}", headers=headers)
    assert detail.json()["thread"]["ai_handling"]["effective"] == "manual"
    assert detail.json()["thread"]["ai_handling"]["source"] == "contact"

    event = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == thread.id,
                SignalEvent.event_type == "ai_handling_changed",
            )
        )
    ).scalars().first()
    assert event is not None
    assert json.loads(event.payload_json)["scope"] == "contact"

    listing = await client.get(
        "/api/channels/contacts", headers=headers, params={"ai_handling": "manual"}
    )
    assert listing.status_code == 200, listing.text
    rows = listing.json()
    rows = rows.get("contacts", rows) if isinstance(rows, dict) else rows
    assert [row["id"] for row in rows] == [str(contact.id)]
    assert rows[0]["ai_handling"] == "manual"


@pytest.mark.asyncio
async def test_settings_update_is_audited(client: AsyncClient, session_override: AsyncSession):
    headers = await _headers(client)
    res = await client.put(
        "/api/ai-handling/settings",
        headers=headers,
        json={
            "safeguards": {"certainty_threshold": 9, "new_contacts": False},
            "breaker": {"enabled": True, "max_autonomous_per_hour": 5, "max_negative_per_hour": 2},
            "disclosure": {"enabled": False, "text": ""},
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["safeguards"]["certainty_threshold"] == 9
    assert body["breaker"]["max_autonomous_per_hour"] == 5
    assert body["disclosure_preview"] is None
    audit = (
        await session_override.execute(
            select(AuditEvent).where(AuditEvent.action == "ai_handling:settings")
        )
    ).scalars().first()
    assert audit is not None


# ---------------------------------------------------------------------------
# Breaker
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_breaker_trips_and_resets(client: AsyncClient, session_override: AsyncSession):
    headers = await _headers(client)
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    tenant.settings_json = json.dumps(
        _allow(breaker={"enabled": True, "max_autonomous_per_hour": 1, "max_negative_per_hour": 3})
    )
    session_override.add(tenant)
    account = await _email_account(session_override, tenant)
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    thread = Signal(
        tenant_id=tenant.id, channel="email", status="open", channel_account_id=account.id
    )
    session_override.add(thread)
    await session_override.flush()
    for _ in range(2):
        session_override.add(
            SignalMessage(
                signal_id=thread.id,
                tenant_id=tenant.id,
                direction="outbound",
                role="assistant",
                author_agent_id=agent.id,
                auto_sent=True,
            )
        )
    await session_override.commit()

    assert svc.resolve_ai_handling(tenant, account, scope="channel").effective == "autonomous"
    assert await svc.check_breaker(session_override, tenant, account) is True
    await session_override.refresh(account)
    assert svc.breaker_tripped_at(account)
    handling = svc.resolve_ai_handling(tenant, account, scope="channel")
    assert handling.effective == "assisted"
    assert handling.clamped_by == "breaker"

    pill = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == thread.id,
                SignalEvent.event_type == "ai_breaker_tripped",
            )
        )
    ).scalars().first()
    assert pill is not None
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.tenant_id == tenant.id)
        )
    ).scalars().all()
    assert any("Autonomous paused" in d.title for d in decision)

    # Already tripped: no second decision.
    assert await svc.check_breaker(session_override, tenant, account) is False

    reset = await client.post(
        f"/api/ai-handling/channel/{account.id}/reset-breaker",
        headers=headers,
        params={"keep_assisted": "true"},
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["own"] == "assisted"
    await session_override.refresh(account)
    assert svc.breaker_tripped_at(account) is None


# ---------------------------------------------------------------------------
# Disclosure
# ---------------------------------------------------------------------------


def test_disclosure_defaults_and_custom_text():
    tenant = _tenant()
    assert svc.disclosure_text(tenant, language="nl") == "Beantwoord door de AI-assistent van Acme."
    assert svc.disclosure_text(tenant, language="en") == "Answered by the AI assistant of Acme."

    custom = _tenant({"ai_handling": {"disclosure": {"enabled": True, "text": "AI reply from {company}"}}})
    assert svc.disclosure_text(custom) == "AI reply from Acme"

    off = _tenant({"ai_handling": {"disclosure": {"enabled": False}}})
    assert svc.disclosure_text(off) is None
