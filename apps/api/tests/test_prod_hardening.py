"""Cycle 30: production hardening — no silent mocks, per-folder sync,
rate limits, and audit events on sensitive endpoints."""

import json
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings, validate_production_settings
from app.models.audit import AuditEvent
from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _prod_settings(**overrides) -> Settings:
    base = dict(
        environment="prod",
        jwt_secret="x" * 40,
        llm_mode="live",
        anthropic_api_key="key",
        cors_origins="https://app.bokito.ai",
        worker_inbound_secret="strong-worker-secret-123",
        bokito_mock_execution=False,
        # Dedicated Fernet key required in production (not JWT-derived).
        credentials_fernet_key="dev-test-credentials-fernet-key-32b",
    )
    base.update(overrides)
    return Settings(**base)


# --- Prod config validation ---------------------------------------------------


def test_prod_validation_ok_baseline():
    assert validate_production_settings(_prod_settings()) == []


def test_prod_validation_rejects_mock_llm():
    errors = validate_production_settings(_prod_settings(llm_mode="mock"))
    assert any("LLM_MODE" in e for e in errors)


def test_prod_validation_rejects_mock_execution():
    errors = validate_production_settings(_prod_settings(bokito_mock_execution=True))
    assert any("BOKITO_MOCK_EXECUTION" in e for e in errors)


# --- Mock MCP refusal in prod ---------------------------------------------------


@pytest.mark.asyncio
async def test_install_mcp_refuses_mock_in_prod(
    session_override: AsyncSession, monkeypatch
):
    from app.services.integrations_platform import install_mcp

    tenant = Tenant(slug=f"t-{uuid4().hex[:8]}", name="Prod Hardening")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    monkeypatch.setattr(get_settings(), "environment", "prod")

    # Bjorn Lunden without credentials is refused in production.
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as missing:
        await install_mcp(
            session_override, tenant.id, provider="bjorn_lunden_mcp", api_key=""
        )
    assert missing.value.status_code == 400

    # Providers without a native integration or URL -> 422 asking for one.
    with pytest.raises(HTTPException) as no_url:
        await install_mcp(
            session_override, tenant.id, provider="custom_mcp", api_key="k"
        )
    assert no_url.value.status_code == 422

    # Explicit mock URL -> refused.
    with pytest.raises(HTTPException) as mock_url:
        await install_mcp(
            session_override,
            tenant.id,
            provider="custom_mcp",
            api_key="k",
            server_url="mock://local/mcp",
        )
    assert mock_url.value.status_code == 422


@pytest.mark.asyncio
async def test_call_mcp_tool_refuses_mock_in_prod(
    session_override: AsyncSession, monkeypatch
):
    from app.models.integration import McpServer
    from app.services.agent.mcp_client import call_mcp_tool

    tenant = Tenant(slug=f"t-{uuid4().hex[:8]}", name="Prod MCP")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    server = McpServer(
        tenant_id=tenant.id, name="Legacy Mock", server_url="mock://local/mcp"
    )
    session_override.add(server)
    await session_override.commit()

    monkeypatch.setattr(get_settings(), "environment", "prod")
    result = await call_mcp_tool(
        session_override,
        tenant.id,
        {"server_name": "Legacy Mock", "tool_name": "search", "arguments": {}},
    )
    assert "error" in result
    assert "mock" in result["error"].lower()


@pytest.mark.asyncio
async def test_platform_oauth_start_no_mock_fallback_in_prod(
    client: AsyncClient, monkeypatch
):
    headers = await _login(client)
    monkeypatch.setattr(get_settings(), "environment", "prod")
    res = await client.get(
        "/api/integrations/oauth/start",
        params={"provider": "outlook", "return_url": "https://app.bokito.ai/x"},
        headers=headers,
    )
    assert res.status_code == 503


# --- Per-folder email sync ------------------------------------------------------


@pytest.mark.asyncio
async def test_sync_polls_selected_folders_with_per_folder_cursors(
    session_override: AsyncSession, monkeypatch
):
    from app.services import email_sync

    tenant = Tenant(slug=f"t-{uuid4().hex[:8]}", name="Folder Sync")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        provider="outlook",
        address="folders@test.local",
        is_enabled=True,
        credentials_json=json.dumps({"access_token": "tok"}),
        settings_json=json.dumps(
            {
                "sync_folders": [
                    {"id": "inbox", "display_name": "Inbox", "is_selected": True},
                    {"id": "sent", "display_name": "Sent items", "is_selected": True},
                    {"id": "junk", "display_name": "Spam", "is_selected": False},
                ]
            }
        ),
    )
    session_override.add(account)
    await session_override.commit()
    await session_override.refresh(account)

    polled: list[tuple[str, str]] = []

    async def fake_fetch(acct, token, folder_id, cursor, since=None):
        polled.append((folder_id, cursor))
        return (
            [
                {
                    "from_address": f"{folder_id}@example.test",
                    "from_name": "Sender",
                    "subject": f"Message in {folder_id}",
                    "body_text": "hello",
                    "message_id": f"msg-{folder_id}-1",
                    "thread_id": f"thread-{folder_id}",
                }
            ],
            f"cursor-{folder_id}",
        )

    monkeypatch.setattr(email_sync, "_fetch_messages", fake_fetch)

    result = await email_sync.sync_account(session_override, account)
    assert result["status"] == "ok"
    assert result["fetched"] == 2

    # Selected folders polled, unselected junk skipped.
    assert [f for f, _ in polled] == ["inbox", "sent"]

    settings = json.loads(account.settings_json)
    assert settings["sync_cursors"] == {
        "inbox": "cursor-inbox",
        "sent": "cursor-sent",
    }
    # Legacy account-level cursor mirrors the inbox cursor.
    assert account.sync_cursor == "cursor-inbox"

    # Second tick reuses per-folder cursors.
    polled.clear()
    await email_sync.sync_account(session_override, account)
    assert polled == [("inbox", "cursor-inbox"), ("sent", "cursor-sent")]


def test_gmail_folder_mapping_skips_archive():
    from app.services.email_sync import GMAIL_LABEL_IDS, GRAPH_FOLDER_NAMES

    assert "archive" not in GMAIL_LABEL_IDS
    assert GMAIL_LABEL_IDS["inbox"] == "INBOX"
    assert GRAPH_FOLDER_NAMES["sent"] == "sentitems"
    assert GRAPH_FOLDER_NAMES["junk"] == "junkemail"


# --- Rate limits ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_email_sync_rate_limited(client: AsyncClient, monkeypatch):
    headers = await _login(client)

    async def fake_sync_tenant(session, tenant_id):
        return []

    from app.services import email_sync

    monkeypatch.setattr(email_sync, "sync_tenant", fake_sync_tenant)

    statuses = []
    for _ in range(7):
        res = await client.post("/api/email/sync", headers=headers)
        statuses.append(res.status_code)
    assert statuses[:6] == [200] * 6
    assert statuses[6] == 429


# --- Audit events ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_mailbox_disconnect_records_audit(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    listing = await client.get("/api/email/accounts", headers=headers)
    assert listing.status_code == 200
    connections = listing.json()
    assert connections
    conn_id = connections[0]["id"]

    res = await client.delete(f"/api/email/connections/{conn_id}", headers=headers)
    assert res.status_code == 200

    events = (
        (
            await session_override.execute(
                select(AuditEvent).where(
                    AuditEvent.action == "email:mailbox_disconnected"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(events) == 1
    assert events[0].actor_type == "user"


@pytest.mark.asyncio
async def test_mailbox_disconnect_detaches_referencing_rows(
    client: AsyncClient, session_override: AsyncSession
):
    """Disconnect must not 500 when threads/rules/bindings reference the
    account (Postgres enforces the FKs in production): threads are detached
    and kept, per-mailbox rules and bindings are removed."""
    from app.models.agent import Agent
    from app.models.channel import ChannelBinding
    from app.models.email_routing import EmailRoutingRule
    from app.models.signal import Signal

    headers = await _login(client)
    listing = await client.get("/api/email/accounts", headers=headers)
    assert listing.status_code == 200
    connections = listing.json()
    assert connections
    conn_id = connections[0]["id"]

    account = (
        (await session_override.execute(select(ChannelAccount).limit(1)))
        .scalars()
        .first()
    )
    assert account is not None
    tenant_id = account.tenant_id

    agent = (
        (
            await session_override.execute(
                select(Agent).where(Agent.tenant_id == tenant_id).limit(1)
            )
        )
        .scalars()
        .first()
    )
    assert agent is not None

    signal = Signal(
        tenant_id=tenant_id,
        channel="email",
        subject="Disconnect FK check",
        channel_account_id=account.id,
    )
    rule = EmailRoutingRule(
        tenant_id=tenant_id,
        channel_account_id=account.id,
        condition_type="sender_domain",
        condition_value="example.com",
    )
    binding = ChannelBinding(
        tenant_id=tenant_id,
        channel="email",
        channel_account_id=account.id,
        agent_id=agent.id,
    )
    session_override.add_all([signal, rule, binding])
    await session_override.commit()
    signal_id = signal.id
    rule_id = rule.id
    binding_id = binding.id

    res = await client.delete(f"/api/email/connections/{conn_id}", headers=headers)
    assert res.status_code == 200

    session_override.expire_all()
    kept_signal = (
        (await session_override.execute(select(Signal).where(Signal.id == signal_id)))
        .scalars()
        .first()
    )
    assert kept_signal is not None
    assert kept_signal.channel_account_id is None
    assert (
        (
            await session_override.execute(
                select(EmailRoutingRule).where(EmailRoutingRule.id == rule_id)
            )
        )
        .scalars()
        .first()
        is None
    )
    assert (
        (
            await session_override.execute(
                select(ChannelBinding).where(ChannelBinding.id == binding_id)
            )
        )
        .scalars()
        .first()
        is None
    )


@pytest.mark.asyncio
async def test_mcp_install_records_audit(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    res = await client.post(
        "/api/integrations/mcp/install",
        headers=headers,
        json={
            "provider": "custom_mcp",
            "api_key": "key-123",
            "display_name": "Test MCP",
            "server_url": "mock://local/mcp",
        },
    )
    assert res.status_code == 200

    events = (
        (
            await session_override.execute(
                select(AuditEvent).where(AuditEvent.action == "integration:mcp_installed")
            )
        )
        .scalars()
        .all()
    )
    assert len(events) == 1
    assert events[0].payload_json and "custom_mcp" in events[0].payload_json
