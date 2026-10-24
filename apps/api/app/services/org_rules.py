"""Tenant switch for the organization rules (phase 2 of the organization model).

``Tenant.settings_json["org_rules"]`` is ``off`` (default) or ``on``. With it on,
agents follow the tree: only the holder acts on a conversation, shielded
departments stay out of reach, asks go along the tree and the prompt carries
the org chart and who holds the work.
"""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant

ORG_RULES_MODES = ("off", "on")


def _settings(tenant: Tenant | None) -> dict:
    try:
        data = json.loads((tenant.settings_json if tenant else None) or "{}")
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


async def org_rules_on(session: AsyncSession, tenant_id: UUID) -> bool:
    return _settings(await session.get(Tenant, tenant_id)).get("org_rules") == "on"


async def set_org_rules(session: AsyncSession, tenant_id: UUID, mode: str) -> None:
    if mode not in ORG_RULES_MODES:
        raise ValueError("org_rules is off or on")
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise ValueError("Tenant not found")
    data = _settings(tenant)
    data["org_rules"] = mode
    tenant.settings_json = json.dumps(data)
    session.add(tenant)
    await session.flush()


__all__ = ["ORG_RULES_MODES", "org_rules_on", "set_org_rules"]
