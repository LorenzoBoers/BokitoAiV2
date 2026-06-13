"""Per-tenant model preferences stored in ``tenants.settings_json['models']``.

Shape::

    {
      "default_chat": "claude-sonnet-4",        # slug, "" => platform default
      "default_embedding": "text-embedding-3-small",
      "allowed_chat": ["claude-sonnet-4", ...]  # [] => all enabled chat models
    }
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant

MODELS_KEY = "models"
_DEFAULT_PREFS: dict[str, Any] = {
    "default_chat": "",
    "default_embedding": "",
    "allowed_chat": [],
}


def _coerce(raw: Any) -> dict[str, Any]:
    prefs = dict(_DEFAULT_PREFS)
    if isinstance(raw, dict):
        if isinstance(raw.get("default_chat"), str):
            prefs["default_chat"] = raw["default_chat"]
        if isinstance(raw.get("default_embedding"), str):
            prefs["default_embedding"] = raw["default_embedding"]
        if isinstance(raw.get("allowed_chat"), list):
            prefs["allowed_chat"] = [str(s) for s in raw["allowed_chat"] if isinstance(s, str)]
    return prefs


async def get_tenant_model_prefs(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        return dict(_DEFAULT_PREFS)
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    return _coerce(settings.get(MODELS_KEY))


async def set_tenant_model_prefs(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    default_chat: str | None = None,
    default_embedding: str | None = None,
    allowed_chat: list[str] | None = None,
) -> dict[str, Any]:
    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise ValueError("Tenant not found")
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    prefs = _coerce(settings.get(MODELS_KEY))
    if default_chat is not None:
        prefs["default_chat"] = default_chat
    if default_embedding is not None:
        prefs["default_embedding"] = default_embedding
    if allowed_chat is not None:
        prefs["allowed_chat"] = allowed_chat
    settings[MODELS_KEY] = prefs
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    return prefs


def is_chat_model_allowed(prefs: dict[str, Any], slug: str) -> bool:
    allowed = prefs.get("allowed_chat") or []
    return not allowed or slug in allowed
