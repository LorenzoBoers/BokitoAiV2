"""Per-agent platform scope enforcement for self-maintenance."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.project import Project

# Canonical scope strings used in agent passports.
PLATFORM_SCOPES = frozenset(
    {
        "platform:read",
        "platform:graph:edit",
        "platform:agent:create",
        "platform:agent:update",
        "platform:workstream:create",
        "platform:workstream:update",
        "platform:blueprint:write",
        "platform:integration:propose",
        "platform:integration:create",
        "platform:mcp:register",
        "platform:edge:connect",
    }
)

ROLE_DEFAULT_SCOPES: dict[str, list[str]] = {
    "assistant": ["platform:read", "platform:blueprint:write"],
    "orchestrator": [
        "platform:read",
        "platform:graph:edit",
        "platform:workstream:create",
        "platform:workstream:update",
        "platform:blueprint:write",
        "platform:edge:connect",
        "platform:integration:propose",
        "platform:mcp:register",
    ],
    "po": [
        "platform:read",
        "platform:workstream:create",
        "platform:workstream:update",
        "platform:blueprint:write",
        "platform:edge:connect",
    ],
    "coding": ["platform:read"],
    "orchestra": ["platform:read", "platform:blueprint:write", "platform:integration:propose"],
}


def parse_scopes(raw: str | list | None) -> list[str]:
    if isinstance(raw, list):
        return [s for s in raw if isinstance(s, str) and s in PLATFORM_SCOPES]
    try:
        data = json.loads(raw or "[]")
        if isinstance(data, list):
            return [s for s in data if isinstance(s, str) and s in PLATFORM_SCOPES]
    except (json.JSONDecodeError, TypeError):
        pass
    return []


def effective_scopes(agent: Agent) -> list[str]:
    explicit = parse_scopes(agent.permission_scopes_json)
    if explicit:
        return explicit
    return list(ROLE_DEFAULT_SCOPES.get(agent.role, ["platform:read"]))


def agent_has_scope(agent: Agent | None, scope: str) -> bool:
    if agent is None:
        return True
    if scope not in PLATFORM_SCOPES:
        return False
    scopes = effective_scopes(agent)
    if "platform:read" in scopes and scope == "platform:read":
        return True
    return scope in scopes


async def agent_can_access_project(
    session: AsyncSession, agent: Agent, project_id: UUID
) -> bool:
    if agent.role in ("orchestrator", "orchestra", "assistant"):
        return True
    if agent.role == "po":
        result = await session.execute(
            select(Project).where(Project.id == project_id, Project.tenant_id == agent.tenant_id)
        )
        project = result.scalar_one_or_none()
        return project is not None and project.po_agent_id == agent.id
    return False


def require_scope(agent: Agent | None, scope: str) -> tuple[bool, str]:
    if agent_has_scope(agent, scope):
        return True, "ok"
    return False, f"Missing scope: {scope}"


def serialize_agent_scopes(agent: Agent) -> dict[str, Any]:
    return {
        "effective_scopes": effective_scopes(agent),
        "explicit_scopes": parse_scopes(agent.permission_scopes_json),
        "role_defaults": ROLE_DEFAULT_SCOPES.get(agent.role, []),
    }
