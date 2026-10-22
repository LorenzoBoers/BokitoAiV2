"""Module ↔ agent roster: granular tool access and mandatory setup owner."""

from __future__ import annotations

import logging
import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models.agent import Agent
from app.models.module_agent import ModuleAgent
from app.modules.catalog import MODULE_BY_SLUG, MODULE_TOOL_PREFIXES, get_module

logger = logging.getLogger(__name__)


def _iso(value: datetime | None) -> str:
    return value.isoformat() + "Z" if value else ""


def parse_company_scope(row: ModuleAgent) -> list[str] | None:
    """Company ids this roster row is limited to; None = all companies."""
    raw = (row.company_ids_json or "").strip()
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None
    ids = [str(v).strip() for v in data if str(v).strip()]
    return ids or None


def _serialize(row: ModuleAgent, agent: Agent | None) -> dict[str, Any]:
    from app.services.agent_avatar import avatar_payload
    from app.services.managed_resources import management_payload

    module = MODULE_BY_SLUG.get(row.module_slug)
    module_name = module.name if module else row.module_slug
    pack_specialist = bool(
        agent is not None and (agent.slug or "").strip() == f"module-{row.module_slug}"
    )
    payload: dict[str, Any] = {
        "id": str(row.id),
        "module_slug": row.module_slug,
        "agent_id": str(row.agent_id),
        "agent_slug": (agent.slug or "") if agent else "",
        "name": agent.name if agent else "",
        "role": agent.role if agent else "",
        "is_active": bool(agent.is_active) if agent else False,
        "is_default": row.is_default,
        "is_pack_specialist": pack_specialist,
        "company_ids": parse_company_scope(row),
        "can_write": bool(row.can_write),
        "created_at": _iso(row.created_at),
    }
    payload.update(avatar_payload(agent))
    if agent is not None:
        affiliation = None
        if pack_specialist or row.is_default:
            affiliation = {
                "affiliated": True,
                "affiliation_kind": "module",
                "affiliation_label": module_name,
                "module_slug": row.module_slug,
                "module_name": module_name,
                "department_id": None,
                "department_name": None,
            }
        payload.update(management_payload(agent, affiliation=affiliation))
    return payload


def _require_module(slug: str) -> None:
    if get_module(slug) is None:
        raise NotFoundError("Unknown module")


async def list_module_agents(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> list[dict[str, Any]]:
    _require_module(module_slug)
    result = await session.execute(
        select(ModuleAgent, Agent)
        .join(Agent, Agent.id == ModuleAgent.agent_id)
        .where(
            ModuleAgent.tenant_id == tenant_id,
            ModuleAgent.module_slug == module_slug,
        )
        .order_by(ModuleAgent.created_at)
    )
    return [_serialize(row, agent) for row, agent in result.all()]


async def module_agent_count(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(ModuleAgent)
        .where(
            ModuleAgent.tenant_id == tenant_id,
            ModuleAgent.module_slug == module_slug,
        )
    )
    return int(result.scalar_one() or 0)


async def module_default_agent_id(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> UUID | None:
    result = await session.execute(
        select(ModuleAgent.agent_id)
        .where(
            ModuleAgent.tenant_id == tenant_id,
            ModuleAgent.module_slug == module_slug,
            ModuleAgent.is_default.is_(True),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def module_roster_summaries(
    session: AsyncSession, tenant_id: UUID
) -> dict[str, dict[str, Any]]:
    """Map module_slug → roster + managed specialist for catalog / agent tools."""
    result = await session.execute(
        select(
            ModuleAgent.module_slug,
            func.count().label("cnt"),
        )
        .where(ModuleAgent.tenant_id == tenant_id)
        .group_by(ModuleAgent.module_slug)
    )
    counts = {slug: int(cnt) for slug, cnt in result.all()}
    defaults = await session.execute(
        select(ModuleAgent.module_slug, ModuleAgent.agent_id).where(
            ModuleAgent.tenant_id == tenant_id,
            ModuleAgent.is_default.is_(True),
        )
    )
    default_map = {slug: agent_id for slug, agent_id in defaults.all()}
    specialist_by_slug: dict[str, Agent] = {}
    pack_slugs = [f"module-{slug}" for slug in MODULE_BY_SLUG]
    if pack_slugs:
        for agent in (
            await session.execute(
                select(Agent).where(
                    Agent.tenant_id == tenant_id,
                    Agent.slug.in_(pack_slugs),
                    Agent.kind == "company",
                    Agent.is_active.is_(True),
                )
            )
        ).scalars().all():
            slug = (agent.slug or "").removeprefix("module-").strip()
            if slug and slug not in specialist_by_slug:
                specialist_by_slug[slug] = agent

    # Resolve default agent names in one query.
    default_ids = [aid for aid in default_map.values() if aid]
    name_by_id: dict[UUID, str] = {}
    if default_ids:
        for agent in (
            await session.execute(select(Agent).where(Agent.id.in_(default_ids)))
        ).scalars():
            name_by_id[agent.id] = agent.name or ""

    from app.services.agent_avatar import avatar_payload

    out: dict[str, dict[str, Any]] = {}
    for slug in MODULE_BY_SLUG:
        default_id = default_map.get(slug)
        specialist = specialist_by_slug.get(slug)
        mark = avatar_payload(specialist) if specialist else {}
        out[slug] = {
            "assigned_agent_count": counts.get(slug, 0),
            "default_agent_id": str(default_id) if default_id else None,
            "default_agent_name": name_by_id.get(default_id, "") if default_id else None,
            "specialist_agent_id": str(specialist.id) if specialist else None,
            "specialist_agent_name": specialist.name if specialist else None,
            "specialist_job_title": (specialist.job_title or "") if specialist else None,
            "has_managed_specialist": specialist is not None,
            "specialist_avatar_kind": mark.get("avatar_kind"),
            "specialist_avatar_icon": mark.get("avatar_icon"),
            "specialist_avatar_color": mark.get("avatar_color"),
            "specialist_avatar_shape": mark.get("avatar_shape"),
            "specialist_avatar_image_url": mark.get("avatar_image_url"),
        }
    return out


async def module_slugs_for_agent(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID
) -> set[str]:
    """Installed-module slugs this agent is rostered on (for tool filtering)."""
    result = await session.execute(
        select(ModuleAgent.module_slug).where(
            ModuleAgent.tenant_id == tenant_id,
            ModuleAgent.agent_id == agent_id,
        )
    )
    return {row for row in result.scalars().all()}


async def _clear_default(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> None:
    result = await session.execute(
        select(ModuleAgent).where(
            ModuleAgent.tenant_id == tenant_id,
            ModuleAgent.module_slug == module_slug,
            ModuleAgent.is_default.is_(True),
        )
    )
    for other in result.scalars().all():
        other.is_default = False
        session.add(other)


async def add_module_agent(
    session: AsyncSession,
    tenant_id: UUID,
    module_slug: str,
    agent_id: UUID,
    *,
    is_default: bool = False,
) -> dict[str, Any]:
    _require_module(module_slug)
    agent = (
        await session.execute(
            select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not agent or agent.kind != "company":
        raise NotFoundError("Agent not found")
    existing = (
        await session.execute(
            select(ModuleAgent).where(
                ModuleAgent.tenant_id == tenant_id,
                ModuleAgent.module_slug == module_slug,
                ModuleAgent.agent_id == agent_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Agent is already on this module")
    count = await module_agent_count(session, tenant_id, module_slug)
    make_default = is_default or count == 0
    row = ModuleAgent(
        tenant_id=tenant_id,
        module_slug=module_slug,
        agent_id=agent_id,
        is_default=make_default,
    )
    if make_default:
        await _clear_default(session, tenant_id, module_slug)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _serialize(row, agent)


async def set_module_agent_default(
    session: AsyncSession,
    tenant_id: UUID,
    module_slug: str,
    agent_id: UUID,
    *,
    is_default: bool,
) -> dict[str, Any]:
    _require_module(module_slug)
    row = (
        await session.execute(
            select(ModuleAgent).where(
                ModuleAgent.tenant_id == tenant_id,
                ModuleAgent.module_slug == module_slug,
                ModuleAgent.agent_id == agent_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise NotFoundError("Agent is not on this module")
    if is_default:
        await _clear_default(session, tenant_id, module_slug)
        row.is_default = True
    else:
        if row.is_default:
            raise HTTPException(
                status_code=400,
                detail="Assign another default agent before clearing this one",
            )
        row.is_default = False
    session.add(row)
    await session.commit()
    agent = (
        await session.execute(
            select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    return _serialize(row, agent)


async def update_module_agent_access(
    session: AsyncSession,
    tenant_id: UUID,
    module_slug: str,
    agent_id: UUID,
    *,
    company_ids: list[str] | None = None,
    clear_company_scope: bool = False,
    can_write: bool | None = None,
) -> dict[str, Any]:
    """Set per-agent company scope and/or write access for one module."""
    _require_module(module_slug)
    row = (
        await session.execute(
            select(ModuleAgent).where(
                ModuleAgent.tenant_id == tenant_id,
                ModuleAgent.module_slug == module_slug,
                ModuleAgent.agent_id == agent_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise NotFoundError("Agent is not on this module")
    if clear_company_scope:
        row.company_ids_json = ""
    elif company_ids is not None:
        cleaned = [str(v).strip() for v in company_ids if str(v).strip()]
        row.company_ids_json = json.dumps(cleaned) if cleaned else ""
    if can_write is not None:
        row.can_write = bool(can_write)
    session.add(row)
    await session.commit()
    agent = (
        await session.execute(
            select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    return _serialize(row, agent)


async def module_agent_access(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID, module_slug: str
) -> ModuleAgent | None:
    """Roster row for one agent on one module (None when not rostered)."""
    return (
        await session.execute(
            select(ModuleAgent).where(
                ModuleAgent.tenant_id == tenant_id,
                ModuleAgent.module_slug == module_slug,
                ModuleAgent.agent_id == agent_id,
            )
        )
    ).scalar_one_or_none()


async def writable_module_slugs_for_agent(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID
) -> set[str]:
    """Modules where this agent may propose/apply writes."""
    result = await session.execute(
        select(ModuleAgent.module_slug).where(
            ModuleAgent.tenant_id == tenant_id,
            ModuleAgent.agent_id == agent_id,
            ModuleAgent.can_write.is_(True),
        )
    )
    return {row for row in result.scalars().all()}


async def remove_module_agent(
    session: AsyncSession, tenant_id: UUID, module_slug: str, agent_id: UUID
) -> dict[str, Any]:
    from app.modules.catalog import tenant_module_install_states

    _require_module(module_slug)
    row = (
        await session.execute(
            select(ModuleAgent).where(
                ModuleAgent.tenant_id == tenant_id,
                ModuleAgent.module_slug == module_slug,
                ModuleAgent.agent_id == agent_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise NotFoundError("Agent is not on this module")

    count = await module_agent_count(session, tenant_id, module_slug)
    states = await tenant_module_install_states(session, tenant_id)
    state = states.get(module_slug, "not_installed")
    if state == "installed" and count <= 1:
        raise HTTPException(
            status_code=400,
            detail="Installed modules need at least one assigned agent",
        )

    was_default = row.is_default
    await session.delete(row)
    await session.flush()
    if was_default:
        remaining = (
            await session.execute(
                select(ModuleAgent)
                .where(
                    ModuleAgent.tenant_id == tenant_id,
                    ModuleAgent.module_slug == module_slug,
                )
                .order_by(ModuleAgent.created_at)
                .limit(1)
            )
        ).scalar_one_or_none()
        if remaining:
            remaining.is_default = True
            session.add(remaining)
    await session.commit()
    return {"ok": True}


async def clear_module_agents(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> None:
    await session.execute(
        delete(ModuleAgent).where(
            ModuleAgent.tenant_id == tenant_id,
            ModuleAgent.module_slug == module_slug,
        )
    )
    await session.commit()


def _module_specialist_slug(module_slug: str) -> str:
    return f"module-{module_slug}"


async def soft_archive_module_specialists(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> list[str]:
    """Soft-archive pack specialists for this module (keep history, Govern restore).

    Operator-assigned company agents stay active. Archives the pack agent by
    slug ``module-{slug}``. Roster rows must be cleared separately.
    """
    from app.services.workforce_runtime import archive_agent

    agents = list(
        (
            await session.execute(
                select(Agent).where(
                    Agent.tenant_id == tenant_id,
                    Agent.slug == _module_specialist_slug(module_slug),
                    Agent.kind == "company",
                    Agent.is_active.is_(True),
                )
            )
        ).scalars().all()
    )
    archived: list[str] = []
    for agent in agents:
        try:
            await archive_agent(session, tenant_id, agent.id)
            archived.append(str(agent.id))
        except Exception:  # noqa: BLE001
            logger.warning("module agent archive failed", exc_info=True)
            continue
    return archived


async def managed_module_specialist(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> Agent | None:
    """Active pack specialist for a module, if hired (slug ``module-{slug}``)."""
    return (
        await session.execute(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.slug == _module_specialist_slug(module_slug),
                Agent.kind == "company",
                Agent.is_active.is_(True),
            )
        )
    ).scalars().first()


def filter_tools_for_agent_modules(
    tools: list[dict[str, Any]],
    *,
    enabled_slugs: set[str],
    rostered_slugs: set[str],
    writable_slugs: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Keep module tools only when the module is installed AND the agent is rostered.

    When ``writable_slugs`` is given, propose/apply tools of modules the agent
    may read but not write are also filtered out (read-only roster rows).
    """
    allowed = enabled_slugs & rostered_slugs
    blocked = [
        prefix
        for slug, prefix in MODULE_TOOL_PREFIXES.items()
        if slug not in allowed
    ]
    read_only_prefixes: list[str] = []
    if writable_slugs is not None:
        read_only_prefixes = [
            prefix
            for slug, prefix in MODULE_TOOL_PREFIXES.items()
            if slug in allowed and slug not in writable_slugs
        ]
    if not blocked and not read_only_prefixes:
        return tools

    def keep(tool: dict[str, Any]) -> bool:
        name = str(tool.get("name") or "")
        if any(name.startswith(prefix) for prefix in blocked):
            return False
        for prefix in read_only_prefixes:
            if name.startswith(f"{prefix}propose_") or name.startswith(f"{prefix}apply_"):
                return False
        return True

    return [tool for tool in tools if keep(tool)]
