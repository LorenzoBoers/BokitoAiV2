"""Generic module verb dispatch.

Agents call ``{slug}_{verb}`` tools; this module routes the verb to the
module's provider package by convention: ``app.modules.{slug}.router`` must
expose ``call_verb(session, tenant_id, verb, args, *, agent_id)`` and may
expose ``build_proposal(verb, args)`` for custom decision cards.

Adding a new module therefore never touches shared code: add the ModuleSpec
to the catalog and drop a provider package next to the existing ones.
"""

from __future__ import annotations

import importlib
from typing import Any, Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounting.schema import module_error
from app.modules.catalog import get_module

VerbHandler = Callable[..., Awaitable[dict[str, Any]]]

_PROVIDER_CACHE: dict[str, object | None] = {}


def _provider_module(slug: str):
    if slug in _PROVIDER_CACHE:
        return _PROVIDER_CACHE[slug]
    try:
        mod = importlib.import_module(f"app.modules.{slug}.router")
    except ModuleNotFoundError:
        mod = None
    _PROVIDER_CACHE[slug] = mod
    return mod


def module_has_provider(slug: str) -> bool:
    mod = _provider_module(slug)
    return mod is not None and callable(getattr(mod, "call_verb", None))


async def call_module_verb(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    verb: str,
    args: dict[str, Any] | None = None,
    *,
    agent_id: UUID | None = None,
) -> dict[str, Any]:
    """Execute one module verb through the module's provider package."""
    spec = get_module(slug)
    if spec is None:
        return module_error("unknown_module", f"Unknown module '{slug}'.")
    mod = _provider_module(slug)
    handler: VerbHandler | None = getattr(mod, "call_verb", None) if mod else None
    if handler is None:
        return module_error(
            "not_implemented",
            f"The {spec.name} module has no live provider yet.",
        )
    return await handler(session, tenant_id, verb, args or {}, agent_id=agent_id)


async def module_writes_gate(
    session: AsyncSession, tenant_id: UUID, slug: str
) -> dict[str, Any] | None:
    """Return a writes_disabled error unless BOTH write switches are on.

    Platform: env MODULE_WRITES_ENABLED contains the slug (default off).
    Tenant: ModuleInstall.writes_enabled pref (default off).
    """
    from app.config import get_settings
    from app.modules.catalog import get_module_prefs

    spec = get_module(slug)
    name = spec.name if spec else slug
    if not get_settings().module_writes_allowed(slug):
        return module_error(
            "writes_disabled",
            f"{name} writes are disabled on this platform "
            f"(MODULE_WRITES_ENABLED does not include '{slug}'). The approved "
            "decision is recorded, but nothing was written to the package.",
        )
    prefs = await get_module_prefs(session, tenant_id, slug)
    if not bool(prefs.get("writes_enabled")):
        return module_error(
            "writes_disabled",
            f"{name} writes are disabled for this workspace. An owner or "
            f"admin can enable them under Modules > {name}. The approved "
            "decision is recorded, but nothing was written.",
        )
    return None


def build_module_proposal(
    slug: str, verb: str, args: dict[str, Any]
) -> dict[str, Any] | None:
    """Decision payload for one module write proposal.

    Providers may shape their own card (approve option pointing at a
    registered apply tool); otherwise a generic record-only card is built.
    """
    spec = get_module(slug)
    if spec is None:
        return None
    mod = _provider_module(slug)
    custom = getattr(mod, "build_proposal", None) if mod else None
    if callable(custom):
        proposal = custom(verb, args)
        if proposal is not None:
            return proposal
    if not verb.startswith("propose_"):
        return None
    kind = verb.removeprefix("propose_")
    card = next((c for c in spec.tool_cards if c.verb == verb), None)
    description = str(args.get("summary") or args.get("description") or "").strip()
    payload = {k: v for k, v in args.items() if k not in ("summary", "description")}
    inner = payload.pop("payload", None)
    if isinstance(inner, dict):
        payload = {**inner, **payload}
    return {
        "title": str(
            args.get("title") or (card.label if card else f"{spec.name}: {kind}")
        ),
        "summary": description
        or f"Proposed {spec.name.lower()} write ({kind}). Review and approve to record it.",
        "options": [
            {"id": "approve", "label": "Approve", "action_type": "approve", "payload": payload},
            {"id": "reject", "label": "Reject", "action_type": "reject"},
        ],
    }
