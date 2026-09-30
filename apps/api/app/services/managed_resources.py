"""Managed resources: stack/module desired state without silent un-archive.

Platform and tenant stacks may create and patch agents they own. When an
operator archives a managed agent, reconcile must not force it back — it
proposes a PlatformChange (Decision) instead.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.platform_change import PlatformChange

MANAGED_ORIGINS = frozenset({"platform", "module", "stack", "user"})
RESTORE_REJECT_COOLDOWN = timedelta(days=7)

# Display labels for known packs (fallback when settings_json has no label).
_ORIGIN_LABELS: dict[tuple[str, str], str] = {
    ("stack", "trading"): "Trading",
}


@dataclass
class EnsureResult:
    agent: Agent
    action: str  # created | patched | restore_proposed | restore_pending | restore_cooldown
    change: PlatformChange | None = None


def is_managed(agent: Agent) -> bool:
    return bool((agent.managed_origin or "").strip())


def origin_label(agent: Agent) -> str:
    stored = _settings(agent).get("origin_label")
    if isinstance(stored, str) and stored.strip():
        return stored.strip()
    key = ((agent.managed_origin or "").strip(), (agent.managed_ref or "").strip())
    if key in _ORIGIN_LABELS:
        return _ORIGIN_LABELS[key]
    ref = (agent.managed_ref or "").strip()
    if ref:
        return ref.replace("-", " ").replace("_", " ").title()
    origin = (agent.managed_origin or "").strip()
    return origin.title() if origin else ""


def management_payload(agent: Agent) -> dict[str, Any]:
    managed = is_managed(agent)
    return {
        "managed": managed,
        "managed_origin": (agent.managed_origin or "").strip() or None,
        "managed_ref": (agent.managed_ref or "").strip() or None,
        "template_slug": (agent.template_slug or "").strip() or None,
        "origin_label": origin_label(agent) if managed else None,
    }


def _settings(agent: Agent) -> dict[str, Any]:
    try:
        data = json.loads(agent.settings_json or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _set_origin_label(agent: Agent, label: str) -> None:
    if not label.strip():
        return
    stored = _settings(agent)
    management = stored.get("management")
    if not isinstance(management, dict):
        management = {}
    management["origin_label"] = label.strip()
    stored["management"] = management
    # Flat key for quick UI reads without nested parse elsewhere.
    stored["origin_label"] = label.strip()
    agent.settings_json = json.dumps(stored)


def stamp_provenance(
    agent: Agent,
    *,
    managed_origin: str,
    managed_ref: str,
    template_slug: str,
    origin_label: str = "",
) -> None:
    agent.managed_origin = (managed_origin or "").strip()
    agent.managed_ref = (managed_ref or "").strip()
    agent.template_slug = (template_slug or "").strip()
    if origin_label:
        _set_origin_label(agent, origin_label)


def _is_archived(agent: Agent) -> bool:
    return agent.kind == "archived" or not agent.is_active


def _apply_fields(agent: Agent, fields: dict[str, Any]) -> None:
    """Patch stack-owned columns. Never clears provenance or un-archives."""
    for key in (
        "name",
        "role",
        "slug",
        "model",
        "provider",
        "system_prompt",
        "chat_access",
        "autonomy_level",
        "runtime_status",
        "audience",
        "parent_agent_id",
        "thinking_budget",
        "max_tokens",
        "max_loops",
        "max_cost_cents",
    ):
        if key in fields and fields[key] is not None:
            setattr(agent, key, fields[key])
    if "tools" in fields:
        agent.tools_json = json.dumps(fields["tools"] or [])
    if "tools_json" in fields and isinstance(fields["tools_json"], str):
        agent.tools_json = fields["tools_json"]
    if "permission_scopes" in fields:
        agent.permission_scopes_json = json.dumps(fields["permission_scopes"] or [])
    agent.updated_at = datetime.utcnow()


async def _find_managed_agent(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    managed_origin: str,
    managed_ref: str,
    template_slug: str,
    match_slugs: list[str],
) -> Agent | None:
    by_prov = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.managed_origin == managed_origin,
            Agent.managed_ref == managed_ref,
            Agent.template_slug == template_slug,
        )
    )
    found = by_prov.scalars().first()
    if found:
        return found
    if not match_slugs:
        return None
    by_slug = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.slug.in_(match_slugs),
        )
    )
    return by_slug.scalars().first()


async def _pending_restore(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID
) -> PlatformChange | None:
    result = await session.execute(
        select(PlatformChange)
        .where(
            PlatformChange.tenant_id == tenant_id,
            PlatformChange.resource_type == "agent",
            PlatformChange.resource_id == str(agent_id),
            PlatformChange.status.in_(("draft", "pending_review")),
        )
        .order_by(PlatformChange.created_at.desc())
    )
    for row in result.scalars().all():
        try:
            after = json.loads(row.after_json or "{}")
        except json.JSONDecodeError:
            after = {}
        if after.get("restore"):
            return row
    return None


async def _recent_rejected_restore(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID
) -> PlatformChange | None:
    cutoff = datetime.utcnow() - RESTORE_REJECT_COOLDOWN
    result = await session.execute(
        select(PlatformChange)
        .where(
            PlatformChange.tenant_id == tenant_id,
            PlatformChange.resource_type == "agent",
            PlatformChange.resource_id == str(agent_id),
            PlatformChange.status == "rejected",
            PlatformChange.resolved_at.is_not(None),
            PlatformChange.resolved_at >= cutoff,
        )
        .order_by(PlatformChange.resolved_at.desc())
    )
    for row in result.scalars().all():
        try:
            after = json.loads(row.after_json or "{}")
        except json.JSONDecodeError:
            after = {}
        if after.get("restore"):
            return row
    return None


async def _propose_restore(
    session: AsyncSession,
    tenant: Tenant,
    agent: Agent,
    *,
    origin_label_text: str,
) -> PlatformChange:
    from app.services.platform_changes import propose_platform_change
    from app.services.platform_watch import ensure_agent_channel

    channel = await ensure_agent_channel(session, tenant.id, agent=agent)
    label = origin_label_text or origin_label(agent) or "the platform"
    summary = (
        f"Restore managed agent “{agent.name}” from {label}. "
        "It was archived by an operator; approving brings it back to the library."
    )
    change, _ = await propose_platform_change(
        session,
        tenant,
        resource_type="agent",
        change_kind="update",
        resource_id=str(agent.id),
        mode="ask",
        signal_id=channel.id,
        summary=summary,
        before={
            "agent_id": str(agent.id),
            "kind": agent.kind,
            "is_active": agent.is_active,
        },
        after={
            "agent_id": str(agent.id),
            "restore": True,
            "kind": "company",
            "is_active": True,
            "runtime_status": "standby",
        },
    )
    return change


async def ensure_managed_agent(
    session: AsyncSession,
    tenant: Tenant,
    *,
    managed_origin: str,
    managed_ref: str,
    template_slug: str,
    display_label: str = "",
    create_fields: dict[str, Any],
    patch_fields: dict[str, Any] | None = None,
    match_slugs: list[str] | None = None,
) -> EnsureResult:
    """Create, patch, or propose restore for a stack/module-owned agent.

    Never silently un-archives. Archived managed agents get a Decision.
    """
    origin = (managed_origin or "").strip()
    ref = (managed_ref or "").strip()
    tmpl = (template_slug or "").strip()
    if origin not in MANAGED_ORIGINS:
        raise ValueError(f"invalid managed_origin: {managed_origin!r}")
    if not ref or not tmpl:
        raise ValueError("managed_ref and template_slug are required")

    label = (display_label or "").strip() or _ORIGIN_LABELS.get((origin, ref), "")
    slugs = list(match_slugs or [])
    create_slug = str(create_fields.get("slug") or tmpl).strip()
    if create_slug and create_slug not in slugs:
        slugs.insert(0, create_slug)

    agent = await _find_managed_agent(
        session,
        tenant.id,
        managed_origin=origin,
        managed_ref=ref,
        template_slug=tmpl,
        match_slugs=slugs,
    )

    if agent is None:
        fields = dict(create_fields)
        fields.setdefault("slug", create_slug or tmpl)
        fields.setdefault("kind", "company")
        fields.setdefault("is_active", True)
        fields.setdefault("runtime_status", "standby")
        agent = Agent(tenant_id=tenant.id, name=str(fields.get("name") or tmpl))
        stamp_provenance(
            agent,
            managed_origin=origin,
            managed_ref=ref,
            template_slug=tmpl,
            origin_label=label,
        )
        _apply_fields(agent, fields)
        agent.kind = "company"
        agent.is_active = True
        session.add(agent)
        await session.flush()
        return EnsureResult(agent=agent, action="created")

    # Legacy row matched by slug: stamp provenance so archive stays managed.
    stamp_provenance(
        agent,
        managed_origin=origin,
        managed_ref=ref,
        template_slug=tmpl,
        origin_label=label or origin_label(agent),
    )

    if _is_archived(agent):
        pending = await _pending_restore(session, tenant.id, agent.id)
        if pending:
            session.add(agent)
            await session.flush()
            return EnsureResult(agent=agent, action="restore_pending", change=pending)
        rejected = await _recent_rejected_restore(session, tenant.id, agent.id)
        if rejected:
            session.add(agent)
            await session.flush()
            return EnsureResult(agent=agent, action="restore_cooldown", change=rejected)
        change = await _propose_restore(
            session, tenant, agent, origin_label_text=label
        )
        return EnsureResult(agent=agent, action="restore_proposed", change=change)

    _apply_fields(agent, patch_fields or create_fields)
    # Active path: never flip kind/is_active via patch accidentally.
    agent.kind = "company"
    agent.is_active = True
    session.add(agent)
    await session.flush()
    return EnsureResult(agent=agent, action="patched")
