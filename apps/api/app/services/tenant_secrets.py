"""Per-tenant encrypted secret store (LLM provider API keys).

Wraps the ``TenantSecret`` table with the Fernet crypto helper. The raw key
is only ever returned by ``get_secret`` for server-side provider calls; the
client-facing ``list_status`` returns masked metadata only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.secret import TenantSecret
from app.services.crypto import decrypt_secret, encrypt_secret

LLM_PROVIDERS = ("anthropic", "openai")


def _last4(raw: str) -> str:
    raw = raw.strip()
    return raw[-4:] if len(raw) >= 4 else raw


async def set_secret(
    session: AsyncSession, tenant_id: UUID, provider: str, raw: str
) -> TenantSecret:
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Secret value cannot be empty")
    result = await session.execute(
        select(TenantSecret).where(
            TenantSecret.tenant_id == tenant_id, TenantSecret.provider == provider
        )
    )
    secret = result.scalar_one_or_none()
    now = datetime.utcnow()
    if secret:
        secret.encrypted_value = encrypt_secret(raw)
        secret.last4 = _last4(raw)
        secret.updated_at = now
    else:
        secret = TenantSecret(
            tenant_id=tenant_id,
            provider=provider,
            encrypted_value=encrypt_secret(raw),
            last4=_last4(raw),
        )
        session.add(secret)
    await session.commit()
    await session.refresh(secret)
    return secret


async def get_secret(session: AsyncSession, tenant_id: UUID, provider: str) -> str | None:
    result = await session.execute(
        select(TenantSecret).where(
            TenantSecret.tenant_id == tenant_id, TenantSecret.provider == provider
        )
    )
    secret = result.scalar_one_or_none()
    if not secret or not secret.encrypted_value:
        return None
    value = decrypt_secret(secret.encrypted_value)
    return value or None


async def list_status(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(TenantSecret).where(TenantSecret.tenant_id == tenant_id)
    )
    by_provider = {s.provider: s for s in result.scalars().all()}
    status: list[dict[str, Any]] = []
    for provider in LLM_PROVIDERS:
        secret = by_provider.get(provider)
        status.append(
            {
                "provider": provider,
                "is_set": bool(secret and secret.encrypted_value),
                "last4": secret.last4 if secret else "",
                "updated_at": secret.updated_at.isoformat() if secret else None,
            }
        )
    return status


async def delete_secret(session: AsyncSession, tenant_id: UUID, provider: str) -> bool:
    result = await session.execute(
        select(TenantSecret).where(
            TenantSecret.tenant_id == tenant_id, TenantSecret.provider == provider
        )
    )
    secret = result.scalar_one_or_none()
    if not secret:
        return False
    await session.delete(secret)
    await session.commit()
    return True
