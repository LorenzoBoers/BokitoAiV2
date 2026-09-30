"""Tenant feature flags stored under ``Tenant.settings_json.features``.

Custom models (BYOK) require both the global env kill-switch
``FEATURE_CUSTOM_MODELS`` and a per-tenant staff entitlement
``features.custom_models``. Tenants then opt in with
``features.custom_models_enabled`` before own models appear in pickers.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Tenant


def _features(tenant: Tenant) -> dict[str, Any]:
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    raw = settings.get("features")
    return raw if isinstance(raw, dict) else {}


def custom_models_entitled(tenant: Tenant) -> bool:
    """Staff (or future billing) granted the custom-models capability."""
    return bool(_features(tenant).get("custom_models"))


def custom_models_opted_in(tenant: Tenant) -> bool:
    """Tenant owner enabled the custom-models escape hatch in Settings."""
    return bool(_features(tenant).get("custom_models_enabled"))


def custom_models_allowed(tenant: Tenant) -> bool:
    """Env kill-switch AND per-tenant entitlement — UI may show the section."""
    if not get_settings().feature_custom_models:
        return False
    return custom_models_entitled(tenant)


def custom_models_active(tenant: Tenant) -> bool:
    """Allowed and opted in — resolution + agent picker use own models."""
    return custom_models_allowed(tenant) and custom_models_opted_in(tenant)


def custom_models_status(tenant: Tenant) -> dict[str, bool]:
    return {
        "allowed": custom_models_allowed(tenant),
        "enabled": custom_models_opted_in(tenant),
        "active": custom_models_active(tenant),
        "feature_env": bool(get_settings().feature_custom_models),
        "entitled": custom_models_entitled(tenant),
    }


async def get_tenant(session: AsyncSession, tenant_id: UUID) -> Tenant | None:
    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    return result.scalar_one_or_none()


async def set_custom_models_entitlement(
    session: AsyncSession, tenant_id: UUID, *, entitled: bool
) -> dict[str, bool]:
    tenant = await get_tenant(session, tenant_id)
    if tenant is None:
        raise ValueError("Tenant not found")
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        settings = {}
    features = settings.get("features") if isinstance(settings.get("features"), dict) else {}
    features = dict(features)
    features["custom_models"] = bool(entitled)
    if not entitled:
        # Dropping entitlement also clears the opt-in so agents fall back cleanly.
        features["custom_models_enabled"] = False
    settings["features"] = features
    tenant.settings_json = json.dumps(settings)
    await session.commit()
    await session.refresh(tenant)
    return custom_models_status(tenant)


async def set_custom_models_opt_in(
    session: AsyncSession, tenant_id: UUID, *, enabled: bool
) -> dict[str, bool]:
    tenant = await get_tenant(session, tenant_id)
    if tenant is None:
        raise ValueError("Tenant not found")
    if enabled and not custom_models_allowed(tenant):
        raise PermissionError("Custom models are not available for this workspace")
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        settings = {}
    features = settings.get("features") if isinstance(settings.get("features"), dict) else {}
    features = dict(features)
    features["custom_models_enabled"] = bool(enabled)
    settings["features"] = features
    tenant.settings_json = json.dumps(settings)
    await session.commit()
    await session.refresh(tenant)
    return custom_models_status(tenant)
