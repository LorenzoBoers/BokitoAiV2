"""Tool registry: every governed capability is a registered ToolSpec."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

# Categories double as the allowance-slider groups in Govern.
#
# ``agents`` and ``delegation`` split along the same line as the API's role
# guards: configuring the workforce (create/update an agent or workstream)
# is owner/admin territory, while using it (hand over work, start a run) is
# open to every member. See app/routers/workstreams.py.
TOOL_CATEGORIES = (
    "messaging",
    "workspace",
    "projects",
    "agents",
    "delegation",
    "channels",
    "triggers",
    "integrations",
    "govern",
    "cases",
)

# Where a tool call originated; clamps what the policy engine will allow.
TRUST_LEVELS = ("operator", "external", "api")
TOOL_AUDIENCES = ("operator", "customer", "both")
ASSURANCE_LEVELS = ("none", "verified")


def audience_for_trust(trust: str) -> str:
    """Widget / inbound sessions are customers; everyone else is an operator."""
    return "customer" if trust == "external" else "operator"


@dataclass
class ToolContext:
    session: AsyncSession
    tenant_id: UUID
    user_id: UUID | None
    agent: Any | None = None
    run_id: UUID | None = None
    signal_id: UUID | None = None
    # Project scope of the current run: doc/repo/queue tools default to it.
    project_id: UUID | None = None
    trust: str = "operator"
    # Resolved allowance mode for this call: "apply" (allowed) or "ask".
    mode: str = "apply"
    # Membership role of the session user (owner | admin | member); None for
    # autonomous runs. The policy clamps member sessions to member-safe tools.
    user_role: str | None = None
    audience: str = "operator"
    assurance_level: str = "none"
    assurance_expires_at: datetime | None = None
    assurance_email: str = ""
    surface: str = ""


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
    # Who may see and call this tool. Default operator hides it from webchat.
    audience: str = "operator"
    # none | verified. Customer reads that need a magic-link stay at verified.
    min_assurance: str = "none"
    sensitivity: str = "none"

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


def tool_matches_audience(spec: ToolSpec, audience: str) -> bool:
    return spec.audience in ("both", audience)


def filter_tools_for_audience(
    tools: list[dict[str, Any]],
    audience: str,
    *,
    enabled_customer_tools: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Hide operator-only tools from customers and opt-in customer verbs."""
    kept: list[dict[str, Any]] = []
    enabled = enabled_customer_tools or set()
    for tool in tools:
        spec = get_tool_spec(str(tool.get("name") or ""))
        if spec is None:
            kept.append(tool)
            continue
        if not tool_matches_audience(spec, audience):
            continue
        if spec.audience == "customer" and spec.name not in enabled:
            continue
        kept.append(tool)
    return kept


_builtin_loaded = False


def _ensure_builtin_loaded() -> None:
    global _builtin_loaded
    if _builtin_loaded:
        return
    _builtin_loaded = True
    import app.tools.calendar  # noqa: F401 — registers calendar tools
    import app.tools.module_tools  # noqa: F401 — registers {slug}_{verb} tools from the catalog
    import app.tools.modules  # noqa: F401 — registers list_modules / recommend_module
    import app.tools.builtin  # noqa: F401 — registers built-in tools
    import app.tools.project_work  # noqa: F401 — registers project queue/doc tools
    import app.tools.cases  # noqa: F401 — registers operational case tools
