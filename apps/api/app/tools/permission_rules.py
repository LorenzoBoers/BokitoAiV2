"""Permission rules: allow, deny or ask for a tool, matched by filter and pattern.

Derived from xai-org/grok-build (Apache-2.0); changes listed in docs/third_party/grok-build/CHANGES.md.

A rule is ``{"action", "tool", "pattern", "pattern_mode"}``:

- ``action``: ``allow`` | ``deny`` | ``ask``. A rule without an action denies
  (CWE-1188): leaving the field out must never create a catch-all allow.
- ``tool``: ``any`` | ``mcp`` | ``web_fetch`` | ``agent_message`` |
  ``tool:<name>`` | ``category:<name>``.
- ``pattern``: optional glob. On ``mcp`` it matches ``server:tool``; on
  ``web_fetch`` with ``pattern_mode=domain`` it matches the URL host; on
  ``any`` / ``tool:`` / ``category:`` it matches the tool name.

Among matching rules deny wins, then ask, then allow.
"""

from __future__ import annotations

import fnmatch
import json
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

RuleAction = Literal["allow", "deny", "ask"]
RULE_ACTIONS: tuple[str, ...] = ("allow", "deny", "ask")
PATTERN_MODES: tuple[str, ...] = ("glob", "domain")
TOOL_FILTERS: tuple[str, ...] = ("any", "mcp", "web_fetch", "agent_message")
FILTER_PREFIXES: tuple[str, ...] = ("tool:", "category:")
MAX_RULES = 200

_WEB_FETCH_TOOLS = frozenset({"fetch_url"})
_AGENT_MESSAGE_TOOLS = frozenset({"ask_agent", "handoff_to", "send_subagent_message", "spawn_subagent"})
_ACTION_RANK = {"deny": 0, "ask": 1, "allow": 2}


@dataclass(frozen=True)
class PermissionRule:
    action: str
    tool: str = "any"
    pattern: str = ""
    pattern_mode: str = "glob"
    source: str = "rule"

    def as_dict(self) -> dict[str, str]:
        return {
            "action": self.action,
            "tool": self.tool,
            "pattern": self.pattern,
            "pattern_mode": self.pattern_mode,
        }


class InvalidRule(ValueError):
    pass


def _valid_filter(tool: str) -> bool:
    if tool in TOOL_FILTERS:
        return True
    for prefix in FILTER_PREFIXES:
        if tool.startswith(prefix) and len(tool) > len(prefix):
            return True
    return False


def parse_rule(raw: Any, *, source: str = "rule") -> PermissionRule:
    if not isinstance(raw, dict):
        raise InvalidRule("A rule is an object")
    action = str(raw.get("action") or "deny").strip().lower()
    if action == "approve":
        action = "allow"
    if action not in RULE_ACTIONS:
        raise InvalidRule(f"Unknown action {action!r}")
    tool = str(raw.get("tool") or "any").strip()
    if tool.lower() in TOOL_FILTERS:
        tool = tool.lower()
    if tool.lower() == "agentmessage":
        tool = "agent_message"
    if not _valid_filter(tool):
        raise InvalidRule(f"Unknown tool filter {tool!r}")
    pattern = str(raw.get("pattern") or "").strip()[:200]
    pattern_mode = str(raw.get("pattern_mode") or "glob").strip().lower()
    if pattern_mode not in PATTERN_MODES:
        raise InvalidRule(f"Unknown pattern_mode {pattern_mode!r}")
    if pattern_mode == "domain" and tool != "web_fetch":
        raise InvalidRule("pattern_mode=domain only applies to web_fetch")
    return PermissionRule(action=action, tool=tool, pattern=pattern, pattern_mode=pattern_mode, source=source)


def parse_rules(raw: Any, *, source: str = "rule", strict: bool = False) -> list[PermissionRule]:
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw or "[]")
        except (TypeError, ValueError):
            data = []
    if not isinstance(data, list):
        return []
    out: list[PermissionRule] = []
    for item in data[:MAX_RULES]:
        try:
            out.append(parse_rule(item, source=source))
        except InvalidRule:
            if strict:
                raise
    return out


def rules_from_overrides(overrides: dict[str, str]) -> list[PermissionRule]:
    """Govern per-tool pins (``tool_overrides``) as rules.

    ``mcp:{server}:{tool}`` keys become ``mcp`` rules with pattern ``server:tool``.
    """
    out: list[PermissionRule] = []
    for key, mode in overrides.items():
        if mode not in RULE_ACTIONS:
            continue
        if key.startswith("mcp:"):
            out.append(PermissionRule(action=mode, tool="mcp", pattern=key[4:], source="tool_override"))
        else:
            out.append(PermissionRule(action=mode, tool=f"tool:{key}", source="tool_override"))
    return out


def _mcp_target(tool_input: dict[str, Any] | None) -> str:
    data = tool_input or {}
    server = str(data.get("server_name") or data.get("server") or "").strip()
    tool = str(data.get("tool_name") or data.get("tool") or "").strip()
    return f"{server}:{tool}" if server or tool else ""


def _url_host(tool_input: dict[str, Any] | None) -> str:
    raw = str((tool_input or {}).get("url") or "").strip()
    if not raw:
        return ""
    try:
        return (urlparse(raw if "://" in raw else f"https://{raw}").hostname or "").lower()
    except ValueError:
        return ""


def _glob(pattern: str, value: str) -> bool:
    return fnmatch.fnmatchcase(value.lower(), pattern.lower())


def _domain(pattern: str, host: str) -> bool:
    pattern = pattern.lower().lstrip(".")
    if pattern.startswith("*."):
        base = pattern[2:]
        return host == base or host.endswith(f".{base}")
    return host == pattern or host.endswith(f".{pattern}")


def rule_matches(
    rule: PermissionRule,
    *,
    tool_name: str,
    category: str,
    tool_input: dict[str, Any] | None,
) -> bool:
    if rule.tool == "mcp":
        if tool_name != "call_mcp_tool":
            return False
        return not rule.pattern or _glob(rule.pattern, _mcp_target(tool_input))
    if rule.tool == "web_fetch":
        if tool_name not in _WEB_FETCH_TOOLS:
            return False
        if not rule.pattern:
            return True
        if rule.pattern_mode == "domain":
            host = _url_host(tool_input)
            return bool(host) and _domain(rule.pattern, host)
        return _glob(rule.pattern, str((tool_input or {}).get("url") or ""))
    if rule.tool == "agent_message":
        if tool_name not in _AGENT_MESSAGE_TOOLS:
            return False
        return not rule.pattern or _glob(rule.pattern, tool_name)
    if rule.tool.startswith("tool:"):
        if rule.tool[5:] != tool_name:
            return False
    elif rule.tool.startswith("category:"):
        if rule.tool[9:] != category:
            return False
    return not rule.pattern or _glob(rule.pattern, tool_name)


def decide(
    rules: list[PermissionRule],
    *,
    tool_name: str,
    category: str,
    tool_input: dict[str, Any] | None,
) -> PermissionRule | None:
    """The deciding rule among all matches: deny wins, then ask, then allow."""
    hits = [r for r in rules if rule_matches(r, tool_name=tool_name, category=category, tool_input=tool_input)]
    if not hits:
        return None
    return min(hits, key=lambda r: _ACTION_RANK[r.action])
