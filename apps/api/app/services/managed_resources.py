"""Pack/stack agent reconcile: create and patch without silent un-archive.

Callers identify agents by slug. Module affiliation lives on origin department
/ ModuleAgent / department membership. When an operator archives a pack agent,
reconcile proposes a PlatformChange (Decision) instead of reactivating.
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
from app.services.agent_rules import parse_autonomy_level

PACK_KINDS = frozenset({"platform", "module", "stack", "user"})
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


def origin_label(agent: Agent) -> str:
    stored = _settings(agent).get("origin_label")
    if isinstance(stored, str) and stored.strip():
        return stored.strip()
    return ""


def empty_affiliation() -> dict[str, Any]:
    return {
        "affiliated": False,
        "affiliation_kind": None,
        "affiliation_label": None,
        "module_slug": None,
        "module_name": None,
        "department_id": None,
        "department_name": None,
    }


def management_payload(
    agent: Agent, *, affiliation: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Module/department (or stack) place for Agents UI."""
    del agent  # identity comes from affiliation / settings only
    aff = dict(affiliation or empty_affiliation())
    affiliated = bool(aff.get("affiliated"))
    label = (aff.get("affiliation_label") or "").strip() or None
    return {
        "affiliated": affiliated,
        "affiliation_kind": aff.get("affiliation_kind"),
        "affiliation_label": label,
        "module_slug": aff.get("module_slug"),
        "module_name": aff.get("module_name"),
        "department_id": aff.get("department_id"),
        "department_name": aff.get("department_name"),
        # Short aliases still used by some clients.
        "managed": affiliated,
        "origin_label": label,
    }


async def affiliations_by_agent_id(
    session: AsyncSession,
    tenant_id: UUID,
    agents: list[Agent],
) -> dict[UUID, dict[str, Any]]:
    """Resolve module / department place for pack agents (batch)."""
    from app.models.module_agent import ModuleAgent
    from app.models.team import Department
    from app.modules.catalog import MODULE_BY_SLUG

    out: dict[UUID, dict[str, Any]] = {agent.id: empty_affiliation() for agent in agents}
    if not agents:
        return out

    agent_ids = [agent.id for agent in agents]
    roster_rows = list(
        (
            await session.execute(
                select(ModuleAgent).where(
                    ModuleAgent.tenant_id == tenant_id,
                    ModuleAgent.agent_id.in_(agent_ids),
                )
            )
        ).scalars().all()
    )
    roster_by_agent: dict[UUID, ModuleAgent] = {}
    for row in sorted(roster_rows, key=lambda r: (not r.is_default, r.created_at or datetime.min)):
        roster_by_agent.setdefault(row.agent_id, row)

    slug_hint: dict[UUID, str] = {}
    for agent in agents:
        slug = (agent.slug or "").strip()
        if slug.startswith("module-") and len(slug) > 7:
            slug_hint[agent.id] = slug[7:]

    module_slugs = {
        *(row.module_slug for row in roster_by_agent.values()),
        *slug_hint.values(),
    }
    origin_depts: dict[str, Department] = {}
    if module_slugs:
        for row in (
            await session.execute(
                select(Department).where(
                    Department.tenant_id == tenant_id,
                    Department.origin_module_slug.in_(sorted(module_slugs)),
                    Department.deleted_at.is_(None),
                )
            )
        ).scalars().all():
            if row.origin_module_slug:
                origin_depts[row.origin_module_slug] = row

    for agent in agents:
        module_slug = None
        roster = roster_by_agent.get(agent.id)
        if roster is not None:
            module_slug = roster.module_slug
        elif agent.id in slug_hint:
            module_slug = slug_hint[agent.id]

        if module_slug:
            module = MODULE_BY_SLUG.get(module_slug)
            module_name = module.name if module else module_slug.replace("-", " ").title()
            department = origin_depts.get(module_slug)
            department_id = department.id if department else None
            department_name = department.name if department else None
            label = department_name or module_name
            out[agent.id] = {
                "affiliated": True,
                "affiliation_kind": "module",
                "affiliation_label": label,
                "module_slug": module_slug,
                "module_name": module_name,
                "department_id": str(department_id) if department_id else None,
                "department_name": department_name,
            }
            continue

        # Stack packs (e.g. Trading) use settings origin_label without a module roster.
        label = origin_label(agent)
        if label:
            out[agent.id] = {
                "affiliated": True,
                "affiliation_kind": "stack",
                "affiliation_label": label,
                "module_slug": None,
                "module_name": None,
                "department_id": None,
                "department_name": None,
            }
    return out


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
    stored["origin_label"] = label.strip()
    agent.settings_json = json.dumps(stored)


def _is_archived(agent: Agent) -> bool:
    return agent.kind == "archived" or not agent.is_active


def _apply_fields(agent: Agent, fields: dict[str, Any]) -> None:
    """Patch pack-owned columns. Never un-archives."""
    for key in (
        "name",
        "role",
        "slug",
        "model",
        "provider",
        "job_title",
        "description",
        "system_prompt",
        "chat_access",
        "autonomy_level",
        "runtime_status",
        "parent_agent_id",
        "effort",
        "max_tokens",
        "max_loops",
        "max_cost_cents",
    ):
        if key in fields and fields[key] is not None:
            value = fields[key]
            if key == "autonomy_level":
                value = parse_autonomy_level(value)
            if key == "effort":
                from app.services.agent.effort_policy import normalize_effort

                value = normalize_effort(value)
            setattr(agent, key, value)
    if "tools" in fields:
        agent.tools_json = json.dumps(fields["tools"] or [])
    if "tools_json" in fields and isinstance(fields["tools_json"], str):
        agent.tools_json = fields["tools_json"]
    if "permission_scopes" in fields:
        agent.permission_scopes_json = json.dumps(fields["permission_scopes"] or [])
    agent.updated_at = datetime.utcnow()


async def _find_pack_agent(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    match_slugs: list[str],
) -> Agent | None:
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
        f"Restore pack agent “{agent.name}” from {label}. "
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
    """Create, patch, or propose restore for a pack/stack agent.

    Identity is the agent slug (``match_slugs`` / create slug). ``managed_origin`` /
    ``managed_ref`` / ``template_slug`` are pack labels for display only — they are
    not stored on the agent row. Never silently un-archives.
    """
    origin = (managed_origin or "").strip()
    ref = (managed_ref or "").strip()
    tmpl = (template_slug or "").strip()
    if origin and origin not in PACK_KINDS:
        raise ValueError(f"invalid pack kind: {managed_origin!r}")
    if not tmpl and not (match_slugs or create_fields.get("slug")):
        raise ValueError("template_slug or match_slugs / create slug is required")

    label = (display_label or "").strip() or _ORIGIN_LABELS.get((origin, ref), "")
    slugs = list(match_slugs or [])
    create_slug = str(create_fields.get("slug") or tmpl).strip()
    if create_slug and create_slug not in slugs:
        slugs.insert(0, create_slug)

    agent = await _find_pack_agent(session, tenant.id, match_slugs=slugs)

    if agent is None:
        from app.services.workforce_runtime import assert_unique_agent_name

        fields = dict(create_fields)
        fields.setdefault("slug", create_slug or tmpl)
        fields.setdefault("kind", "company")
        fields.setdefault("is_active", True)
        fields.setdefault("runtime_status", "standby")
        wanted_name = await assert_unique_agent_name(
            session, tenant.id, str(fields.get("name") or tmpl or "Agent")
        )
        fields["name"] = wanted_name
        agent = Agent(tenant_id=tenant.id, name=wanted_name)
        if label:
            _set_origin_label(agent, label)
        _apply_fields(agent, fields)
        if not (agent.job_title or "").strip():
            agent.job_title = (agent.name or "Agent").strip()[:20]
        agent.kind = "company"
        agent.is_active = True
        session.add(agent)
        await session.flush()
        return EnsureResult(agent=agent, action="created")

    if label and not origin_label(agent):
        _set_origin_label(agent, label)

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

    # ``patch_fields is None`` = create-once callers (module hire): leave active
    # agents untouched. Explicit dict (even empty) still applies.
    if patch_fields is None:
        session.add(agent)
        await session.flush()
        return EnsureResult(agent=agent, action="exists")

    _apply_fields(agent, patch_fields)
    agent.kind = "company"
    agent.is_active = True
    session.add(agent)
    await session.flush()
    return EnsureResult(agent=agent, action="patched")
