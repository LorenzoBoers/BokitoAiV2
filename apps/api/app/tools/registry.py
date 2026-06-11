"""Tool registry: every governed capability is a registered ToolSpec."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

# Categories double as the allowance-slider groups in Govern.
TOOL_CATEGORIES = (
    "messaging",
    "workspace",
    "agents",
    "channels",
    "triggers",
    "integrations",
    "govern",
)

# Where a tool call originated; clamps what the policy engine will allow.
TRUST_LEVELS = ("operator", "external", "api")


@dataclass
class ToolContext:
    session: AsyncSession
    tenant_id: UUID
    user_id: UUID | None
    agent: Any | None = None
    run_id: UUID | None = None
    signal_id: UUID | None = None
    trust: str = "operator"
    # Resolved allowance mode for this call: "apply" (allowed) or "ask".
    mode: str = "apply"


ToolHandler = Callable[[ToolContext, dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass
class ToolSpec:
    name: str
    description: str
    category: str
    input_schema: dict[str, Any]
    handler: ToolHandler
    mutating: bool = True
    # gated=False: tool is never policy-gated (read-only or human-input tools).
    gated: bool = True
    # handles_ask=True: handler implements the "ask" mode itself (platform
    # mutations create a pending PlatformChange + DecisionRequest).
    handles_ask: bool = False

    def definition(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }


_REGISTRY: dict[str, ToolSpec] = {}


def register_tool(spec: ToolSpec) -> ToolSpec:
    if spec.category not in TOOL_CATEGORIES:
        raise ValueError(f"Unknown tool category: {spec.category}")
    _REGISTRY[spec.name] = spec
    return spec


def get_tool_spec(name: str) -> Optional[ToolSpec]:
    _ensure_builtin_loaded()
    return _REGISTRY.get(name)


def iter_tool_specs() -> list[ToolSpec]:
    _ensure_builtin_loaded()
    return list(_REGISTRY.values())


def get_tool_definitions() -> list[dict[str, Any]]:
    """Anthropic-format tool definitions for the agent loop."""
    return [spec.definition() for spec in iter_tool_specs()]


def agent_allowed_tools(agent: Any | None) -> set[str] | None:
    """The set of tool names this agent may use, or None for no restriction."""
    if agent is None:
        return None
    try:
        names = json.loads(getattr(agent, "tools_json", "[]") or "[]")
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(names, list) or not names:
        return None
    return {str(n) for n in names}


def filter_tools_for_agent(tools: list[dict[str, Any]], agent: Any | None) -> list[dict[str, Any]]:
    allowed = agent_allowed_tools(agent)
    if allowed is None:
        return tools
    return [t for t in tools if t["name"] in allowed]


_builtin_loaded = False


def _ensure_builtin_loaded() -> None:
    global _builtin_loaded
    if _builtin_loaded:
        return
    _builtin_loaded = True
    import app.tools.builtin  # noqa: F401 — registers built-in tools
