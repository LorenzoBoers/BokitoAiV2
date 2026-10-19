"""Module install signal: a live department with origin_module_slug.

See docs/architecture/module-one-time-drop.md. ModuleInstall is gone; prefs
live on ``Department.settings_json["modules"]``.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import Department, is_root_department

MODULES_SETTINGS_KEY = "modules"


async def get_module_department(
    session: AsyncSession, tenant_id: UUID, slug: str
) -> Department | None:
    """Live department that originated from this catalog slug, if any."""
    return (
        await session.execute(
            select(Department).where(
                Department.tenant_id == tenant_id,
                Department.origin_module_slug == slug,
                Department.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def module_is_installed(
    session: AsyncSession, tenant_id: UUID, slug: str
) -> bool:
    return await get_module_department(session, tenant_id, slug) is not None


async def installed_module_slugs(session: AsyncSession, tenant_id: UUID) -> set[str]:
    rows = (
        await session.execute(
            select(Department.origin_module_slug).where(
                Department.tenant_id == tenant_id,
                Department.origin_module_slug.is_not(None),
                Department.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    return {str(slug) for slug in rows if slug}


def _settings_dict(department: Department) -> dict[str, Any]:
    try:
        data = json.loads(department.settings_json or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def module_prefs_from_department(department: Department | None) -> dict[str, Any]:
    """API prefs shape previously served from ModuleInstall."""
    if department is None or is_root_department(department):
        return {
            "install_state": "not_installed",
            "enabled": False,
            "writes_enabled": False,
        }
    raw = _settings_dict(department).get(MODULES_SETTINGS_KEY)
    mods = raw if isinstance(raw, dict) else {}
    prefs: dict[str, Any] = {
        "install_state": "installed",
        "enabled": True,
        "writes_enabled": bool(mods.get("writes_enabled")),
        "department_id": str(department.id),
    }
    default_conn = mods.get("default_connection_id")
    if isinstance(default_conn, str) and default_conn.strip():
        prefs["default_connection_id"] = default_conn.strip()
    company = mods.get("default_company_by_connection")
    if isinstance(company, dict) and company:
        prefs["default_company_by_connection"] = {
            str(k): str(v) for k, v in company.items() if str(k).strip() and str(v).strip()
        }
    user_access = mods.get("user_access")
    if isinstance(user_access, dict) and user_access:
        prefs["user_access"] = user_access
    customer_tools = mods.get("customer_tools")
    if isinstance(customer_tools, dict) and customer_tools:
        prefs["customer_tools"] = {str(k): bool(v) for k, v in customer_tools.items()}
    return prefs


def write_module_prefs_to_department(
    department: Department, updates: dict[str, Any]
) -> dict[str, Any]:
    """Merge ``updates`` into settings_json.modules and return full prefs."""
    stored = _settings_dict(department)
    mods = stored.get(MODULES_SETTINGS_KEY)
    if not isinstance(mods, dict):
        mods = {}
    mods = dict(mods)
    for key, value in updates.items():
        if value is None and key in ("default_connection_id",):
            mods.pop(key, None)
        elif value is not None:
            mods[key] = value
    stored[MODULES_SETTINGS_KEY] = mods
    department.settings_json = json.dumps(stored)
    return module_prefs_from_department(department)
