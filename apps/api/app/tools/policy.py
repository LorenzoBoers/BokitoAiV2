"""Allowance policy engine: one resolution path for every tool call.

Each tool category has an allowance slider: ``deny`` | ``ask`` | ``allow``.
Resolution layers (later layers refine earlier ones):

1. Tenant posture preset -> per-category defaults
2. Tenant per-category slider overrides (``tool_allowances`` in settings)
3. Agent passport (``autonomy_level``: manual caps at ask, auto lifts ask to allow)
4. Explicit per-tool overrides (``tool_overrides`` — "always auto" approvals)
5. Session trust clamp (external/widget callers can never auto-mutate)

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
            "channels": "ask",
            "triggers": "ask",
            "integrations": "ask",
            "govern": "ask",
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
            "channels": "allow",
            "triggers": "allow",
            "integrations": "ask",
            "govern": "allow",
        },
    },
}

# Categories an external (widget/inbound) session may never auto-execute.
EXTERNAL_DENY_CATEGORIES = ("agents", "channels", "triggers", "integrations", "govern")


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
) -> tuple[AllowanceMode, str]:
    """Returns (mode, reason)."""
    if not spec.gated or not spec.mutating:
        return "allow", "ungated"

    mode: str = tenant_allowances(tenant).get(spec.category, "ask")
    reason = f"category:{spec.category}"

    # Agent passport refines the tenant slider.
    if agent is not None:
        level = getattr(agent, "autonomy_level", "approval")
        if level == "manual" and mode == "allow":
            mode, reason = "ask", "agent_manual"
        elif level == "auto" and mode == "ask":
            mode, reason = "allow", "agent_auto"

    # Explicit per-tool override wins over slider + passport.
    override = tenant_tool_overrides(tenant).get(spec.name)
    if override:
        mode, reason = override, "tool_override"

    # Trust clamp is absolute: external sessions never auto-mutate.
    if trust == "external":
        if spec.category in EXTERNAL_DENY_CATEGORIES:
            return "deny", "external_trust"
        if mode == "allow":
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
