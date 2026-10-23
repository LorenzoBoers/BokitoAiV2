"""Agent definition: the contract an agent seat runs under.

Derived from xai-org/grok-build (Apache-2.0); changes listed in docs/third_party/grok-build/CHANGES.md.

On the ``Agent`` row next to ``tools_json`` (allowlist) and ``autonomy_level``:

- ``disallowed_tools_json``: denylist; a denied tool is gone even when listed.
- ``capability_mode``: ``read-only`` (no mutating tool) | ``read-write`` (no
  consequential tool) | ``all``.
- ``effort``: ``low`` | ``medium`` | ``high``, how much the model thinks.
- ``prompt_mode``: ``extend`` adds Bokito's prompt around the agent's own;
  ``full`` keeps only the agent prompt plus the safety, language and
  when-to-ask blocks.
- ``skills_json``: workspace doc paths listed as skills.
- ``completion_requirement_json``: ``{"any_of": [...], "reminder": "..."}``.
- ``mcp_inheritance_json``: ``{"mode": "all" | "none" | "named" | "except", "servers": [...]}``.

Subagent personas and roles live in tenant settings
(``subagent_personas`` / ``subagent_roles``). Model resolution order: explicit
spawn-time override, role default, persona default, parent agent.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from app.exceptions import status_error


CAPABILITY_MODES = ("read-only", "read-write", "all")
PROMPT_MODES = ("extend", "full")
MCP_INHERITANCE_MODES = ("all", "none", "named", "except")
IO_TYPES = ("file", "doc", "text", "json")
MAX_LIST = 100
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")


def _load(raw: Any, default: Any) -> Any:
    if isinstance(raw, (list, dict)):
        return raw
    try:
        data = json.loads(raw or "")
    except (TypeError, ValueError):
        return default
    return data if isinstance(data, type(default)) else default


def _str_list(raw: Any) -> list[str]:
    data = _load(raw, [])
    out: list[str] = []
    for item in data:
        text = str(item or "").strip()
        if text and text not in out:
            out.append(text[:200])
    return out[:MAX_LIST]


def disallowed_tools(agent: Any | None) -> set[str]:
    if agent is None:
        return set()
    return set(_str_list(getattr(agent, "disallowed_tools_json", "[]")))


def capability_mode(agent: Any | None) -> str:
    value = str(getattr(agent, "capability_mode", "all") or "all") if agent is not None else "all"
    return value if value in CAPABILITY_MODES else "all"


def prompt_mode(agent: Any | None) -> str:
    value = str(getattr(agent, "prompt_mode", "extend") or "extend") if agent is not None else "extend"
    return value if value in PROMPT_MODES else "extend"


def effort(agent: Any | None) -> str:
    from app.services.agent.effort_policy import normalize_effort

    return normalize_effort(getattr(agent, "effort", "") if agent is not None else "")


def skills(agent: Any | None) -> list[str]:
    if agent is None:
        return []
    return _str_list(getattr(agent, "skills_json", "[]"))


def completion_requirement(agent: Any | None) -> dict[str, Any]:
    if agent is None:
        return {}
    return normalize_completion_requirement(_load(getattr(agent, "completion_requirement_json", "{}"), {}))


def normalize_completion_requirement(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    names = raw.get("any_of")
    if names is None and raw.get("tool"):
        names = [raw.get("tool")]
    tools = _str_list(names or [])
    if not tools:
        return {}
    return {"any_of": tools, "reminder": str(raw.get("reminder") or "").strip()[:500]}


def mcp_inheritance(agent: Any | None) -> dict[str, Any]:
    if agent is None:
        return {"mode": "all", "servers": []}
    return normalize_mcp_inheritance(_load(getattr(agent, "mcp_inheritance_json", "{}"), {}))


def normalize_mcp_inheritance(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"mode": "all", "servers": []}
    mode = str(raw.get("mode") or "all")
    if mode not in MCP_INHERITANCE_MODES:
        mode = "all"
    servers = _str_list(raw.get("servers") or [])
    if mode in ("named", "except") and not servers:
        mode = "none" if mode == "named" else "all"
    return {"mode": mode, "servers": servers if mode in ("named", "except") else []}


def mcp_server_allowed(agent: Any | None, server_name: str) -> bool:
    rule = mcp_inheritance(agent)
    mode, servers = rule["mode"], {s.lower() for s in rule["servers"]}
    name = (server_name or "").strip().lower()
    if mode == "all":
        return True
    if mode == "none":
        return False
    if mode == "named":
        return name in servers
    return name not in servers


def capability_allows(mode: str, spec: Any) -> bool:
    if mode == "read-only":
        return not getattr(spec, "mutating", True) or not getattr(spec, "gated", True)
    if mode == "read-write":
        return not getattr(spec, "consequential", False)
    return True


def tool_permitted(agent: Any | None, tool_name: str) -> tuple[bool, str]:
    """Definition check for one call; the passport allowlist is checked separately."""
    if agent is None:
        return True, ""
    if tool_name in disallowed_tools(agent):
        return False, "disallowed_tools"
    mode = capability_mode(agent)
    if mode != "all":
        from app.tools.registry import get_tool_spec

        spec = get_tool_spec(tool_name)
        if spec is not None and not capability_allows(mode, spec):
            return False, f"capability:{mode}"
    return True, ""


def filter_tools(tools: list[dict[str, Any]], agent: Any | None) -> list[dict[str, Any]]:
    if agent is None:
        return tools
    return [t for t in tools if tool_permitted(agent, str(t.get("name") or ""))[0]]


def skills_block(agent: Any | None) -> str:
    paths = skills(agent)
    if not paths:
        return ""
    lines = ["## Skills", "Workspace docs that describe how you work. Read one with read_doc when it applies:"]
    lines += [f"- {p}" for p in paths]
    return "\n".join(lines)


def validate_definition(payload: dict[str, Any]) -> dict[str, str]:
    """API input -> column values. Raises 422 on unknown modes."""
    out: dict[str, str] = {}
    if "disallowed_tools" in payload and payload["disallowed_tools"] is not None:
        out["disallowed_tools_json"] = json.dumps(_str_list(payload["disallowed_tools"]))
    if payload.get("capability_mode") is not None:
        if payload["capability_mode"] not in CAPABILITY_MODES:
            raise status_error(status_code=422, detail="capability_mode is read-only, read-write or all")
        out["capability_mode"] = payload["capability_mode"]
    if payload.get("prompt_mode") is not None:
        if payload["prompt_mode"] not in PROMPT_MODES:
            raise status_error(status_code=422, detail="prompt_mode is extend or full")
        out["prompt_mode"] = payload["prompt_mode"]
    if payload.get("effort") is not None:
        from app.services.agent.effort_policy import EFFORTS

        if payload["effort"] not in EFFORTS:
            raise status_error(status_code=422, detail="effort is low, medium or high")
        out["effort"] = payload["effort"]
    if "skills" in payload and payload["skills"] is not None:
        out["skills_json"] = json.dumps(_str_list(payload["skills"]))
    if "completion_requirement" in payload and payload["completion_requirement"] is not None:
        out["completion_requirement_json"] = json.dumps(
            normalize_completion_requirement(payload["completion_requirement"])
        )
    if "mcp_inheritance" in payload and payload["mcp_inheritance"] is not None:
        raw = payload["mcp_inheritance"]
        if isinstance(raw, dict) and raw.get("mode") not in (None, *MCP_INHERITANCE_MODES):
            raise status_error(status_code=422, detail="mcp_inheritance.mode is all, none, named or except")
        out["mcp_inheritance_json"] = json.dumps(normalize_mcp_inheritance(raw))
    return out


def serialize_definition(agent: Any) -> dict[str, Any]:
    return {
        "disallowed_tools": sorted(disallowed_tools(agent)),
        "capability_mode": capability_mode(agent),
        "prompt_mode": prompt_mode(agent),
        "effort": effort(agent),
        "skills": skills(agent),
        "completion_requirement": completion_requirement(agent),
        "mcp_inheritance": mcp_inheritance(agent),
    }


# --- Subagent personas and roles ---------------------------------------------


@dataclass
class Persona:
    name: str
    instructions: str
    description: str = ""
    inputs: list[dict[str, Any]] = field(default_factory=list)
    outputs: list[dict[str, Any]] = field(default_factory=list)
    model: str = ""
    reasoning_effort: str = ""


@dataclass
class Role:
    name: str
    description: str = ""
    default_capability_mode: str = ""
    model: str = ""
    instructions: str = ""


@dataclass
class SubagentSeat:
    model: str
    capability_mode: str
    reasoning_effort: str
    persona: Persona | None
    role: Role | None


def _io_fields(raw: Any) -> list[dict[str, Any]]:
    out = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or not str(item.get("name") or "").strip():
            continue
        io_type = str(item.get("io_type") or "file")
        out.append(
            {
                "name": str(item["name"]).strip()[:60],
                "io_type": io_type if io_type in IO_TYPES else "file",
                "required": bool(item.get("required", False)),
                "description": str(item.get("description") or "")[:300],
            }
        )
    return out[:20]


def _settings(tenant: Any) -> dict[str, Any]:
    from app.dependencies import tenant_settings

    return tenant_settings(tenant) if tenant is not None else {}


def parse_persona(name: str, raw: Any) -> Persona:
    if not isinstance(raw, dict):
        raise ValueError(f"Persona {name!r} is not an object")
    instructions = str(raw.get("instructions") or "").strip()
    if not instructions:
        raise ValueError(f"Persona {name!r} has no instructions")
    description = str(raw.get("description") or "").strip() or instructions.split("\n\n", 1)[0]
    return Persona(
        name=name,
        instructions=instructions[:4000],
        description=description[:300],
        inputs=_io_fields(raw.get("inputs")),
        outputs=_io_fields(raw.get("outputs")),
        model=str(raw.get("model") or "").strip(),
        reasoning_effort=str(raw.get("reasoning_effort") or "").strip(),
    )


def parse_role(name: str, raw: Any) -> Role:
    if not isinstance(raw, dict):
        raise ValueError(f"Role {name!r} is not an object")
    mode = str(raw.get("default_capability_mode") or "")
    return Role(
        name=name,
        description=str(raw.get("description") or "")[:300],
        default_capability_mode=mode if mode in CAPABILITY_MODES else "",
        model=str(raw.get("model") or "").strip(),
        instructions=str(raw.get("instructions") or raw.get("prompt") or "")[:4000],
    )


def tenant_personas(tenant: Any) -> dict[str, Persona]:
    raw = _settings(tenant).get("subagent_personas")
    out: dict[str, Persona] = {}
    for name, value in (raw.items() if isinstance(raw, dict) else []):
        try:
            out[str(name)] = parse_persona(str(name), value)
        except ValueError:
            continue
    return out


def tenant_roles(tenant: Any) -> dict[str, Role]:
    raw = _settings(tenant).get("subagent_roles")
    out: dict[str, Role] = {}
    for name, value in (raw.items() if isinstance(raw, dict) else []):
        try:
            out[str(name)] = parse_role(str(name), value)
        except ValueError:
            continue
    return out


def validate_catalog(kind: str, raw: Any) -> dict[str, dict[str, Any]]:
    """Persona/role catalog from the API; raises 422 on a bad entry."""
    if not isinstance(raw, dict):
        raise status_error(status_code=422, detail=f"{kind} is an object keyed by name")
    out: dict[str, dict[str, Any]] = {}
    for name, value in raw.items():
        key = str(name).strip().lower()
        if not _NAME_RE.match(key):
            raise status_error(status_code=422, detail=f"Invalid name {name!r}")
        try:
            parsed = parse_persona(key, value) if kind == "personas" else parse_role(key, value)
        except ValueError as exc:
            raise status_error(status_code=422, detail=str(exc)) from exc
        out[key] = {k: v for k, v in parsed.__dict__.items() if k != "name"}
    return out


def resolve_subagent_seat(
    tenant: Any,
    child_agent: Any | None,
    parent_agent: Any | None,
    *,
    explicit_model: str = "",
    role_name: str = "",
    persona_name: str = "",
) -> SubagentSeat:
    """Model, capability and persona for a child. Unknown role/persona fails the spawn."""
    persona = None
    if persona_name:
        persona = tenant_personas(tenant).get(persona_name)
        if persona is None:
            raise ValueError(f"Unknown persona {persona_name!r}")
    role = None
    if role_name:
        role = tenant_roles(tenant).get(role_name)
        if role is None:
            raise ValueError(f"Unknown role {role_name!r}")
    parent_model = str(getattr(child_agent or parent_agent, "model", "") or "")
    model = (
        explicit_model.strip()
        or (role.model if role else "")
        or (persona.model if persona else "")
        or parent_model
    )
    mode = (role.default_capability_mode if role else "") or capability_mode(child_agent or parent_agent)
    return SubagentSeat(
        model=model,
        capability_mode=mode,
        reasoning_effort=(persona.reasoning_effort if persona else ""),
        persona=persona,
        role=role,
    )
