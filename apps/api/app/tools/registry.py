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
    "tickets",
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
    # Agent turn this call belongs to (stream id). Decisions raised in one
    # turn share a bundle and render as one approval card.
    turn_id: str | None = None

    @property
    def bundle_id(self) -> str:
        return self.turn_id or (str(self.run_id) if self.run_id else "")


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
    # Money movement, contracts and similar irreversible effects always ask,
    # regardless of posture, agent passport, or per-tool overrides.
    consequential: bool = False
    # Activity line label ("List recent activity"); empty = humanized name.
    display_name: str = ""
    # Integration provider slug for the activity icon (e.g. "king_accountancy").
    provider: str = ""

    def definition(self) -> dict[str, Any]:
        schema = self.input_schema
        if self.mutating and self.gated and self.audience != "customer":
            # Meta-arguments: the executor reads and strips them before the handler runs.
            properties = dict(schema.get("properties") or {})
            properties.setdefault(
                "certainty",
                {"type": "integer", "minimum": 1, "maximum": 10, "description": "How sure you are this is right (1-10)"},
            )
            properties.setdefault(
                "rule_id", {"type": "string", "description": "Id of the team rule that applies, if any"}
            )
            schema = {**schema, "properties": properties}
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": schema,
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


def humanize_tool_name(name: str) -> str:
    words = (name or "").replace("-", "_").split("_")
    text = " ".join(w for w in words if w)
    return text[:1].upper() + text[1:] if text else ""


def tool_presentation(name: str) -> dict[str, str]:
    """Label + provider for an activity line. Runtime providers (MCP) override."""
    spec = get_tool_spec(name)
    label = (spec.display_name if spec and spec.display_name else "") or humanize_tool_name(name)
    return {"label": label, "provider": spec.provider if spec else ""}


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


# Snapshot canvases are a platform capability. A specialist passport (for example
# a trading desk that only lists call_mcp_tool) still gets these in operator chat.
CANVAS_OPERATOR_TOOLS = frozenset(
    {
        "list_canvases",
        "get_folder_canvas",
        "create_canvas",
        "update_folder_canvas",
        "delete_canvas",
    }
)

# A refresh wake rewrites one snapshot. It does not open a canvas, and it does
# not ask the operator (that is what dropped a second thread into For you).
CANVAS_REFRESH_TOOLS = frozenset(
    {
        "list_canvases",
        "get_folder_canvas",
        "update_folder_canvas",
    }
)

CANVAS_WAKE_DENY = frozenset(
    {
        "create_canvas",
        "delete_canvas",
        "create_decision_request",
        "propose_action",
        "send_reply",
        "handoff_to_human",
        "split_conversation",
        "close_thread",
        "create_task",
        "delegate_to_agent",
        "assign_conversation",
        "schedule_task",
        "set_thread_schedule",
        "upsert_trigger",
        "create_tag",
        "delete_tag",
        "update_tag",
        "set_thread_tags",
        "create_project",
        "create_folder",
        "delete_folder",
        "create_agent",
        "update_agent",
        "create_flow",
        "update_flow",
        "propose_session_checkout",
    }
)


OPERATOR_PROGRESS_TOOL = "update_progress"
OPERATOR_REACTION_TOOL = "react_to_message"
# Reads of who works here. A specialist passport may omit them; an operator
# chat still needs one request to see agents and teams.
OPERATOR_ORG_TOOLS = frozenset({"get_tenant_overview", "list_agents", "list_departments"})
IMAGE_TOOL = "generate_image"


def with_default_image_tool(
    tools: list[dict[str, Any]],
    *,
    enabled: bool = True,
) -> list[dict[str, Any]]:
    """Every agent can generate images unless the tenant turned the tool off."""
    if not enabled:
        return [tool for tool in tools if tool["name"] != IMAGE_TOOL]
    if any(tool["name"] == IMAGE_TOOL for tool in tools):
        return tools
    extra = [tool for tool in get_tool_definitions() if tool["name"] == IMAGE_TOOL]
    return [*tools, *extra] if extra else tools


def with_operator_org_tools(
    tools: list[dict[str, Any]], *, trust: str, refresh: bool = False
) -> list[dict[str, Any]]:
    """Agents and teams are tenant facts, not a specialist skill."""
    if trust == "external" or refresh:
        return tools
    have = {tool["name"] for tool in tools}
    missing = OPERATOR_ORG_TOOLS - have
    if not missing:
        return tools
    extra = [tool for tool in get_tool_definitions() if tool["name"] in missing]
    return [*tools, *extra] if extra else tools


def with_operator_reaction_tool(
    tools: list[dict[str, Any]], *, trust: str, refresh: bool = False
) -> list[dict[str, Any]]:
    """Reacting on the open chat is part of the conversation, not a specialist passport."""
    if trust == "external" or refresh:
        return tools
    if any(tool["name"] == OPERATOR_REACTION_TOOL for tool in tools):
        return tools
    extra = [tool for tool in get_tool_definitions() if tool["name"] == OPERATOR_REACTION_TOOL]
    return [*tools, *extra] if extra else tools


def with_operator_progress_tool(
    tools: list[dict[str, Any]], *, trust: str, refresh: bool = False
) -> list[dict[str, Any]]:
    """Interim spoken updates stay available even on a narrow passport."""
    if trust == "external" or refresh:
        return tools
    have = {t["name"] for t in tools}
    if OPERATOR_PROGRESS_TOOL in have:
        return tools
    extra = [t for t in get_tool_definitions() if t["name"] == OPERATOR_PROGRESS_TOOL]
    return [*tools, *extra] if extra else tools


def with_operator_canvas_tools(
    tools: list[dict[str, Any]], *, trust: str, refresh: bool = False
) -> list[dict[str, Any]]:
    if trust == "external":
        return tools
    allowed = CANVAS_REFRESH_TOOLS if refresh else CANVAS_OPERATOR_TOOLS
    if refresh:
        tools = [t for t in tools if t["name"] not in {"create_canvas", "delete_canvas"}]
    have = {t["name"] for t in tools}
    extra = [t for t in get_tool_definitions() if t["name"] in allowed and t["name"] not in have]
    if not extra:
        return tools
    return [*tools, *extra]


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
    import app.tools.images  # noqa: F401 — registers generate_image
    import app.tools.project_work  # noqa: F401 — registers project queue/doc tools
    import app.tools.tickets  # noqa: F401 — registers ticket tools
    import app.tools.contacts  # noqa: F401 — registers CRM contact tools
