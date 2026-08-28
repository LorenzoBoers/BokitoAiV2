"""Integrations platform service (marketplace, connections, MCP, OAuth mock)."""

import json
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.channel import ChannelAccount
from app.models.integration import IntegrationBinding, IntegrationConnection, McpServer
from app.services.integrations_catalog import PROVIDERS, PROVIDER_BY_SLUG, provider_id
from app.services.mcp_auth import mcp_auth_headers as _mcp_auth_headers


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _append_query(url: str, params: dict[str, str]) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update(params)
    return urlunparse(parsed._replace(query=urlencode(query)))


def mock_authorize_url(return_url: str, params: dict[str, str]) -> str:
    return _append_query(return_url, params)


def serialize_connection(conn: IntegrationConnection) -> dict[str, Any]:
    meta = _parse_json(conn.metadata_json)
    slug = conn.provider
    pid = provider_id(slug) if slug in PROVIDER_BY_SLUG else str(conn.id)
    if slug in PROVIDER_BY_SLUG:
        pid = PROVIDER_BY_SLUG[slug]["id"]
    return {
        "id": str(conn.id),
        "tenant_id": str(conn.tenant_id),
        "provider_id": pid,
        "external_account_id": meta.get("external_account_id", conn.display_name),
        "display_name": conn.display_name or slug,
        "status": conn.status if conn.status in ("active", "revoked", "error") else "active",
        "metadata": meta,
        "created_at": conn.created_at.isoformat() if conn.created_at else None,
        "updated_at": conn.created_at.isoformat() if conn.created_at else None,
    }


async def connection_counts(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    by_provider: dict[str, int] = {}
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.status == "active",
        )
    )
    for conn in result.scalars().all():
        if conn.provider in PROVIDER_BY_SLUG:
            pid = PROVIDER_BY_SLUG[conn.provider]["id"]
            by_provider[pid] = by_provider.get(pid, 0) + 1

    email_result = await session.execute(
        select(ChannelAccount.provider, func.count())
        .where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.channel == "email",
            ChannelAccount.is_enabled.is_(True),
        )
        .group_by(ChannelAccount.provider)
    )
    outlook = 0
    gmail = 0
    for provider, count in email_result.all():
        if provider == "outlook":
            outlook = int(count)
        elif provider in ("gmail", "mock"):
            gmail += int(count)

    return {
        "by_provider_id": by_provider,
        "email_outlook": outlook,
        "email_gmail": gmail,
    }


async def list_providers(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    from app.modules.catalog import serialize_modules_for_tenant

    counts = await connection_counts(session, tenant_id)
    hosts = []
    seen_hosts: set[str] = set()
    for p in PROVIDERS:
        host = p.get("host")
        if host and host["id"] not in seen_hosts:
            hosts.append(host)
            seen_hosts.add(host["id"])
    return {
        "providers": sorted(PROVIDERS, key=lambda p: p.get("sort_order", 0)),
        "hosts": hosts,
        "connection_counts": counts,
        "modules": await serialize_modules_for_tenant(session, tenant_id),
    }


async def list_connections(
    session: AsyncSession, tenant_id: UUID, provider_slug: str | None = None
) -> list[dict[str, Any]]:
    query = select(IntegrationConnection).where(IntegrationConnection.tenant_id == tenant_id)
    if provider_slug:
        query = query.where(IntegrationConnection.provider == provider_slug)
    result = await session.execute(query.order_by(IntegrationConnection.created_at.desc()))
    return [serialize_connection(c) for c in result.scalars().all()]


async def revoke_connection(session: AsyncSession, tenant_id: UUID, connection_id: UUID) -> None:
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.id == connection_id,
            IntegrationConnection.tenant_id == tenant_id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    conn.status = "revoked"
    session.add(conn)
    bindings = await session.execute(
        select(IntegrationBinding).where(
            IntegrationBinding.connection_id == connection_id,
            IntegrationBinding.tenant_id == tenant_id,
        )
    )
    for binding in bindings.scalars().all():
        await session.delete(binding)
    await session.commit()


async def create_api_key_connection(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    provider: str,
    api_key: str,
    display_name: str | None = None,
) -> dict[str, Any]:
    if provider not in PROVIDER_BY_SLUG:
        raise HTTPException(status_code=400, detail="Unknown provider")
    conn = IntegrationConnection(
        tenant_id=tenant_id,
        provider=provider,
        display_name=display_name or PROVIDER_BY_SLUG[provider]["name"],
        status="active",
        credentials_json=json.dumps({"api_key": api_key}),
        metadata_json=json.dumps({"auth_type": "api_key"}),
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    from app.modules.catalog import enable_module_for_provider

    await enable_module_for_provider(session, tenant_id, provider)
    return serialize_connection(conn)


async def install_mcp(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    provider: str,
    api_key: str,
    display_name: str | None = None,
    server_url: str | None = None,
    auth_type: str = "api_key",
    mcp_server_id: int | None = None,
    auth: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if provider not in PROVIDER_BY_SLUG:
        raise HTTPException(status_code=400, detail="Unknown provider")
    url = server_url or PROVIDER_BY_SLUG[provider].get("mcp_remote_url") or ""
    if not url and provider == "bjorn_lunden_mcp":
        # Björn Lundén runs natively against the BLA REST API — no separate
        # MCP process (and no Xano) needed, in dev or production.
        from app.services.bjorn_lunden import BL_NATIVE_URL

        url = BL_NATIVE_URL
    if not url and provider == "king_accountancy":
        from app.services.king_finance import KING_NATIVE_URL

        url = KING_NATIVE_URL
    if not url:
        if get_settings().is_production:
            raise HTTPException(
                status_code=422,
                detail=(
                    "This integration has no MCP server URL configured. "
                    "Provide server_url (the provider's MCP endpoint) to install it."
                ),
            )
        url = "mock://local/mcp"
    if url.startswith("mock://") and get_settings().is_production:
        raise HTTPException(
            status_code=422,
            detail="Mock MCP servers are not allowed in production. Provide a real server_url.",
        )
    auth_payload: dict[str, Any] = {"api_key": api_key, "auth_type": auth_type}
    if isinstance(auth, dict):
        # Preserve bearer_token / custom headers alongside the api_key.
        auth_payload.update({k: v for k, v in auth.items() if v is not None})
        auth_payload["auth_type"] = auth.get("auth_type") or auth_type
    server = McpServer(
        tenant_id=tenant_id,
        name=display_name or PROVIDER_BY_SLUG[provider]["name"],
        server_url=url,
        auth_json=json.dumps(auth_payload),
    )
    session.add(server)
    await session.flush()
    meta = {
        "auth_type": auth_type,
        "server_url": url,
        "mcp_server_id": str(server.id),
    }
    if mcp_server_id is not None:
        meta["platform_mcp_server_id"] = mcp_server_id
    conn = IntegrationConnection(
        tenant_id=tenant_id,
        provider=provider,
        display_name=display_name or server.name,
        status="active",
        credentials_json=json.dumps({"api_key": api_key}),
        metadata_json=json.dumps(meta),
    )
    session.add(conn)
    await session.flush()
    binding = IntegrationBinding(
        tenant_id=tenant_id,
        connection_id=conn.id,
        binding_type="mcp_server",
        config_json=json.dumps(
            {
                "mcp_server_id": str(server.id),
                "provider": provider,
                "server_url": url,
                "auth_type": auth_type,
            }
        ),
    )
    session.add(binding)
    await session.commit()
    await session.refresh(conn)
    await session.refresh(binding)
    # Best-effort tool discovery so agents see the server's tools immediately.
    discovery: dict[str, Any] | None = None
    try:
        discovery = await test_mcp_server(session, tenant_id, server.id)
    except Exception:
        discovery = None
    from app.modules.catalog import enable_module_for_provider

    await enable_module_for_provider(session, tenant_id, provider)
    return {
        "connection": serialize_connection(conn),
        "binding": {"id": str(binding.id), "config": _parse_json(binding.config_json)},
        "discovery": discovery,
    }


async def ensure_oauth_connection(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    *,
    display_name: str | None = None,
    connection_id: UUID | None = None,
    create_new: bool = False,
) -> dict[str, Any]:
    """Ensure an OAuth registration exists.

    By default creates a new registration when ``create_new`` is true or when
    no active row exists. Pass ``connection_id`` to update a specific row
    instead of inventing a second account.
    """
    if provider not in PROVIDER_BY_SLUG:
        raise HTTPException(status_code=400, detail="Unknown provider")
    if connection_id is not None:
        existing = await session.get(IntegrationConnection, connection_id)
        if existing is None or existing.tenant_id != tenant_id:
            raise HTTPException(status_code=404, detail="Connection not found")
        if display_name:
            existing.display_name = display_name
            session.add(existing)
            await session.commit()
            await session.refresh(existing)
        return serialize_connection(existing)

    if not create_new:
        result = await session.execute(
            select(IntegrationConnection)
            .where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.provider == provider,
                IntegrationConnection.status == "active",
            )
            .order_by(IntegrationConnection.created_at.asc())
            .limit(1)
        )
        existing = result.scalar_one_or_none()
        if existing:
            return serialize_connection(existing)

    label = display_name or PROVIDER_BY_SLUG[provider]["name"]
    # Distinguish multiple registrations of the same provider.
    if create_new:
        count_result = await session.execute(
            select(func.count())
            .select_from(IntegrationConnection)
            .where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.provider == provider,
            )
        )
        n = int(count_result.scalar_one() or 0)
        if n > 0 and display_name is None:
            label = f"{PROVIDER_BY_SLUG[provider]['name']} ({n + 1})"

    conn = IntegrationConnection(
        tenant_id=tenant_id,
        provider=provider,
        display_name=label,
        status="active",
        metadata_json=json.dumps({"auth_type": "oauth2"}),
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    from app.modules.catalog import enable_module_for_provider

    await enable_module_for_provider(session, tenant_id, provider)
    return serialize_connection(conn)


async def list_mcp_bindings(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    bindings_result = await session.execute(
        select(IntegrationBinding, IntegrationConnection)
        .join(IntegrationConnection, IntegrationConnection.id == IntegrationBinding.connection_id)
        .where(
            IntegrationBinding.tenant_id == tenant_id,
            IntegrationBinding.binding_type == "mcp_server",
            IntegrationConnection.status == "active",
        )
    )
    bindings: list[dict[str, Any]] = []
    server_ids: set[str] = set()
    for binding, conn in bindings_result.all():
        config = _parse_json(binding.config_json)
        sid = config.get("mcp_server_id")
        if sid is not None:
            server_ids.add(str(sid))
        bindings.append(
            {
                "id": str(binding.id),
                "connection_id": str(conn.id),
                "config": config,
            }
        )
    if not server_ids:
        servers = await session.execute(
            select(McpServer).where(McpServer.tenant_id == tenant_id, McpServer.is_active.is_(True))
        )
        server_ids = {str(s.id) for s in servers.scalars().all()}
    return {"bindings": bindings, "mcp_server_ids": list(server_ids)}


# Mock discovery set for accounting-suite MCP servers (Björn Lundén / King)
# so tenants can wire the full flow before real credentials exist.
_ACCOUNTING_MOCK_TOOLS: list[dict[str, str]] = [
    {"name": "search_customers", "description": "Search customers by name, number, or email"},
    {"name": "get_customer", "description": "Fetch one customer with contact and balance details"},
    {"name": "list_invoices", "description": "List invoices filtered by customer, status, or period"},
    {"name": "get_invoice", "description": "Fetch a single invoice with lines and payment status"},
    {"name": "list_ledger_entries", "description": "List general ledger entries for an account/period"},
    {"name": "get_account_balance", "description": "Get the balance of a ledger account"},
    {"name": "list_vat_reports", "description": "List VAT report periods and their status"},
]


def _is_accounting_server(name: str) -> bool:
    lowered = name.lower()
    return any(k in lowered for k in ("björn", "bjorn", "lunden", "lundén", "king", "account"))


def _mock_discovery_tools(server_name: str) -> list[dict[str, str]]:
    if _is_accounting_server(server_name):
        return [dict(t) for t in _ACCOUNTING_MOCK_TOOLS]
    return [{"name": "mock_tool", "description": "Mock MCP tool for local development"}]


async def _persist_discovered_tools(
    session: AsyncSession, server: McpServer, tools: list[dict[str, str]]
) -> None:
    from datetime import datetime

    server.tools_json = json.dumps(tools)
    server.tools_synced_at = datetime.utcnow()
    session.add(server)
    await session.commit()


async def test_mcp_server(
    session: AsyncSession, tenant_id: UUID, server_id: UUID
) -> dict[str, Any]:
    import httpx

    result = await session.execute(
        select(McpServer).where(McpServer.id == server_id, McpServer.tenant_id == tenant_id)
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    if server.server_url.startswith("native://king-accountancy"):
        from app.services.king_finance import KING_NATIVE_TOOLS
        from app.services.king_finance import validate_credentials as validate_king_credentials

        auth_data = _parse_json(server.auth_json)
        check = await validate_king_credentials(auth_data if isinstance(auth_data, dict) else {})
        tools = [dict(t) for t in KING_NATIVE_TOOLS]
        await _persist_discovered_tools(session, server, tools)
        payload: dict[str, Any] = {
            "ok": bool(check.get("ok")),
            "server_id": str(server.id),
            "server_name": server.name,
            "tool_count": len(tools),
            "tools": tools,
        }
        if check.get("error"):
            payload["error"] = check["error"]
        if check.get("note"):
            payload["note"] = check["note"]
        return payload

    if server.server_url.startswith("native://"):
        from app.services.bjorn_lunden import BL_NATIVE_TOOLS, validate_credentials

        auth_data = _parse_json(server.auth_json)
        check = await validate_credentials(auth_data if isinstance(auth_data, dict) else {})
        tools = [dict(t) for t in BL_NATIVE_TOOLS]
        await _persist_discovered_tools(session, server, tools)
        payload: dict[str, Any] = {
            "ok": bool(check.get("ok")),
            "server_id": str(server.id),
            "server_name": server.name,
            "tool_count": len(tools),
            "tools": tools,
        }
        if check.get("error"):
            payload["error"] = check["error"]
        if check.get("note"):
            payload["note"] = check["note"]
        return payload

    if server.server_url.startswith("mock://"):
        if get_settings().is_production:
            return {
                "ok": False,
                "server_id": str(server.id),
                "server_name": server.name,
                "tool_count": 0,
                "tools": [],
                "error": "Mock MCP servers are not allowed in production.",
            }
        tools = _mock_discovery_tools(server.name)
        await _persist_discovered_tools(session, server, tools)
        return {
            "ok": True,
            "server_id": str(server.id),
            "server_name": server.name,
            "tool_count": len(tools),
            "tools": tools,
        }

    auth = _parse_json(server.auth_json)
    payload = {"jsonrpc": "2.0", "id": "1", "method": "tools/list", "params": {}}
    headers = _mcp_auth_headers(auth if isinstance(auth, dict) else {})

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(server.server_url, json=payload, headers=headers)
            response.raise_for_status()
            body = response.json()
    except Exception as exc:
        return {
            "ok": False,
            "server_id": str(server.id),
            "server_name": server.name,
            "tool_count": 0,
            "tools": [],
            "error": str(exc),
        }

    tools_raw = body.get("result", {}).get("tools", []) if isinstance(body, dict) else []
    tools = [
        {
            "name": str(t.get("name", "")),
            "description": str(t.get("description", ""))[:200],
        }
        for t in tools_raw
        if isinstance(t, dict) and t.get("name")
    ]
    await _persist_discovered_tools(session, server, tools)
    return {
        "ok": True,
        "server_id": str(server.id),
        "server_name": server.name,
        "tool_count": len(tools),
        "tools": tools,
    }


async def ensure_github_connection(
    session: AsyncSession, tenant_id: UUID, *, login: str = "bokito-dev"
) -> IntegrationConnection:
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.provider == "github",
            IntegrationConnection.status == "active",
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing
    conn = IntegrationConnection(
        tenant_id=tenant_id,
        provider="github",
        display_name=login,
        status="active",
        metadata_json=json.dumps({"github_login": login, "external_account_id": login}),
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


async def get_provider_access_token(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    *,
    connection_id: UUID | None = None,
) -> str | None:
    """Return a stored OAuth access token for an active connection, if any."""
    if connection_id is not None:
        conn = await session.get(IntegrationConnection, connection_id)
        if (
            conn is None
            or conn.tenant_id != tenant_id
            or conn.provider != provider
            or conn.status != "active"
        ):
            return None
    else:
        result = await session.execute(
            select(IntegrationConnection)
            .where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.provider == provider,
                IntegrationConnection.status == "active",
            )
            .order_by(IntegrationConnection.created_at.asc())
            .limit(1)
        )
        conn = result.scalar_one_or_none()
    if not conn:
        return None
    creds = _parse_json(conn.credentials_json)
    token = creds.get("access_token")
    return token if isinstance(token, str) and token else None


async def list_github_connections(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.provider == "github",
            IntegrationConnection.status != "revoked",
        )
    )
    rows = []
    for conn in result.scalars().all():
        meta = _parse_json(conn.metadata_json)
        login = meta.get("github_login") or conn.display_name or "github-user"
        rows.append(
            {
                "id": str(conn.id),
                "github_login": login,
                "display_name": conn.display_name or login,
                "status": conn.status if conn.status in ("active", "revoked", "error") else "active",
                "connected_at": conn.created_at.isoformat() if conn.created_at else None,
                "created_at": conn.created_at.isoformat() if conn.created_at else None,
            }
        )
    return rows


def _seed_mock_creds_if_missing(account: ChannelAccount) -> None:
    """Give a dev mock mailbox placeholder credentials so it reads as connected.

    Never overwrites real tokens and never runs in production (the mock OAuth
    paths are already blocked there). Sync and send recognize the `mock` flag
    and short-circuit instead of calling the real provider APIs.
    """
    if get_settings().is_production:
        return
    try:
        creds = json.loads(account.credentials_json or "{}")
    except (json.JSONDecodeError, TypeError):
        creds = {}
    if isinstance(creds, dict) and creds.get("access_token"):
        return
    account.credentials_json = json.dumps(
        {"access_token": "mock-access-token", "mock": True}
    )


async def ensure_email_account(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    email: str,
    *,
    seed_mock_credentials: bool = False,
) -> ChannelAccount:
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.channel == "email",
            ChannelAccount.address == email,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.provider = provider
        existing.is_enabled = True
        if seed_mock_credentials:
            _seed_mock_creds_if_missing(existing)
        session.add(existing)
        await session.commit()
        await session.refresh(existing)
        return existing
    account = ChannelAccount(
        tenant_id=tenant_id,
        channel="email",
        address=email,
        provider=provider,
        is_enabled=True,
    )
    if seed_mock_credentials:
        _seed_mock_creds_if_missing(account)
    session.add(account)
    await session.commit()
    await session.refresh(account)
    # A real mailbox replaces the onboarding demo thread.
    from app.services.onboarding_demo import remove_demo_threads

    try:
        await remove_demo_threads(session, tenant_id)
    except Exception:  # noqa: BLE001 — cleanup must never break connect
        pass
    return account


MOCK_REPOS = [
    {"id": 1, "full_name": "bokito/platform", "default_branch": "main", "private": True},
    {"id": 2, "full_name": "bokito/docs", "default_branch": "main", "private": False},
]

MOCK_BRANCHES = ["main", "develop", "feature/inbox"]
