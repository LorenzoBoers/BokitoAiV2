"""Chat model selection policy: override > agent > workspace > catalog.

Modes (stored on workspace prefs and ``Agent.model``):

- ``automatic`` — Bokito picks a managed tier from ``task_hint``
- ``inherit`` — agent follows the workspace mode (agents only)
- a managed slug (``bokito-maki`` / ``bokito-ai-3-1`` / ``bokito-kong``)
- any other enabled catalog / BYOK slug

Callers that need a live provider key still use ``resolve_model_call`` with the
slug this module returns. Per-item forces (flow stage, Agenda task, …) pass
``override_slug`` and win over the agent default.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import bokito_models
from app.services import model_catalog as catalog_svc
from app.services import tenant_models

AUTOMATIC = "automatic"
INHERIT = "inherit"

WORKSPACE_MODES: tuple[str, ...] = (AUTOMATIC, *bokito_models.MANAGED_CHAT_SLUGS)
AGENT_MODES: tuple[str, ...] = (INHERIT, AUTOMATIC, *bokito_models.MANAGED_CHAT_SLUGS)

_LIGHT_HINTS = (
    "light",
    "lighter",
    "cheap",
    "simple",
    "triage",
    "classify",
    "tag",
    "short",
    "summarize",
)
_HEAVY_HINTS = (
    "heavy",
    "heavier",
    "complex",
    "long",
    "code",
    "research",
    "analysis",
    "plan",
    "deep",
    "reason",
)


@dataclass(frozen=True)
class ModelSelectionContext:
    """Inputs for resolving which product-facing chat model to use."""

    override_slug: str | None = None
    agent_model: str | None = None
    task_hint: str | None = None


@dataclass(frozen=True)
class SelectedChatModel:
    slug: str
    """Where the slug came from: override | agent | workspace | automatic | catalog."""
    source: str
    """True when Automatic chose the tier (agent or workspace mode was automatic)."""
    automatic: bool = False


def is_automatic(value: str | None) -> bool:
    return (value or "").strip().lower() == AUTOMATIC


def is_inherit(value: str | None) -> bool:
    raw = (value or "").strip().lower()
    return raw in ("", INHERIT)


def normalize_workspace_mode(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw in WORKSPACE_MODES:
        return raw
    if raw in ("bokito", "standard", "default"):
        return catalog_svc.BOKITO_MODEL_SLUG
    if raw in ("maki", "lighter"):
        return "bokito-maki"
    if raw in ("kong", "heavier"):
        return "bokito-kong"
    return catalog_svc.BOKITO_MODEL_SLUG


def normalize_agent_mode(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if is_inherit(raw):
        return INHERIT
    if is_automatic(raw):
        return AUTOMATIC
    return raw


def pick_automatic_slug(task_hint: str | None = None) -> str:
    """Choose a managed tier when mode is Automatic.

    Hints are free-text for now (callers can pass ``lighter`` / ``heavier`` /
    stage names). Unknown hints fall back to the standard Bokito tier.
    """
    h = (task_hint or "").strip().lower()
    if h:
        for token in _HEAVY_HINTS:
            if token == h or token in h:
                return "bokito-kong"
        for token in _LIGHT_HINTS:
            if token == h or token in h:
                return "bokito-maki"
    return catalog_svc.BOKITO_MODEL_SLUG


def workspace_chat_mode(prefs: dict[str, Any]) -> str:
    """Effective workspace mode from prefs (legacy ``default_chat`` as fallback).

    Unset prefs default to Automatic so new workspaces pick a tier per action.
    """
    mode = prefs.get("workspace_chat_mode")
    if isinstance(mode, str) and mode.strip():
        return normalize_workspace_mode(mode)
    default = (prefs.get("default_chat") or "").strip().lower()
    if default in bokito_models.MANAGED_CHAT_SLUGS:
        return default
    if is_automatic(default):
        return AUTOMATIC
    return AUTOMATIC


async def resolve_chat_model_slug(
    session: AsyncSession,
    tenant_id: UUID,
    ctx: ModelSelectionContext | None = None,
) -> SelectedChatModel:
    """Resolve the product chat slug for an action.

    Order: override → agent mode → workspace mode → catalog default.
    """
    ctx = ctx or ModelSelectionContext()
    prefs = await tenant_models.get_tenant_model_prefs(session, tenant_id)

    override = (ctx.override_slug or "").strip()
    if override and not is_automatic(override) and not is_inherit(override):
        return SelectedChatModel(slug=override, source="override")

    agent_raw = normalize_agent_mode(ctx.agent_model)
    if agent_raw and not is_inherit(agent_raw):
        if is_automatic(agent_raw):
            return SelectedChatModel(
                slug=pick_automatic_slug(ctx.task_hint),
                source="automatic",
                automatic=True,
            )
        return SelectedChatModel(slug=agent_raw, source="agent")

    ws = workspace_chat_mode(prefs)
    if is_automatic(ws):
        return SelectedChatModel(
            slug=pick_automatic_slug(ctx.task_hint),
            source="automatic",
            automatic=True,
        )
    if ws in bokito_models.MANAGED_CHAT_SLUGS:
        return SelectedChatModel(slug=ws, source="workspace")

    return SelectedChatModel(slug=catalog_svc.BOKITO_MODEL_SLUG, source="catalog")
