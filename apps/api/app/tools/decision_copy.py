"""Human-readable copy for gated tool DecisionRequests.

Policy gates used to dump raw ``json.dumps(tool_input)`` into the card body.
Operators should see plain language: what the agent wants to do, on which
integration, with which arguments — never a JSON blob.
"""

from __future__ import annotations

from typing import Any


# MCP tools that only discover capabilities — never mutate remote state.
MCP_DISCOVERY_TOOLS = frozenset(
    {
        "list_tools",
        "list_resources",
        "list_prompts",
        "list_resource_templates",
        "tools_list",
        "ping",
        "health",
        "health_check",
    }
)

# Builtin tools that are safe to describe with a short verb phrase.
_TOOL_VERBS: dict[str, str] = {
    "call_mcp_tool": "Run integration tool",
    "create_task": "Create a task",
    "send_email": "Send an email",
    "create_decision_request": "Ask for a decision",
    "connect_integration": "Connect an integration",
    "suggest_integration": "Suggest an integration",
    "propose_integration": "Propose an integration",
}


def normalize_mcp_tool_name(name: str) -> str:
    return str(name or "").strip().lower().replace("-", "_").replace("/", "_")


def is_mcp_discovery_tool(tool_input: dict[str, Any] | None) -> bool:
    if not isinstance(tool_input, dict):
        return False
    remote = normalize_mcp_tool_name(str(tool_input.get("tool_name") or ""))
    return remote in MCP_DISCOVERY_TOOLS


def mcp_override_key(tool_input: dict[str, Any] | None) -> str | None:
    """Per-server+tool override key so Always allow does not unlock all MCP calls."""
    if not isinstance(tool_input, dict):
        return None
    server = str(tool_input.get("server_name") or "").strip()
    remote = str(tool_input.get("tool_name") or "").strip()
    if not server or not remote:
        return None
    return f"mcp:{server}:{remote}"


def _humanize_token(value: str) -> str:
    text = str(value or "").strip().replace("_", " ").replace("-", " ")
    if not text:
        return ""
    return text[:1].upper() + text[1:]


def _format_args(arguments: Any, *, limit: int = 8) -> list[str]:
    if not isinstance(arguments, dict) or not arguments:
        return []
    lines: list[str] = []
    for idx, (key, value) in enumerate(arguments.items()):
        if idx >= limit:
            lines.append(f"- …and {len(arguments) - limit} more")
            break
        label = _humanize_token(str(key))
        if isinstance(value, (dict, list)):
            rendered = str(value)
            if len(rendered) > 80:
                rendered = rendered[:77] + "…"
        else:
            rendered = str(value)
            if len(rendered) > 120:
                rendered = rendered[:117] + "…"
        lines.append(f"- {label}: {rendered}")
    return lines


def format_policy_decision(tool_name: str, tool_input: dict[str, Any] | None) -> tuple[str, str]:
    """Return ``(title, summary)`` for a gated tool DecisionRequest."""
    payload = tool_input if isinstance(tool_input, dict) else {}

    if tool_name == "call_mcp_tool":
        server = str(payload.get("server_name") or "").strip() or "integration"
        remote = str(payload.get("tool_name") or "").strip() or "tool"
        args = payload.get("arguments")
        remote_label = _humanize_token(remote)
        title = f"Approve: {remote_label} on {server}"
        lines = [
            f"The agent wants to run {remote} on {server}.",
        ]
        arg_lines = _format_args(args)
        if arg_lines:
            lines.append("Arguments:")
            lines.extend(arg_lines)
        else:
            lines.append("No arguments.")
        return title, "\n".join(lines)[:500]

    verb = _TOOL_VERBS.get(tool_name) or _humanize_token(tool_name)
    title = f"Approve: {verb}"
    arg_lines = _format_args(payload)
    if arg_lines:
        summary = f"The agent wants to {verb.lower()}.\n" + "\n".join(arg_lines)
    else:
        summary = f"The agent wants to {verb.lower()}."
    return title, summary[:500]
