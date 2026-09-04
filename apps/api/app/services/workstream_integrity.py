"""Integrity checks for workstreams installed from module templates.

One checker, used at two moments: when a template is installed and before
every run. A failing runtime check pauses the run with a DecisionRequest
instead of failing silently (handled by the engine).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.orchestra import Workstream, WorkstreamStep


async def _has_active_agent(
    session: AsyncSession, tenant_id: UUID, *, role: str = "", agent_id: UUID | None = None
) -> bool:
    query = select(Agent.id).where(
        Agent.tenant_id == tenant_id, Agent.is_active.is_(True)
    )
    if agent_id is not None:
        query = query.where(Agent.id == agent_id)
    elif role:
        query = query.where(Agent.role == role)
    return (await session.execute(query.limit(1))).scalar_one_or_none() is not None


async def _module_problems(
    session: AsyncSession,
    tenant_id: UUID,
    module_slug: str,
    *,
    requires_connection: bool,
) -> list[str]:
    from app.modules.catalog import (
        MODULE_BY_SLUG,
        active_module_connections,
        tenant_module_install_states,
    )

    problems: list[str] = []
    spec = MODULE_BY_SLUG.get(module_slug)
    if spec is None:
        return [f"Unknown module '{module_slug}'."]
    states = await tenant_module_install_states(session, tenant_id)
    if states.get(module_slug) != "installed":
        problems.append(f"The {spec.name} module is not installed.")
    if requires_connection and not await active_module_connections(
        session, tenant_id, module_slug
    ):
        problems.append(f"The {spec.name} module has no connected integration.")
    return problems


async def check_template_requirements(
    session: AsyncSession, tenant_id: UUID, template
) -> list[str]:
    """Requirements manifest check at template-install time.

    Returns a list of human-readable problems; empty means installable.
    """
    problems = await _module_problems(
        session,
        tenant_id,
        template.module_slug,
        requires_connection=template.requires_module_connection,
    )
    for role in template.required_agent_roles:
        if not await _has_active_agent(session, tenant_id, role=role):
            problems.append(f"No active agent with role '{role}'.")
    return problems


async def check_run_readiness(
    session: AsyncSession,
    tenant_id: UUID,
    ws: Workstream,
    steps: list[WorkstreamStep],
) -> list[str]:
    """Pre-run check: agents resolvable, linked sections present, and (for
    template copies) the module requirements still hold."""
    problems: list[str] = []

    if ws.module_slug:
        from app.modules.catalog import get_workstream_template

        template = get_workstream_template(ws.module_slug, ws.template_slug)
        requires_connection = bool(template and template.requires_module_connection)
        problems.extend(
            await _module_problems(
                session, tenant_id, ws.module_slug, requires_connection=requires_connection
            )
        )

    lead_available = await _has_active_agent(session, tenant_id)
    for step in steps:
        if step.kind != "agent":
            continue
        if step.agent_id is not None:
            if not await _has_active_agent(session, tenant_id, agent_id=step.agent_id):
                # Fixed agent gone: role/lead fallback still saves the step.
                if step.agent_role and await _has_active_agent(
                    session, tenant_id, role=step.agent_role
                ):
                    continue
                if not lead_available:
                    problems.append(
                        f"Step '{step.name}' has no available agent (assigned agent inactive)."
                    )
            continue
        if step.agent_role:
            if await _has_active_agent(session, tenant_id, role=step.agent_role):
                continue
            if not lead_available:
                problems.append(
                    f"Step '{step.name}' needs an active agent with role '{step.agent_role}'."
                )
            continue
        if not lead_available:
            problems.append(f"Step '{step.name}' has no active agent to run it.")

    section_ids: list[UUID] = []
    for step in steps:
        for raw in _step_section_ids(step):
            try:
                section_ids.append(UUID(raw))
            except ValueError:
                problems.append(
                    f"Step '{step.name}' links an invalid knowledge section id."
                )
    if section_ids:
        from app.models.workspace import DocSection

        found = {
            row
            for row in (
                await session.execute(
                    select(DocSection.id).where(
                        DocSection.id.in_(section_ids),
                        DocSection.tenant_id == tenant_id,
                    )
                )
            ).scalars()
        }
        missing = [sid for sid in section_ids if sid not in found]
        if missing:
            problems.append(
                f"{len(missing)} linked knowledge section(s) no longer exist."
            )
    return problems


def _step_section_ids(step: WorkstreamStep) -> list[str]:
    import json

    try:
        data = json.loads(step.knowledge_section_ids_json or "[]")
    except json.JSONDecodeError:
        return []
    return [str(v) for v in data] if isinstance(data, list) else []
