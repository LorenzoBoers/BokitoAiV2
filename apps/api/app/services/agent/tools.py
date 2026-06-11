"""Compatibility shim: the tool layer moved to :mod:`app.tools`.

Import from ``app.tools`` directly in new code.
"""

from app.tools.executor import execute_tool
from app.tools.registry import (
    agent_allowed_tools,
    filter_tools_for_agent,
    get_tool_definitions,
)

__all__ = [
    "agent_allowed_tools",
    "execute_tool",
    "filter_tools_for_agent",
    "get_tool_definitions",
]
