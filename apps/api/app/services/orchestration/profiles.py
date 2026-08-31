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
        "thinking_budget": agent.thinking_budget,
        "max_tokens": agent.max_tokens,
        "max_loops": agent.max_loops,
        "autonomy_level": agent.autonomy_level,
        "cost_aware": agent.cost_aware,
        "max_cost_cents": agent.max_cost_cents,
        "tools_override": [],
        "system_prompt_extra": "",
    }


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
        max_cost_cents=int(snapshot.get("max_cost_cents") or agent.max_cost_cents),
        tools_json=tools_json,
        permission_scopes_json=agent.permission_scopes_json,
        is_active=agent.is_active,
    )
