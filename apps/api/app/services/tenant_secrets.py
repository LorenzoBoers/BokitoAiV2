"""Legacy BYOK helpers on top of ProviderConnection.

The old ``tenant_secrets`` table is gone: per-tenant LLM keys live in
``ProviderConnection`` (one row per provider label). These helpers keep the
simple provider-keyed API used by model resolution and the settings screen —
one implicit connection per base provider (anthropic / openai).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.provider import ProviderConnection
from app.services.crypto import decrypt_secret, encrypt_secret

LLM_PROVIDERS = ("anthropic", "openai")


def _last4(raw: str) -> str:
    raw = raw.strip()
    return raw[-4:] if len(raw) >= 4 else raw


async def _provider_row(
    session: AsyncSession, tenant_id: UUID, provider: str
) -> ProviderConnection | None:
    """Oldest connection of this base provider type (the implicit BYOK slot)."""
    result = await session.execute(
        select(ProviderConnection)
        .where(
            ProviderConnection.tenant_id == tenant_id,
            ProviderConnection.provider_type == provider,
        )
        .order_by(ProviderConnection.created_at.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def set_secret(
    session: AsyncSession, tenant_id: UUID, provider: str, raw: str
) -> ProviderConnection:
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Secret value cannot be empty")
    conn = await _provider_row(session, tenant_id, provider)
    now = datetime.utcnow()
    if conn:
        conn.encrypted_value = encrypt_secret(raw)
        conn.last4 = _last4(raw)
        conn.updated_at = now
    else:
        from app.services.provider_connections import DEFAULT_LABELS

        conn = ProviderConnection(
            tenant_id=tenant_id,
            provider_type=provider,
            label=DEFAULT_LABELS.get(provider, provider),
            encrypted_value=encrypt_secret(raw),
            last4=_last4(raw),
        )
        session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


async def get_secret(session: AsyncSession, tenant_id: UUID, provider: str) -> str | None:
    conn = await _provider_row(session, tenant_id, provider)
    if not conn or not conn.encrypted_value or not conn.enabled:
        return None
    value = decrypt_secret(conn.encrypted_value)
    return value or None


async def list_status(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    status: list[dict[str, Any]] = []
    for provider in LLM_PROVIDERS:
        conn = await _provider_row(session, tenant_id, provider)
        status.append(
            {
                "provider": provider,
                "is_set": bool(conn and conn.encrypted_value and conn.enabled),
                "last4": conn.last4 if conn else "",
                "updated_at": conn.updated_at.isoformat() if conn else None,
            }
        )
    return status


async def delete_secret(session: AsyncSession, tenant_id: UUID, provider: str) -> bool:
    conn = await _provider_row(session, tenant_id, provider)
    if not conn:
        return False
    from app.services.provider_connections import delete_connection

    return await delete_connection(session, tenant_id, conn.id)
