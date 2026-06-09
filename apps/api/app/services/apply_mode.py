"""Resolve whether a platform mutation uses draft, yolo (direct apply), or decision."""

from __future__ import annotations

import json
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import tenant_settings
from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.policy import get_or_create_policy

ApplyMode = Literal["draft", "yolo", "decision"]
AutonomyPosture = Literal["manual", "assisted", "autonomous"]

# Default: structural resources require draft; low-risk layout is yolo (assisted posture).
DEFAULT_PLATFORM_APPLY_MODES: dict[str, str] = {
    "agent": "draft",
    "workstream": "draft",
    "blueprint_page": "draft",
    "blueprint_block": "draft",
    "integration": "draft",
    "mcp_server": "draft",
    "canvas_node": "yolo",
    "canvas_edge": "yolo",
    "agent_passport": "draft",
}

AUTONOMY_POSTURES: dict[str, dict[str, Any]] = {
    "manual": {
        "label": "Manual",
        "summary": "Humans review every agent action and structural change before it applies.",
        "policy_mode": "manual",
        "platform_apply_modes": {
            "agent": "draft",
            "workstream": "draft",
            "blueprint_page": "draft",
            "blueprint_block": "draft",
            "integration": "draft",
            "mcp_server": "draft",
            "canvas_node": "draft",
            "canvas_edge": "draft",
            "agent_passport": "draft",
        },
    },
    "assisted": {
        "label": "Assisted",
        "summary": "Routine whitelisted actions run automatically; structural changes queue in Govern.",
        "policy_mode": "whitelist",
        "platform_apply_modes": dict(DEFAULT_PLATFORM_APPLY_MODES),
    },
    "autonomous": {
        "label": "Autonomous",
        "summary": "AI runs operations; integrations always require human approval.",
        "policy_mode": "yolo",
        "platform_apply_modes": {
            "agent": "yolo",
            "workstream": "yolo",
            "blueprint_page": "yolo",
            "blueprint_block": "yolo",
            "integration": "decision",
            "mcp_server": "yolo",
            "canvas_node": "yolo",
            "canvas_edge": "yolo",
            "agent_passport": "draft",
        },
    },
}

DEFAULT_AUTONOMY_POSTURE: AutonomyPosture = "assisted"


def parse_apply_modes(raw: str | dict | None) -> dict[str, str]:
    if isinstance(raw, dict):
        return {k: v for k, v in raw.items() if v in ("draft", "yolo", "decision")}
    try:
        data = json.loads(raw or "{}")
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if v in ("draft", "yolo", "decision")}
    except (json.JSONDecodeError, TypeError):
        pass
    return {}


def resolve_posture(tenant: Tenant) -> AutonomyPosture:
    settings = tenant_settings(tenant)
    posture = settings.get("autonomy_posture", DEFAULT_AUTONOMY_POSTURE)
    if posture in AUTONOMY_POSTURES:
        return posture  # type: ignore[return-value]
    return DEFAULT_AUTONOMY_POSTURE


def posture_to_settings(posture: AutonomyPosture) -> dict[str, Any]:
    if posture not in AUTONOMY_POSTURES:
        posture = DEFAULT_AUTONOMY_POSTURE
    preset = AUTONOMY_POSTURES[posture]
    return {
        "autonomy_posture": posture,
        "platform_apply_modes": dict(preset["platform_apply_modes"]),
    }


def posture_policy_mode(posture: AutonomyPosture) -> str:
    if posture not in AUTONOMY_POSTURES:
        posture = DEFAULT_AUTONOMY_POSTURE
    return str(AUTONOMY_POSTURES[posture]["policy_mode"])


def serialize_posture_catalog() -> list[dict[str, str]]:
    return [
        {
            "id": key,
            "label": str(value["label"]),
            "summary": str(value["summary"]),
        }
        for key, value in AUTONOMY_POSTURES.items()
    ]


def tenant_platform_apply_modes(tenant: Tenant) -> dict[str, str]:
    settings = tenant_settings(tenant)
    merged = dict(DEFAULT_PLATFORM_APPLY_MODES)
    merged.update(parse_apply_modes(settings.get("platform_apply_modes")))
    return merged


async def resolve_apply_mode(
    session: AsyncSession,
    tenant: Tenant,
    agent: Agent | None,
    *,
    resource_type: str,
    tool_name: str | None = None,
) -> ApplyMode:
    """Most restrictive wins unless agent/tenant explicitly yolo."""
    policy = await get_or_create_policy(session, tenant.id)

    if agent is not None:
        if agent.autonomy_level == "manual":
            return "decision"
        if agent.autonomy_level == "auto":
            agent_modes = parse_apply_modes(getattr(agent, "apply_modes_json", "{}"))
            if resource_type in agent_modes:
                mode = agent_modes[resource_type]
                if mode == "yolo":
                    return "yolo"
                if mode == "decision":
                    return "decision"
            return "yolo"

    tenant_modes = tenant_platform_apply_modes(tenant)
    mode = tenant_modes.get(resource_type, "draft")
    if mode == "decision":
        return "decision"
    if mode == "draft":
        return "draft"
    if mode == "yolo":
        return "yolo"

    if policy.mode == "yolo":
        return "yolo"
    if agent is not None and agent.autonomy_level == "approval" and tool_name:
        return "draft"
    return "draft"


def serialize_apply_modes(tenant: Tenant) -> dict[str, Any]:
    return {
        "defaults": DEFAULT_PLATFORM_APPLY_MODES,
        "tenant_modes": tenant_platform_apply_modes(tenant),
        "policy_mode": None,
    }
