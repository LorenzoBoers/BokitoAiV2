"""Per-tenant model preferences stored in ``tenants.settings_json['models']``.

Shape::

    {
      "workspace_chat_mode": "automatic",  # automatic | bokito-maki | …
      "default_chat": "",                  # legacy mirror when mode is a concrete slug
      "default_embedding": "text-embedding-3-small",
      "allowed_chat": ["claude-sonnet-4", ...],  # [] => all enabled chat models
      "non_eu_platform_models": "blocked"        # blocked | allowed
    }

``workspace_chat_mode`` is the Bokito AI workspace default (or Automatic).
New workspaces default to ``automatic``. Agents with mode ``inherit`` (or empty)
fall back to it. ``default_chat`` stays populated for older clients when the
mode is a concrete slug.

``non_eu_platform_models`` is the workspace's data-region policy for
platform-key usage: when ``blocked`` (default), agents that point at a
US-hosted catalog model run on the EU-hosted Bokito AI model instead. BYOK
connections are the tenant's own keys and are never redirected.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant

MODELS_KEY = "models"
NON_EU_BLOCKED = "blocked"
NON_EU_ALLOWED = "allowed"
_DEFAULT_PREFS: dict[str, Any] = {
    "workspace_chat_mode": "automatic",
    "default_chat": "",
    "default_embedding": "",
    "allowed_chat": [],
    "non_eu_platform_models": NON_EU_BLOCKED,
}


def _coerce(raw: Any) -> dict[str, Any]:
    prefs = dict(_DEFAULT_PREFS)
    if isinstance(raw, dict):
        if isinstance(raw.get("workspace_chat_mode"), str):
            prefs["workspace_chat_mode"] = raw["workspace_chat_mode"]
        if isinstance(raw.get("default_chat"), str):
            prefs["default_chat"] = raw["default_chat"]
        if isinstance(raw.get("default_embedding"), str):
            prefs["default_embedding"] = raw["default_embedding"]
        if isinstance(raw.get("allowed_chat"), list):
            prefs["allowed_chat"] = [str(s) for s in raw["allowed_chat"] if isinstance(s, str)]
        if raw.get("non_eu_platform_models") in (NON_EU_BLOCKED, NON_EU_ALLOWED):
            prefs["non_eu_platform_models"] = raw["non_eu_platform_models"]
    return prefs


def non_eu_platform_models_allowed(prefs: dict[str, Any]) -> bool:
    return prefs.get("non_eu_platform_models") == NON_EU_ALLOWED


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
    workspace_chat_mode: str | None = None,
    default_chat: str | None = None,
    default_embedding: str | None = None,
    allowed_chat: list[str] | None = None,
    non_eu_platform_models: str | None = None,
) -> dict[str, Any]:
    from app.services import model_policy

    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise ValueError("Tenant not found")
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    prefs = _coerce(settings.get(MODELS_KEY))
    if workspace_chat_mode is not None:
        mode = model_policy.normalize_workspace_mode(workspace_chat_mode)
        prefs["workspace_chat_mode"] = mode
        # Keep legacy default_chat aligned when the mode is a concrete tier.
        prefs["default_chat"] = "" if mode == model_policy.AUTOMATIC else mode
    if default_chat is not None and workspace_chat_mode is None:
        from app.services import bokito_models

        prefs["default_chat"] = default_chat
        raw = default_chat.strip().lower()
        if raw == model_policy.AUTOMATIC or raw in bokito_models.MANAGED_CHAT_SLUGS:
            prefs["workspace_chat_mode"] = model_policy.normalize_workspace_mode(default_chat)
    if default_embedding is not None:
        prefs["default_embedding"] = default_embedding
    if allowed_chat is not None:
        prefs["allowed_chat"] = allowed_chat
    if non_eu_platform_models is not None:
        if non_eu_platform_models not in (NON_EU_BLOCKED, NON_EU_ALLOWED):
            raise ValueError("non_eu_platform_models must be 'blocked' or 'allowed'")
        prefs["non_eu_platform_models"] = non_eu_platform_models
    settings[MODELS_KEY] = prefs
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    return prefs


def is_chat_model_allowed(prefs: dict[str, Any], slug: str) -> bool:
    allowed = prefs.get("allowed_chat") or []
    return not allowed or slug in allowed
