"""Runtime snapshot resolution: the Agent is the single configuration passport.

Model, tools, autonomy, budgets all live on the Agent row. A snapshot is the
frozen copy of those fields recorded on each run so history stays explainable
after the agent is reconfigured.
"""

from __future__ import annotations

import json
from typing import Any

from app.models.agent import Agent


def resolve_runtime_snapshot(agent: Agent) -> dict[str, Any]:
    """Freeze the agent's runtime fields for one run."""
    return {
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "provider": agent.provider,
        "model": agent.model,
        "effort": agent.effort,
        "max_tokens": agent.max_tokens,
        "max_loops": agent.max_loops,
        "autonomy_level": agent.autonomy_level,
        "cost_aware": agent.cost_aware,
        "max_cost_cents": agent.max_cost_cents,
        "tools_override": [],
        "system_prompt_extra": "",
    }


def _snapshot_effort(snapshot: dict[str, Any], agent: Agent) -> str:
    from app.services.agent.effort_policy import effort_from_budget, normalize_effort

    if snapshot.get("effort"):
        return normalize_effort(snapshot["effort"], agent.effort)
    if snapshot.get("thinking_budget"):
        return effort_from_budget(snapshot["thinking_budget"])
    return normalize_effort(agent.effort)


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
        effort=_snapshot_effort(snapshot, agent),
        max_tokens=int(snapshot.get("max_tokens") or agent.max_tokens),
        max_loops=int(snapshot.get("max_loops") or agent.max_loops),
        autonomy_level=snapshot.get("autonomy_level") or agent.autonomy_level,
        cost_aware=bool(snapshot.get("cost_aware", agent.cost_aware)),
        max_cost_cents=int(snapshot.get("max_cost_cents") or agent.max_cost_cents),
        tools_json=tools_json,
        permission_scopes_json=agent.permission_scopes_json,
        is_active=agent.is_active,
        settings_json=agent.settings_json,
        disallowed_tools_json=agent.disallowed_tools_json,
        capability_mode=agent.capability_mode,
        prompt_mode=agent.prompt_mode,
        skills_json=agent.skills_json,
        completion_requirement_json=agent.completion_requirement_json,
        mcp_inheritance_json=agent.mcp_inheritance_json,
    )
