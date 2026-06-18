"""Integrations platform service (marketplace, connections, MCP, OAuth mock)."""

import json
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelAccount
from app.models.integration import IntegrationBinding, IntegrationConnection, McpServer
from app.services.integrations_catalog import PROVIDERS, PROVIDER_BY_SLUG, provider_id


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
        select(IntegrationBinding).where(IntegrationBinding.connection_id == connection_id)
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
) -> dict[str, Any]:
    if provider not in PROVIDER_BY_SLUG:
        raise HTTPException(status_code=400, detail="Unknown provider")
    url = server_url or PROVIDER_BY_SLUG[provider].get("mcp_remote_url") or "mock://local/mcp"
    server = McpServer(
        tenant_id=tenant_id,
        name=display_name or PROVIDER_BY_SLUG[provider]["name"],
        server_url=url,
        auth_json=json.dumps({"api_key": api_key, "auth_type": auth_type}),
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
    return {
        "connection": serialize_connection(conn),
        "binding": {"id": str(binding.id), "config": _parse_json(binding.config_json)},
    }


async def ensure_oauth_connection(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    *,
    display_name: str | None = None,
) -> dict[str, Any]:
    if provider not in PROVIDER_BY_SLUG:
        raise HTTPException(status_code=400, detail="Unknown provider")
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.provider == provider,
            IntegrationConnection.status == "active",
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return serialize_connection(existing)
    conn = IntegrationConnection(
        tenant_id=tenant_id,
        provider=provider,
        display_name=display_name or PROVIDER_BY_SLUG[provider]["name"],
        status="active",
        metadata_json=json.dumps({"auth_type": "oauth2"}),
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
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
    session: AsyncSession, tenant_id: UUID, provider: str
) -> str | None:
    """Return a stored OAuth access token for an active connection, if any."""
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.provider == provider,
            IntegrationConnection.status == "active",
        )
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


async def ensure_email_account(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    email: str,
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
    session.add(account)
    await session.commit()
    await session.refresh(account)
    return account


MOCK_REPOS = [
    {"id": 1, "full_name": "bokito/platform", "default_branch": "main", "private": True},
    {"id": 2, "full_name": "bokito/docs", "default_branch": "main", "private": False},
]

MOCK_BRANCHES = ["main", "develop", "feature/inbox"]
