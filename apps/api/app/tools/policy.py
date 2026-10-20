"""Tool authorization: one ordered pipeline for every tool call.

Derived from xai-org/grok-build (Apache-2.0); changes listed in docs/third_party/grok-build/CHANGES.md.

Stages, first decisive stage wins:

1. ``PreToolUse`` hooks (in-process). ``deny`` stops; ``ask`` forces a
   question that later stages cannot approve away; ``allow`` only means
   "not blocked"; ``defer`` has no opinion.
2. Rules (``permission_rules`` + Govern ``tool_overrides`` + hard agent rules
   that ask + category sliders set to deny). Deny wins, then ask, then
   allow. A consequential tool is a fixed ask that no allow can widen.
3. Remembered grants (hard agent rules set to Autonomous).
4. Read-only auto-approve (ungated tools, customer reads, MCP discovery).
5. Mode: posture preset, category sliders, agent ceiling.

Tighten-only clamps run last on gated tools: member role, external trust,
AI handling on ``send_reply`` and untrusted input in the turn. The executor
then weighs the agent's ``certainty`` and cited judgement rule.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import tenant_settings
from app.models.auth import Tenant
from app.tools import permission_rules as prules
from app.tools.registry import TOOL_CATEGORIES, ToolSpec

AllowanceMode = Literal["deny", "ask", "allow"]
ALLOWANCE_MODES = ("deny", "ask", "allow")

AutonomyPosture = Literal["manual", "assisted", "autonomous"]
DEFAULT_AUTONOMY_POSTURE: AutonomyPosture = "assisted"

AUTONOMY_POSTURES: dict[str, dict[str, Any]] = {
    "manual": {
        "label": "Manual",
        "summary": "Humans approve every mutating agent action before it applies.",
        "allowances": {category: "ask" for category in TOOL_CATEGORIES},
    },
    "assisted": {
        "label": "Assisted",
        "summary": "Routine messaging and workspace edits run automatically; structural changes ask first.",
        "allowances": {
            "messaging": "allow",
            "workspace": "allow",
            "projects": "ask",
            "agents": "ask",
            "delegation": "allow",
            "channels": "ask",
            "triggers": "ask",
            "integrations": "ask",
            "govern": "ask",
            "tickets": "allow",
        },
    },
    "autonomous": {
        "label": "Autonomous",
        "summary": "AI runs operations; integrations and credentials still ask a human.",
        "allowances": {
            "messaging": "allow",
            "workspace": "allow",
            "projects": "allow",
            "agents": "allow",
            "delegation": "allow",
            "channels": "allow",
            "triggers": "allow",
            "integrations": "ask",
            "govern": "allow",
            "tickets": "allow",
        },
    },
}

# Categories an external (widget/inbound) session may never auto-execute.
# ``delegation`` is included: a site visitor never queues internal work.
EXTERNAL_DENY_CATEGORIES = (
    "agents",
    "delegation",
    "channels",
    "triggers",
    "integrations",
    "govern",
)

# User-role clamp: the same matrix as the API's require_role guards. Members
# may not mutate these categories through an assistant session either — the
# effective mode is min(agent passport, user role). ``delegation`` is absent
# on purpose: starting a run or handing over work needs no role in the API,
# so a member's assistant may do it too.
MEMBER_DENY_CATEGORIES = ("agents", "channels", "triggers", "integrations", "govern")


def serialize_posture_catalog() -> list[dict[str, Any]]:
    return [
        {
            "id": key,
            "label": str(value["label"]),
            "summary": str(value["summary"]),
            "allowances": dict(value["allowances"]),
        }
        for key, value in AUTONOMY_POSTURES.items()
    ]


def resolve_posture(tenant: Tenant) -> AutonomyPosture:
    settings = tenant_settings(tenant)
    posture = settings.get("autonomy_posture", DEFAULT_AUTONOMY_POSTURE)
    if posture in AUTONOMY_POSTURES:
        return posture  # type: ignore[return-value]
    return DEFAULT_AUTONOMY_POSTURE


def _parse_mode_map(raw: Any) -> dict[str, str]:
    data: Any = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw or "{}")
        except (json.JSONDecodeError, TypeError):
            return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if v in ALLOWANCE_MODES}


def tenant_allowances(tenant: Tenant) -> dict[str, str]:
    """Effective per-category sliders: posture defaults + explicit overrides."""
    settings = tenant_settings(tenant)
    posture = resolve_posture(tenant)
    merged = dict(AUTONOMY_POSTURES[posture]["allowances"])
    merged.update(
        {k: v for k, v in _parse_mode_map(settings.get("tool_allowances")).items() if k in TOOL_CATEGORIES}
    )
    return merged


def tenant_tool_overrides(tenant: Tenant) -> dict[str, str]:
    """Per-tool explicit overrides ('always auto' approvals and manual pins)."""
    settings = tenant_settings(tenant)
    return _parse_mode_map(settings.get("tool_overrides"))


async def resolve_tool_mode(
    session: AsyncSession,
    tenant: Tenant,
    agent: Any | None,
    spec: ToolSpec,
    *,
    trust: str = "operator",
    tool_input: dict[str, Any] | None = None,
    user_role: str | None = None,
    tainted: bool = False,
) -> tuple[AllowanceMode, str]:
    """Returns (mode, reason). See ``authorize_tool_call`` for the deciding stage."""
    result = await authorize_tool_call(
        session,
        tenant,
        agent,
        spec,
        trust=trust,
        tool_input=tool_input,
        user_role=user_role,
        tainted=tainted,
    )
    return result.mode, result.reason  # type: ignore[return-value]


@dataclass(frozen=True)
class Authorization:
    mode: str
    reason: str
    stage: str  # hook | rules | grants | read_only | mode | clamp


HookDecision = tuple[str, str] | None
PreToolUseHook = Callable[..., Awaitable[HookDecision]]
_PRE_TOOL_USE_HOOKS: list[PreToolUseHook] = []


def register_pre_tool_use_hook(hook: PreToolUseHook) -> PreToolUseHook:
    """In-process ``PreToolUse`` hook: ``await hook(spec=, tool_input=, tenant=, agent=, trust=)``.

    Returns ``None`` or ``(decision, reason)`` with decision allow | deny | ask | defer.
    A hook that raises fails open.
    """
    if hook not in _PRE_TOOL_USE_HOOKS:
        _PRE_TOOL_USE_HOOKS.append(hook)
    return hook


def unregister_pre_tool_use_hook(hook: PreToolUseHook) -> None:
    if hook in _PRE_TOOL_USE_HOOKS:
        _PRE_TOOL_USE_HOOKS.remove(hook)


async def _run_pre_tool_use_hooks(
    spec: ToolSpec, tool_input: dict[str, Any] | None, tenant: Tenant, agent: Any | None, trust: str
) -> tuple[str, str] | None:
    """First deny stops the chain; an ask outranks allow and defer."""
    asked: tuple[str, str] | None = None
    for hook in list(_PRE_TOOL_USE_HOOKS):
        try:
            outcome = await hook(spec=spec, tool_input=tool_input, tenant=tenant, agent=agent, trust=trust)
        except Exception:
            continue
        if not outcome:
            continue
        decision, reason = str(outcome[0]).lower(), str(outcome[1] or "")
        if decision in ("deny", "block"):
            return "deny", reason or "hook"
        if decision == "ask" and asked is None:
            asked = ("ask", reason or "hook")
    return asked


def tenant_permission_rules(tenant: Tenant) -> list[prules.PermissionRule]:
    settings = tenant_settings(tenant)
    return prules.parse_rules(settings.get("permission_rules"), source="permission_rule")


def _hard_rule(tenant: Tenant, agent: Any | None, spec: ToolSpec) -> dict[str, Any] | None:
    from app.services.agent_rules import all_rules, matching_hard_rules, strictest

    return strictest(matching_hard_rules(all_rules(tenant, agent), spec.name, spec.category))


def _rule_stage(
    tenant: Tenant, agent: Any | None, spec: ToolSpec, tool_input: dict[str, Any] | None
) -> Authorization | None:
    rules = list(tenant_permission_rules(tenant))
    rules += prules.rules_from_overrides(tenant_tool_overrides(tenant))
    if spec.gated and tenant_allowances(tenant).get(spec.category) == "deny":
        rules.append(prules.PermissionRule(action="deny", tool=f"category:{spec.category}", source="category"))
    hard = _hard_rule(tenant, agent, spec)
    if hard is not None and hard["mode"] != "autonomous":
        rules.append(prules.PermissionRule(action="ask", tool=f"tool:{spec.name}", source=f"rule:{hard['id']}"))
    winner = prules.decide(rules, tool_name=spec.name, category=spec.category, tool_input=tool_input)
    if winner is not None and winner.action == "deny":
        return Authorization("deny", _rule_reason(winner), "rules")
    if spec.consequential:
        return Authorization("ask", "consequential", "rules")
    if winner is not None:
        return Authorization(winner.action, _rule_reason(winner), "rules")
    return None


def _rule_reason(rule: prules.PermissionRule) -> str:
    if rule.source == "category":
        return rule.tool
    if rule.source in ("tool_override",) or rule.source.startswith("rule:"):
        return rule.source
    return f"permission_rule:{rule.action}:{rule.tool}"


def _read_only_stage(spec: ToolSpec, tool_input: dict[str, Any] | None) -> Authorization | None:
    from app.tools.decision_copy import is_mcp_discovery_tool

    min_assurance = spec.min_assurance or "none"
    if min_assurance in ("", "none") and not spec.gated:
        return Authorization("allow", "ungated", "read_only")
    if spec.audience == "customer" and not spec.mutating:
        return Authorization("allow", "customer_read", "read_only")
    if spec.name == "call_mcp_tool" and is_mcp_discovery_tool(tool_input):
        return Authorization("allow", "mcp_discovery", "read_only")
    return None


async def authorize_tool_call(
    session: AsyncSession,
    tenant: Tenant,
    agent: Any | None,
    spec: ToolSpec,
    *,
    trust: str = "operator",
    tool_input: dict[str, Any] | None = None,
    user_role: str | None = None,
    tainted: bool = False,
) -> Authorization:
    hook = await _run_pre_tool_use_hooks(spec, tool_input, tenant, agent, trust)
    if hook is not None and hook[0] == "deny":
        return Authorization("deny", f"hook:{hook[1]}", "hook")
    forced_ask = hook is not None

    decided = _rule_stage(tenant, agent, spec, tool_input)
    if decided is None:
        hard = _hard_rule(tenant, agent, spec)
        if hard is not None and hard["mode"] == "autonomous":
            decided = Authorization("allow", f"rule:{hard['id']}", "grants")
    if decided is None:
        decided = _read_only_stage(spec, tool_input)
    if decided is not None and decided.stage == "read_only":
        if forced_ask:
            return Authorization("ask", f"hook:{hook[1]}", "hook")  # type: ignore[index]
        return decided
    if decided is None:
        mode, reason = _mode_stage(tenant, agent, spec)
        decided = Authorization(mode, reason, "mode")
    if forced_ask and decided.mode == "allow":
        decided = Authorization("ask", f"hook:{hook[1]}", "hook")  # type: ignore[index]
    return await _clamp(session, tenant, agent, spec, decided, trust, tool_input, user_role, tainted)


def _mode_stage(tenant: Tenant, agent: Any | None, spec: ToolSpec) -> tuple[str, str]:
    mode: str = tenant_allowances(tenant).get(spec.category, "ask")
    reason = f"category:{spec.category}"

    # The agent's ceiling refines the tenant slider.
    if agent is not None:
        from app.services.agent_rules import normalize_autonomy

        level = normalize_autonomy(getattr(agent, "autonomy_level", "assisted"))
        if level == "manual" and mode == "allow":
            mode, reason = "ask", "agent_manual"
        elif level == "autonomous" and mode == "ask":
            mode, reason = "allow", "agent_autonomous"

    # Snapshot writes apply under Assisted and Autonomous so the owner can
    # refresh without a daily approval card. Manual (workspace or agent) still
    # asks. Delete stays on the projects slider.
    if spec.name in ("create_canvas", "update_folder_canvas", "delete_canvas"):
        from app.services.agent_rules import normalize_autonomy

        posture = resolve_posture(tenant)
        level = "assisted"
        if agent is not None:
            level = normalize_autonomy(getattr(agent, "autonomy_level", "assisted"))
        if posture == "manual" or level == "manual":
            if mode == "allow":
                mode, reason = "ask", "canvas_manual"
        elif spec.name in ("create_canvas", "update_folder_canvas") and mode == "ask":
            mode, reason = "allow", "canvas_snapshot"
    return mode, reason


async def _clamp(
    session: AsyncSession,
    tenant: Tenant,
    agent: Any | None,
    spec: ToolSpec,
    decided: Authorization,
    trust: str,
    tool_input: dict[str, Any] | None,
    user_role: str | None,
    tainted: bool,
) -> Authorization:
    """Tighten-only clamps on gated tools; ungated reads are left to rules."""
    min_assurance = spec.min_assurance or "none"
    if not spec.gated and min_assurance in ("", "none"):
        return decided
    mode, reason, stage = decided.mode, decided.reason, decided.stage

    # A member's session may not mutate categories the API reserves for
    # owners and admins, regardless of agent passport.
    if user_role and user_role not in ("owner", "admin") and spec.category in MEMBER_DENY_CATEGORIES:
        return Authorization("deny", "user_role", "clamp")

    # Sending to an external party also follows the conversation's AI handling:
    # below Autonomous (dial, channel, agent or a flow set to Always review) asks.
    if spec.name == "send_reply" and mode == "allow":
        signal_id = None
        raw_signal_id = (tool_input or {}).get("signal_id")
        if raw_signal_id:
            try:
                signal_id = UUID(str(raw_signal_id))
            except ValueError:
                signal_id = None
        if signal_id:
            from app.models.signal import Signal
            from app.services.ai_handling import resolve_for_signal

            signal = await session.get(Signal, signal_id)
            if signal is not None and signal.tenant_id == tenant.id:
                handling = await resolve_for_signal(session, tenant, signal, agent=agent)
                if handling.effective != "autonomous":
                    mode, reason, stage = "ask", f"ai_handling:{handling.effective}", "clamp"

    # Trust clamp is absolute: external sessions never auto-mutate.
    if trust == "external" and mode != "deny":
        if spec.category in EXTERNAL_DENY_CATEGORIES:
            return Authorization("deny", "external_trust", "clamp")
        # Ticket tools own their own gate (category mode + certainty).
        # The generic allow→ask clamp would turn every widget intake into a
        # DecisionRequest and hide the category's ask_customer / auto path.
        if spec.category != "tickets" and mode == "allow":
            mode, reason, stage = "ask", "external_trust", "clamp"

    # A turn that read content flagged by the prompt guard never mutates on its own.
    if tainted and spec.mutating and mode == "allow":
        mode, reason, stage = "ask", "clamp:untrusted_input", "clamp"

    return Authorization(mode, reason, stage)


async def set_tool_override(
    session: AsyncSession,
    tenant_id: UUID,
    tool_name: str,
    mode: AllowanceMode,
) -> None:
    """Persist a per-tool override (e.g. 'always auto' decision approvals)."""
    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        return
    settings = tenant_settings(tenant)
    overrides = _parse_mode_map(settings.get("tool_overrides"))
    overrides[tool_name] = mode
    settings["tool_overrides"] = overrides
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.flush()


_MODE_RANK = {"allow": 0, "ask": 1, "deny": 2}


def is_stricter_mode(candidate: str, current: str) -> bool:
    """True when ``candidate`` is a tighter gate than ``current``."""
    return _MODE_RANK.get(candidate, 1) > _MODE_RANK.get(current, 1)


async def set_category_allowance(
    session: AsyncSession,
    tenant_id: UUID,
    category: str,
    mode: AllowanceMode,
    *,
    commit: bool = False,
) -> dict[str, str] | None:
    """Write one category into tenant ``tool_allowances``. Returns before/after or None."""
    if category not in TOOL_CATEGORIES or mode not in ALLOWANCE_MODES:
        return None
    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        return None
    before = tenant_allowances(tenant).get(category, "ask")
    settings = tenant_settings(tenant)
    current = _parse_mode_map(settings.get("tool_allowances"))
    current[category] = mode
    settings["tool_allowances"] = current
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return {"category": category, "from": before, "to": mode}