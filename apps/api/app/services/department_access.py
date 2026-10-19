"""Department membership as default allow; ACL rows as overrides.

Confirmed product defaults (v1 agents first):

- Channel default level for dept members: ``handle``
- Module: membership → use/read; write only via ``ModuleAgent.can_write``
- AgentScope: empty rows → membership-default (after one-shot backfill)
- Users: still use legacy access_list defaults until fase 3b

Evaluation order for ``can_use``:

1. owner/admin human (``principal.unrestricted``) → max level
2. explicit DENY override → None
3. matching non-deny override → that level (level-down or extra grant)
4. ``home_department_id`` in ``principal.team_ids`` → ``default_level``
5. else → None

All-membership never means the whole workspace: only resources whose home is
the All department. ``home_department_id is None`` stays outside the default.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.access_list import Principal, best_level

DENY_LEVEL = "deny"

# resource kind → (ordered levels, membership default level)
RESOURCE_LEVELS: dict[str, tuple[tuple[str, ...], str]] = {
    "channel": (("view", "handle"), "handle"),
    "connection": (("use", "manage"), "use"),
    "calendar": (("use", "manage"), "use"),
    "project": (("use", "write"), "use"),
    "knowledge": (("use", "write"), "use"),
    "flow": (("use", "write"), "use"),
    "module": (("use", "write"), "use"),
}


@dataclass(frozen=True)
class AccessResource:
    """One resource for ``can_use``."""

    kind: str
    home_department_id: UUID | None
    levels: tuple[str, ...]
    default_level: str
    overrides: tuple[dict[str, str], ...] = ()


def _matches_principal(entry: dict[str, str], principal: Principal) -> bool:
    kind, ident = entry.get("kind", ""), entry.get("id", "")
    return (kind == principal.kind and ident == principal.id) or (
        kind == "department" and ident in principal.team_ids
    )


def _has_deny(overrides: Sequence[dict[str, str]], principal: Principal) -> bool:
    return any(
        entry.get("level") == DENY_LEVEL and _matches_principal(entry, principal)
        for entry in overrides
    )


def can_use(principal: Principal, resource: AccessResource) -> str | None:
    """Resolve access level for a principal on a resource, or None."""
    if principal.unrestricted:
        return resource.levels[-1] if resource.levels else None

    overrides = list(resource.overrides)
    if _has_deny(overrides, principal):
        return None

    allow_entries = [e for e in overrides if e.get("level") != DENY_LEVEL]
    override_level = best_level(allow_entries, principal, resource.levels)
    if override_level is not None:
        # Explicit row wins (level-down or grant outside home).
        return override_level

    home = resource.home_department_id
    if home is not None and str(home) in principal.team_ids:
        return resource.default_level

    return None


def make_resource(
    kind: str,
    *,
    home_department_id: UUID | None,
    overrides: Sequence[dict[str, str]] | None = None,
) -> AccessResource:
    levels, default_level = RESOURCE_LEVELS[kind]
    return AccessResource(
        kind=kind,
        home_department_id=home_department_id,
        levels=levels,
        default_level=default_level,
        overrides=tuple(overrides or ()),
    )


async def resource_home_department_id(
    session: AsyncSession, kind: str, resource_id: str
) -> UUID | None:
    """Home department for a resource id, or None when unset / unknown."""
    try:
        rid = UUID(str(resource_id))
    except ValueError:
        rid = None

    if kind == "channel":
        from app.models.channel import ChannelAccount

        if rid is None:
            return None
        row = (
            await session.execute(
                select(ChannelAccount.routing_department_id).where(ChannelAccount.id == rid)
            )
        ).scalar_one_or_none()
        return row

    if kind == "project":
        from app.models.project import Project

        if rid is None:
            return None
        return (
            await session.execute(select(Project.department_id).where(Project.id == rid))
        ).scalar_one_or_none()

    if kind == "knowledge":
        from app.models.workspace import WorkspaceDoc

        if rid is None:
            return None
        return (
            await session.execute(
                select(WorkspaceDoc.department_id).where(WorkspaceDoc.id == rid)
            )
        ).scalar_one_or_none()

    if kind == "connection":
        from app.models.integration import IntegrationConnection

        if rid is None:
            return None
        return (
            await session.execute(
                select(IntegrationConnection.department_id).where(
                    IntegrationConnection.id == rid
                )
            )
        ).scalar_one_or_none()

    if kind == "calendar":
        from app.models.calendar import TenantCalendar

        if rid is None:
            return None
        return (
            await session.execute(
                select(TenantCalendar.department_id).where(TenantCalendar.id == rid)
            )
        ).scalar_one_or_none()

    if kind == "flow":
        from app.models.orchestra import Workstream

        if rid is None:
            return None
        return (
            await session.execute(
                select(Workstream.department_id).where(Workstream.id == rid)
            )
        ).scalar_one_or_none()

    if kind == "module":
        from app.models.team import Department

        slug = str(resource_id).strip()
        if not slug:
            return None
        # Slug is unique among live origin departments per tenant; without a
        # tenant filter callers must pass an unambiguous slug in a single-tenant
        # session, or embed tenant later. Prefer first live match.
        return (
            await session.execute(
                select(Department.id)
                .where(
                    Department.origin_module_slug == slug,
                    Department.deleted_at.is_(None),
                )
                .limit(1)
            )
        ).scalar_one_or_none()

    return None


def normalize_override_entries(
    raw: Any, levels: Sequence[str]
) -> list[dict[str, str]]:
    """Like access_list.normalize_entries but also keeps ``deny`` rows."""
    from app.services.access_list import ACCESS_KINDS, normalize_entries

    base = normalize_entries(raw, levels) or []
    if not isinstance(raw, list):
        return base
    denies: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("level") or "") != DENY_LEVEL:
            continue
        kind = str(entry.get("kind") or "")
        ident = str(entry.get("id") or "")
        if kind in ACCESS_KINDS and ident:
            denies.append({"kind": kind, "id": ident, "level": DENY_LEVEL})
    return base + denies
