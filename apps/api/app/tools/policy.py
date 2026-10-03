"""Allowance policy engine: one resolution path for every tool call.

Each tool category has an allowance slider: ``deny`` | ``ask`` | ``allow``.
Resolution layers (later layers refine earlier ones):

1. Tenant posture preset -> per-category defaults
2. Tenant per-category slider overrides (``tool_allowances`` in settings)
3. Agent ceiling (``autonomy_level``: manual caps at ask, autonomous lifts ask to allow)
4. Explicit per-tool overrides (``tool_overrides`` pinned in Govern)
5. Exception rules bound to a tool or category (``app.services.agent_rules``)
6. Session trust clamp (external/widget callers can never auto-mutate)

The executor then weighs the agent's ``certainty`` and cited judgement rule.

Replaces the legacy ActionPolicy/whitelist + apply-modes layering.
"""

from __future__ import annotations

import json
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import tenant_settings
from app.models.auth import Tenant
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
            "cases": "allow",
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
            "cases": "allow",
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
) -> tuple[AllowanceMode, str]:
    """Returns (mode, reason)."""
    from app.tools.decision_copy import is_mcp_discovery_tool, mcp_override_key

    if spec.consequential:
        return "ask", "consequential"

    min_assurance = spec.min_assurance or "none"
    if min_assurance not in ("", "none"):
        pass
    elif not spec.gated:
        return "allow", "ungated"
    # gated=True reads used to short-circuit here via mutating=False. They
    # must go through the allowance stack (and execute_tool audience/assurance).
    if spec.audience == "customer" and not spec.mutating:
        return "allow", "customer_read"

    # User-role clamp: a session run by a member may not mutate categories the
    # API reserves for owners and admins, regardless of agent passport.
    if (
        user_role
        and user_role not in ("owner", "admin")
        and spec.category in MEMBER_DENY_CATEGORIES
    ):
        return "deny", "user_role"

    # MCP discovery (list_tools, ping, …) never needs a human gate.
    if spec.name == "call_mcp_tool" and is_mcp_discovery_tool(tool_input):
        return "allow", "mcp_discovery"

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

    # Explicit per-tool override wins over slider + passport.
    # MCP Always-allow keys are ``mcp:{server}:{tool}``; fall back to the
    # wrapper name for legacy blanket overrides.
    overrides = tenant_tool_overrides(tenant)
    override = None
    if spec.name == "call_mcp_tool":
        mcp_key = mcp_override_key(tool_input)
        if mcp_key and mcp_key in overrides:
            override = overrides[mcp_key]
    if override is None:
        override = overrides.get(spec.name)
    if override:
        mode, reason = override, "tool_override"

    # Exception rules (workspace and agent) bound to this tool or its category.
    # The strictest matching rule wins; deny from the slider stays deny.
    from app.services.agent_rules import all_rules, matching_hard_rules, mode_to_allowance, strictest

    hard = strictest(matching_hard_rules(all_rules(tenant, agent), spec.name, spec.category))
    if hard is not None and mode != "deny":
        mode, reason = mode_to_allowance(hard["mode"]), f"rule:{hard['id']}"

    # Sending to an external party is additionally governed by the Signal
    # Type attached to the thread. No type, or draft mode, safely asks.
    if spec.name == "send_reply":
        signal_id = None
        raw_signal_id = (tool_input or {}).get("signal_id")
        if raw_signal_id:
            try:
                signal_id = UUID(str(raw_signal_id))
            except ValueError:
                signal_id = None
        if signal_id:
            from app.models.case import Case, CaseType

            send_mode = (
                await session.execute(
                    select(CaseType.send_mode)
                    .join(Case, Case.case_type_id == CaseType.id)
                    .where(
                        Case.tenant_id == tenant.id,
                        Case.signal_id == signal_id,
                        # An unaccepted proposal must not widen what may be sent.
                        Case.status.in_(("open", "waiting")),
                    )
                    .order_by(Case.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none() or "draft"
            if send_mode in ("draft", "ask"):
                mode, reason = "ask", f"signal_type:{send_mode}"

    # Trust clamp is absolute: external sessions never auto-mutate.
    if trust == "external":
        if spec.audience == "customer" and not spec.mutating:
            return "allow", "customer_read"
        if spec.category in EXTERNAL_DENY_CATEGORIES:
            return "deny", "external_trust"
        # Operational case tools own their own gate (type.mode + certainty).
        # The generic allow→ask clamp would turn every widget intake into a
        # DecisionRequest and hide the type's ask_customer / auto path.
        if spec.category != "cases" and mode == "allow":
            mode, reason = "ask", "external_trust"

    return mode, reason  # type: ignore[return-value]


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