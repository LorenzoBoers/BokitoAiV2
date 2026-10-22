"""Per-tenant LLM provider connection CRUD and connectivity tests."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.provider import ProviderConnection
from app.services.crypto import decrypt_secret, encrypt_secret
from app.services.model_regions import provider_region
from app.services.provider_presets import get_preset, is_valid_provider_type

DEFAULT_LABELS = {
    "mistral": "Mistral",
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "openai_compatible": "OpenAI-compatible",
}


def _last4(raw: str) -> str:
    raw = raw.strip()
    return raw[-4:] if len(raw) >= 4 else raw


def _normalize_base_url(base_url: str) -> str:
    return (base_url or "").strip().rstrip("/")


def default_base_url(provider_type: str) -> str:
    """Base URL used when a connection of this type leaves ``base_url`` empty."""
    preset = get_preset(provider_type)
    if preset and preset["default_base_url"]:
        return preset["default_base_url"]
    return "https://api.openai.com/v1"


def serialize_connection(conn: ProviderConnection, *, include_id: bool = True) -> dict[str, Any]:
    data: dict[str, Any] = {
        "provider_type": conn.provider_type,
        "label": conn.label,
        "base_url": conn.base_url or "",
        "region": provider_region(conn.provider_type, conn.base_url),
        "enabled": conn.enabled,
        "is_set": bool(conn.encrypted_value),
        "last4": conn.last4,
        "updated_at": conn.updated_at.isoformat() if conn.updated_at else None,
    }
    if include_id:
        data["id"] = str(conn.id)
    return data


async def list_connections(session: AsyncSession, tenant_id: UUID) -> list[ProviderConnection]:
    result = await session.execute(
        select(ProviderConnection)
        .where(ProviderConnection.tenant_id == tenant_id)
        .order_by(ProviderConnection.label)
    )
    return list(result.scalars().all())


async def get_connection(
    session: AsyncSession, tenant_id: UUID, connection_id: UUID
) -> ProviderConnection | None:
    result = await session.execute(
        select(ProviderConnection).where(
            ProviderConnection.id == connection_id,
            ProviderConnection.tenant_id == tenant_id,
        )
    )
    return result.scalar_one_or_none()


async def get_decrypted_key(session: AsyncSession, connection: ProviderConnection) -> str | None:
    if not connection.encrypted_value:
        return None
    value = decrypt_secret(connection.encrypted_value)
    return value or None


async def create_connection(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    provider_type: str,
    label: str = "",
    base_url: str = "",
    api_key: str,
) -> ProviderConnection:
    if not is_valid_provider_type(provider_type):
        raise ValueError("Unknown provider type")
    preset = get_preset(provider_type)
    if preset and preset["requires_base_url"] and not _normalize_base_url(base_url):
        raise ValueError("Base URL is required for OpenAI-compatible providers")

    raw_key = (api_key or "").strip()
    if not raw_key:
        raise ValueError("API key cannot be empty")

    clean_label = (label or "").strip() or DEFAULT_LABELS.get(provider_type, provider_type)
    existing = await session.execute(
        select(ProviderConnection).where(
            ProviderConnection.tenant_id == tenant_id,
            ProviderConnection.label == clean_label,
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError("A provider with this label already exists")

    now = utcnow()
    conn = ProviderConnection(
        tenant_id=tenant_id,
        provider_type=provider_type,
        label=clean_label,
        base_url=_normalize_base_url(base_url),
        encrypted_value=encrypt_secret(raw_key),
        last4=_last4(raw_key),
        enabled=True,
        created_at=now,
        updated_at=now,
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


async def update_connection(
    session: AsyncSession,
    tenant_id: UUID,
    connection_id: UUID,
    *,
    label: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    enabled: bool | None = None,
) -> ProviderConnection:
    conn = await get_connection(session, tenant_id, connection_id)
    if not conn:
        raise ValueError("Provider connection not found")

    now = utcnow()
    if label is not None:
        clean_label = label.strip()
        if not clean_label:
            raise ValueError("Label cannot be empty")
        clash = await session.execute(
            select(ProviderConnection).where(
                ProviderConnection.tenant_id == tenant_id,
                ProviderConnection.label == clean_label,
                ProviderConnection.id != connection_id,
            )
        )
        if clash.scalar_one_or_none():
            raise ValueError("A provider with this label already exists")
        conn.label = clean_label

    if base_url is not None:
        conn.base_url = _normalize_base_url(base_url)
        preset = get_preset(conn.provider_type)
        if preset and preset["requires_base_url"] and not conn.base_url:
            raise ValueError("Base URL is required for OpenAI-compatible providers")

    if api_key is not None:
        raw_key = api_key.strip()
        if not raw_key:
            raise ValueError("API key cannot be empty")
        conn.encrypted_value = encrypt_secret(raw_key)
        conn.last4 = _last4(raw_key)

    if enabled is not None:
        conn.enabled = enabled

    conn.updated_at = now
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


async def delete_connection(session: AsyncSession, tenant_id: UUID, connection_id: UUID) -> bool:
    conn = await get_connection(session, tenant_id, connection_id)
    if not conn:
        return False
    from app.models.provider import TenantModel

    models = await session.execute(
        select(TenantModel).where(
            TenantModel.tenant_id == tenant_id,
            TenantModel.connection_id == connection_id,
        )
    )
    for model in models.scalars().all():
        await session.delete(model)
    await session.delete(conn)
    await session.commit()
    return True


async def _probe_openai_compatible(api_key: str, base_url: str, provider_type: str) -> dict[str, Any]:
    """Fallback probe for provider types that are not in the spec registry."""
    base = _normalize_base_url(base_url) or default_base_url(provider_type)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{base}/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if response.status_code == 401:
                return {"ok": False, "message": "Invalid API key"}
            response.raise_for_status()
            return {"ok": True, "message": "Connection successful"}
    except httpx.HTTPError as exc:
        return {"ok": False, "message": f"Connection failed: {exc}"}


async def test_connection(session: AsyncSession, tenant_id: UUID, connection_id: UUID) -> dict[str, Any]:
    conn = await get_connection(session, tenant_id, connection_id)
    if not conn:
        raise ValueError("Provider connection not found")

    api_key = await get_decrypted_key(session, conn)
    if not api_key:
        return {"ok": False, "message": "No API key configured"}

    from app.services.provider_spec import get_provider_spec

    spec = get_provider_spec(conn.provider_type)
    if spec is not None and spec.probe is not None:
        return await spec.probe(api_key, conn.base_url or "")

    # Unknown types keep the OpenAI-compatible /models probe.
    return await _probe_openai_compatible(api_key, conn.base_url or "", conn.provider_type)
