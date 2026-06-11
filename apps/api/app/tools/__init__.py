"""Unified tool layer: one registry, one policy engine, two consumers.

The same registry powers (a) internal agents (AgentLoop tool definitions) and
(b) the tenant-scoped MCP server endpoint at ``/api/mcp``. Every call — agent
or external — flows through :func:`app.tools.executor.execute_tool`, which is
gated by the allowance policy engine (deny | ask | allow per tool category).
"""

from app.tools.executor import execute_tool
from app.tools.registry import (
    ToolContext,
    ToolSpec,
    agent_allowed_tools,
    filter_tools_for_agent,
    get_tool_definitions,
    get_tool_spec,
    iter_tool_specs,
)

__all__ = [
    "ToolContext",
    "ToolSpec",
    "agent_allowed_tools",
    "execute_tool",
    "filter_tools_for_agent",
    "get_tool_definitions",
    "get_tool_spec",
    "iter_tool_specs",
]
