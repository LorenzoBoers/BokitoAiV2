"""Platform-global (Bokito) fallback API keys per provider.

Used when a tenant has no own key. Keys are encrypted at rest with the Fernet
helper; only ``last4`` is exposed. Env vars remain the ultimate bootstrap
fallback (see resolve_model_call).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model_catalog import PlatformSecret
from app.services.crypto import decrypt_secret, encrypt_secret

PLATFORM_PROVIDERS = ("anthropic", "openai")


def _last4(raw: str) -> str:
    raw = raw.strip()
    return raw[-4:] if len(raw) >= 4 else raw


async def set_platform_secret(session: AsyncSession, provider: str, raw: str) -> PlatformSecret:
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Secret value cannot be empty")
    result = await session.execute(
        select(PlatformSecret).where(PlatformSecret.provider == provider)
    )
    secret = result.scalar_one_or_none()
    now = datetime.utcnow()
    if secret:
        secret.encrypted_value = encrypt_secret(raw)
        secret.last4 = _last4(raw)
        secret.updated_at = now
    else:
        secret = PlatformSecret(
            provider=provider, encrypted_value=encrypt_secret(raw), last4=_last4(raw)
        )
        session.add(secret)
    await session.commit()
    await session.refresh(secret)
    return secret


async def get_platform_secret(session: AsyncSession, provider: str) -> str | None:
    result = await session.execute(
        select(PlatformSecret).where(PlatformSecret.provider == provider)
    )
    secret = result.scalar_one_or_none()
    if not secret or not secret.encrypted_value:
        return None
    return decrypt_secret(secret.encrypted_value) or None


async def list_platform_status(session: AsyncSession) -> list[dict[str, Any]]:
    result = await session.execute(select(PlatformSecret))
    by_provider = {s.provider: s for s in result.scalars().all()}
    status: list[dict[str, Any]] = []
    for provider in PLATFORM_PROVIDERS:
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


async def delete_platform_secret(session: AsyncSession, provider: str) -> bool:
    result = await session.execute(
        select(PlatformSecret).where(PlatformSecret.provider == provider)
    )
    secret = result.scalar_one_or_none()
    if not secret:
        return False
    await session.delete(secret)
    await session.commit()
    return True
