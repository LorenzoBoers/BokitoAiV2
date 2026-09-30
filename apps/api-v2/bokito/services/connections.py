"""Connections: channels, model providers, MCP servers, integrations, workbenches."""

from __future__ import annotations

import secrets
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.base import utcnow
from bokito.domain.connection import Connection, ConnectionKind, ConnectionStatus
from bokito.errors import NotFound
from bokito.services.crypto import decrypt_json, encrypt_json, mask_secret

SECRET_KEYS = {
    "api_key",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "app_secret",
    "password",
}


async def create(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    kind: ConnectionKind,
    provider: str,
    name: str,
    address: str = "",
    credentials: dict[str, Any] | None = None,
    settings: dict[str, Any] | None = None,
    capabilities: list[str] | None = None,
    disclosure_enabled: bool = True,
    region: str = "eu",
    agent_id: uuid.UUID | None = None,
    status: ConnectionStatus = ConnectionStatus.pending,
) -> Connection:
    conn = Connection(
        tenant_id=tenant_id,
        kind=kind,
        provider=provider[:64],
        name=name[:160],
        address=address[:300],
        credentials=encrypt_json(credentials or {}),
        settings=settings or {},
        capabilities=capabilities or [],
        disclosure_enabled=disclosure_enabled,
        region=region,
        agent_id=agent_id,
        status=status,
        public_key=secrets.token_urlsafe(18)
        if kind
        in (
            ConnectionKind.widget,
            ConnectionKind.email,
            ConnectionKind.whatsapp,
            ConnectionKind.phone,
            ConnectionKind.workbench,
        )
        else "",
    )
    session.add(conn)
    await session.flush()
    return conn


async def get(session: AsyncSession, tenant_id: uuid.UUID, connection_id: uuid.UUID) -> Connection:
    conn = await session.get(Connection, connection_id)
    if not conn or conn.tenant_id != tenant_id:
        raise NotFound("connection not found", code="connection_not_found")
    return conn


async def get_by_public_key(session: AsyncSession, public_key: str) -> Connection | None:
    if not public_key:
        return None
    return await session.scalar(select(Connection).where(Connection.public_key == public_key))


async def list_connections(
    session: AsyncSession, tenant_id: uuid.UUID, *, kind: ConnectionKind | None = None
) -> list[Connection]:
    stmt = select(Connection).where(Connection.tenant_id == tenant_id)
    if kind:
        stmt = stmt.where(Connection.kind == kind)
    stmt = stmt.order_by(Connection.kind, Connection.name)
    return list((await session.scalars(stmt)).all())


async def first_active(
    session: AsyncSession, tenant_id: uuid.UUID, kind: ConnectionKind, provider: str | None = None
) -> Connection | None:
    stmt = select(Connection).where(
        Connection.tenant_id == tenant_id,
        Connection.kind == kind,
        Connection.status == ConnectionStatus.active,
    )
    if provider:
        stmt = stmt.where(Connection.provider == provider)
    return await session.scalar(stmt.order_by(Connection.created_at).limit(1))


def credentials_of(conn: Connection) -> dict[str, Any]:
    return decrypt_json(conn.credentials)


def set_credentials(conn: Connection, credentials: dict[str, Any], *, merge: bool = True) -> None:
    current = credentials_of(conn) if merge else {}
    current.update({k: v for k, v in credentials.items() if v is not None})
    conn.credentials = encrypt_json(current)


def masked_credentials(conn: Connection) -> dict[str, str]:
    return {
        k: mask_secret(str(v)) if k in SECRET_KEYS else str(v)
        for k, v in credentials_of(conn).items()
    }


async def set_status(
    session: AsyncSession, conn: Connection, status: ConnectionStatus, message: str = ""
) -> Connection:
    conn.status = status
    conn.status_message = message[:500]
    if status == ConnectionStatus.active:
        conn.verified_at = utcnow()
    await session.flush()
    return conn


async def touch(session: AsyncSession, conn: Connection) -> None:
    conn.last_used_at = utcnow()
    await session.flush()
