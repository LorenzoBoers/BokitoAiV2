"""Runtime profile resolution and application to agents."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.orchestra import AgentProfile
from app.models.orchestration import RuntimeProfile


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def get_runtime_profile(
    session: AsyncSession, tenant_id: UUID, profile_id: UUID | None
) -> RuntimeProfile | None:
    if not profile_id:
        return None
    result = await session.execute(
        select(RuntimeProfile).where(RuntimeProfile.id == profile_id, RuntimeProfile.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()


async def resolve_runtime_snapshot(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    agent: Agent,
    step_runtime_profile_id: UUID | None = None,
    task_runtime_profile_id: UUID | None = None,
    legacy_agent_profile_id: UUID | None = None,
) -> dict[str, Any]:
    """Resolve model/tools/autonomy with override chain: step > task > agent default > agent fields."""
    profile: RuntimeProfile | None = None
    for pid in (step_runtime_profile_id, task_runtime_profile_id, agent.default_runtime_profile_id):
        if pid:
            profile = await get_runtime_profile(session, tenant_id, pid)
            if profile:
                break

    legacy: AgentProfile | None = None
    if not profile and legacy_agent_profile_id:
        result = await session.execute(
            select(AgentProfile).where(
                AgentProfile.id == legacy_agent_profile_id,
                AgentProfile.tenant_id == tenant_id,
            )
        )
        legacy = result.scalar_one_or_none()

    tools_override: list = []
    if profile and profile.tools_json.strip() not in ("", "[]"):
        try:
            tools_override = json.loads(profile.tools_json)
        except json.JSONDecodeError:
            tools_override = []
    elif legacy and legacy.tools_json.strip() not in ("", "[]"):
        try:
            tools_override = json.loads(legacy.tools_json)
        except json.JSONDecodeError:
            tools_override = []

    snapshot = {
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "provider": profile.provider if profile else (legacy.provider if legacy else agent.provider),
        "model": profile.model if profile else (legacy.model if legacy else agent.model),
        "thinking_budget": profile.thinking_budget if profile else agent.thinking_budget,
        "max_tokens": profile.max_tokens if profile else (legacy.max_tokens if legacy else agent.max_tokens),
        "max_loops": profile.max_loops if profile else agent.max_loops,
        "autonomy_level": profile.autonomy_level if profile else agent.autonomy_level,
        "cost_aware": profile.cost_aware if profile else agent.cost_aware,
        "max_cost_cents": profile.max_cost_cents if profile else 0,
        "runtime_profile_id": str(profile.id) if profile else None,
        "role_tag": profile.role_tag if profile else "executor",
        "tools_override": tools_override,
        "system_prompt_extra": legacy.system_prompt if legacy else "",
    }
    return snapshot


def apply_snapshot_to_agent(agent: Agent, snapshot: dict[str, Any]) -> Agent:
    """Return ephemeral agent with resolved runtime fields (no ORM detach issues)."""
    extra = snapshot.get("system_prompt_extra") or ""
    system_prompt = f"{agent.system_prompt}\n\n{extra}".strip() if extra else agent.system_prompt
    tools_override = snapshot.get("tools_override") or []
    tools_json = json.dumps(tools_override) if tools_override else agent.tools_json
    return Agent(
        id=agent.id,
        tenant_id=agent.tenant_id,
        name=agent.name,
        role=agent.role,
        slug=agent.slug,
        model=snapshot.get("model") or agent.model,
        provider=snapshot.get("provider") or agent.provider,
        system_prompt=system_prompt,
        thinking_budget=int(snapshot.get("thinking_budget") or agent.thinking_budget),
        max_tokens=int(snapshot.get("max_tokens") or agent.max_tokens),
        max_loops=int(snapshot.get("max_loops") or agent.max_loops),
        autonomy_level=snapshot.get("autonomy_level") or agent.autonomy_level,
        cost_aware=bool(snapshot.get("cost_aware", agent.cost_aware)),
        tools_json=tools_json,
        permission_scopes_json=agent.permission_scopes_json,
        is_active=agent.is_active,
    )
