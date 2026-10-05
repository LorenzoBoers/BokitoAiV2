"""Workspace Bin: tombstones + trash_entries, restore, and hard purge."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Tenant
from app.models.trash import RESOURCE_TYPES, TrashEntry
from app.services.audit import record_audit

TRASH_RETENTION_MIN = 1
TRASH_RETENTION_MAX = 365

# Operator word / leftover audit nouns → Bin resource_type.
RESOURCE_TYPE_ALIASES = {
    "signal": "conversation",
    "thread": "conversation",
    "gesprek": "conversation",
    "chat": "conversation",
    "workspace_doc": "knowledge",
    "doc": "knowledge",
    "workstream": "playbook",
    "draaiboek": "playbook",
    "signal_type": "case_type",
    "organization": "company",
    "organisation": "company",
}


def canonical_resource_type(raw: str | None) -> str | None:
    key = (raw or "").strip().lower().replace("-", "_")
    if not key:
        return None
    return RESOURCE_TYPE_ALIASES.get(key, key)


def alive(model: type) -> Any:
    """SQL filter: live rows only. Omitting this is an IDOR into the Bin."""
    return model.deleted_at.is_(None)


async def load_tenant(session: AsyncSession, tenant_id: UUID) -> Tenant:
    row = (await session.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return row


def trash_settings_from_tenant(tenant: Tenant | None) -> dict[str, Any]:
    raw: dict[str, Any] = {}
    if tenant is not None:
        try:
            blob = json.loads(tenant.settings_json or "{}")
        except (json.JSONDecodeError, TypeError):
            blob = {}
        if isinstance(blob, dict):
            nested = blob.get("trash")
            if isinstance(nested, dict):
                raw = nested
    env_days = int(get_settings().bokito_trash_retention_days or 60)
    source = "env"
    days = env_days
    if raw.get("retention_days") is not None:
        try:
            days = int(raw["retention_days"])
            source = "tenant"
        except (TypeError, ValueError):
            days = env_days
            source = "env"
    days = max(TRASH_RETENTION_MIN, min(TRASH_RETENTION_MAX, days))
    return {
        "retention_days": days,
        "effective_days": days,
        "source": source,
        "env_days": env_days,
    }


def merge_trash_settings(tenant: Tenant, updates: dict[str, Any]) -> dict[str, Any]:
    try:
        blob = json.loads(tenant.settings_json or "{}")
    except (json.JSONDecodeError, TypeError):
        blob = {}
    if not isinstance(blob, dict):
        blob = {}
    trash = blob.get("trash") if isinstance(blob.get("trash"), dict) else {}
    if "retention_days" in updates and updates["retention_days"] is not None:
        trash["retention_days"] = max(
            TRASH_RETENTION_MIN, min(TRASH_RETENTION_MAX, int(updates["retention_days"]))
        )
    blob["trash"] = trash
    tenant.settings_json = json.dumps(blob)
    return trash_settings_from_tenant(tenant)


def _title_of(row: Any, resource_type: str) -> str:
    for attr in ("name", "title", "subject", "display_name", "label", "path"):
        value = getattr(row, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()[:240]
    if resource_type == "contact":
        return (getattr(row, "address", None) or "Contact")[:240]
    return resource_type


def _preview_of(row: Any) -> str:
    for attr in ("description", "preview", "notes", "body_text", "address"):
        value = getattr(row, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()[:400]
    return ""


def stamp_row(
    row: Any,
    *,
    user_id: UUID | None,
    batch_id: UUID,
    now: datetime,
) -> None:
    row.deleted_at = now
    row.deleted_by_user_id = user_id
    row.trash_batch_id = batch_id
    if hasattr(row, "enabled") and getattr(row, "deleted_at", None) is not None:
        if hasattr(row, "trash_was_enabled"):
            row.trash_was_enabled = bool(getattr(row, "enabled", True))
        if getattr(row, "enabled", None) is True:
            row.enabled = False
    if hasattr(row, "updated_at"):
        row.updated_at = now


def unstamp_row(row: Any) -> None:
    row.deleted_at = None
    row.deleted_by_user_id = None
    row.trash_batch_id = None
    if hasattr(row, "trash_was_enabled") and getattr(row, "trash_was_enabled", None) is not None:
        row.enabled = bool(row.trash_was_enabled)
        row.trash_was_enabled = None
    if hasattr(row, "updated_at"):
        row.updated_at = datetime.utcnow()


async def _entry_for_resource(
    session: AsyncSession, tenant_id: UUID, resource_type: str, resource_id: UUID
) -> TrashEntry | None:
    return (
        await session.execute(
            select(TrashEntry).where(
                TrashEntry.tenant_id == tenant_id,
                TrashEntry.resource_type == resource_type,
                TrashEntry.resource_id == resource_id,
            )
        )
    ).scalar_one_or_none()


async def add_entry(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    resource_type: str,
    resource_id: UUID,
    title: str,
    preview: str = "",
    user_id: UUID | None,
    batch_id: UUID,
    now: datetime,
    purge_after: datetime,
    parent_entry_id: UUID | None = None,
    restore_hint: dict[str, Any] | None = None,
) -> TrashEntry:
    existing = await _entry_for_resource(session, tenant_id, resource_type, resource_id)
    if existing:
        return existing
    entry = TrashEntry(
        tenant_id=tenant_id,
        resource_type=resource_type,
        resource_id=resource_id,
        title=title[:240],
        preview=(preview or "")[:400],
        deleted_at=now,
        purge_after=purge_after,
        deleted_by_user_id=user_id,
        batch_id=batch_id,
        parent_entry_id=parent_entry_id,
        restore_hint_json=json.dumps(restore_hint or {}),
    )
    session.add(entry)
    await session.flush()
    return entry


async def move_to_bin(
    session: AsyncSession,
    tenant: Tenant,
    *,
    resource_type: str,
    row: Any,
    user_id: UUID | None,
    title: str | None = None,
    preview: str | None = None,
    children: list[tuple[str, Any]] | None = None,
    parent_entry_id: UUID | None = None,
    commit: bool = True,
    reason: str = "operator",
) -> TrashEntry:
    if resource_type not in RESOURCE_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown trash type: {resource_type}")
    if getattr(row, "deleted_at", None) is not None:
        existing = await _entry_for_resource(session, tenant.id, resource_type, row.id)
        if existing:
            return existing
    now = datetime.utcnow()
    ttl = trash_settings_from_tenant(tenant)["effective_days"]
    purge_after = now + timedelta(days=ttl)
    batch_id = uuid4()
    stamp_row(row, user_id=user_id, batch_id=batch_id, now=now)
    session.add(row)
    entry = await add_entry(
        session,
        tenant.id,
        resource_type=resource_type,
        resource_id=row.id,
        title=title or _title_of(row, resource_type),
        preview=preview if preview is not None else _preview_of(row),
        user_id=user_id,
        batch_id=batch_id,
        now=now,
        purge_after=purge_after,
        parent_entry_id=parent_entry_id,
    )
    for child_type, child in children or []:
        stamp_row(child, user_id=user_id, batch_id=batch_id, now=now)
        session.add(child)
        await add_entry(
            session,
            tenant.id,
            resource_type=child_type,
            resource_id=child.id,
            title=_title_of(child, child_type),
            preview=_preview_of(child),
            user_id=user_id,
            batch_id=batch_id,
            now=now,
            purge_after=purge_after,
            parent_entry_id=entry.id,
        )
    await record_audit(
        session,
        tenant.id,
        action="trash:deleted",
        actor_type="user" if user_id else "system",
        actor_id=user_id or "",
        resource_type=resource_type,
        resource_id=row.id,
        summary=(title or _title_of(row, resource_type))[:120],
        payload={"reason": reason, "batch_id": str(batch_id)},
        commit=False,
    )
    if commit:
        await session.commit()
        await session.refresh(entry)
    return entry


def serialize_entry(entry: TrashEntry, *, deleted_by_name: str | None = None) -> dict[str, Any]:
    try:
        hint = json.loads(entry.restore_hint_json or "{}")
    except (json.JSONDecodeError, TypeError):
        hint = {}
    return {
        "id": str(entry.id),
        "resource_type": entry.resource_type,
        "resource_id": str(entry.resource_id),
        "title": entry.title,
        "preview": entry.preview,
        "deleted_at": entry.deleted_at.isoformat() if entry.deleted_at else None,
        "purge_after": entry.purge_after.isoformat() if entry.purge_after else None,
        "deleted_by_user_id": str(entry.deleted_by_user_id) if entry.deleted_by_user_id else None,
        "deleted_by_name": deleted_by_name,
        "batch_id": str(entry.batch_id),
        "parent_entry_id": str(entry.parent_entry_id) if entry.parent_entry_id else None,
        "restore_hint": hint if isinstance(hint, dict) else {},
    }


async def _names_for_users(session: AsyncSession, user_ids: list[UUID]) -> dict[UUID, str]:
    ids = [uid for uid in user_ids if uid]
    if not ids:
        return {}
    from app.models.auth import User

    rows = list((await session.execute(select(User).where(User.id.in_(ids)))).scalars().all())
    out: dict[UUID, str] = {}
    for user in rows:
        name = (user.display_name or "").strip() or (user.email or "").strip()
        if name:
            out[user.id] = name
    return out


async def get_entry(session: AsyncSession, tenant_id: UUID, entry_id: UUID) -> TrashEntry:
    row = (
        await session.execute(
            select(TrashEntry).where(TrashEntry.id == entry_id, TrashEntry.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Bin item not found")
    return row


async def list_entries(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    resource_type: str | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
    roots_only: bool = True,
) -> dict[str, Any]:
    stmt = select(TrashEntry).where(TrashEntry.tenant_id == tenant_id)
    if roots_only:
        stmt = stmt.where(TrashEntry.parent_entry_id.is_(None))
    type_key = canonical_resource_type(resource_type)
    if type_key:
        if type_key not in RESOURCE_TYPES:
            return {
                "items": [],
                "next_offset": None,
                "error": f"Unknown Bin type '{resource_type}'",
                "allowed_types": list(RESOURCE_TYPES),
            }
        stmt = stmt.where(TrashEntry.resource_type == type_key)
    if q and q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            TrashEntry.title.ilike(needle) | TrashEntry.preview.ilike(needle)
        )
    stmt = stmt.order_by(TrashEntry.deleted_at.desc()).offset(offset).limit(limit + 1)
    rows = list((await session.execute(stmt)).scalars().all())
    has_more = len(rows) > limit
    rows = rows[:limit]
    names = await _names_for_users(session, [r.deleted_by_user_id for r in rows if r.deleted_by_user_id])
    return {
        "items": [
            serialize_entry(r, deleted_by_name=names.get(r.deleted_by_user_id) if r.deleted_by_user_id else None)
            for r in rows
        ],
        "next_offset": offset + limit if has_more else None,
    }


async def _load_live_row(
    session: AsyncSession, tenant_id: UUID, resource_type: str, resource_id: UUID
) -> Any | None:
    model = _MODEL_FOR_TYPE.get(resource_type)
    if model is None:
        return None
    return (
        await session.execute(
            select(model).where(model.id == resource_id, model.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()


async def _unique_slug(
    session: AsyncSession,
    model: type,
    tenant_id: UUID,
    field: str,
    desired: str,
    extra: list[Any] | None = None,
) -> str:
    base = (desired or "item").strip() or "item"
    candidate = base
    n = 0
    while True:
        conds = [model.tenant_id == tenant_id, getattr(model, field) == candidate, alive(model)]
        if extra:
            conds.extend(extra)
        found = (
            await session.execute(select(model.id).where(*conds).limit(1))
        ).scalar_one_or_none()
        if found is None:
            return candidate
        n += 1
        suffix = "-restored" if n == 1 else f"-{n}"
        candidate = f"{base}{suffix}"[:120]


async def restore_entry(
    session: AsyncSession,
    tenant: Tenant,
    entry: TrashEntry,
    *,
    user_id: UUID | None,
    reason: str = "operator",
    commit: bool = True,
) -> dict[str, Any]:
    if entry.parent_entry_id is not None:
        parent = (
            await session.execute(
                select(TrashEntry).where(
                    TrashEntry.id == entry.parent_entry_id,
                    TrashEntry.tenant_id == tenant.id,
                )
            )
        ).scalar_one_or_none()
        if parent is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Restore the parent item first.",
                    "parent_entry_id": str(parent.id),
                    "parent_title": parent.title,
                    "parent_type": parent.resource_type,
                },
            )
    batch_rows = list(
        (
            await session.execute(
                select(TrashEntry).where(
                    TrashEntry.tenant_id == tenant.id,
                    TrashEntry.batch_id == entry.batch_id,
                )
            )
        ).scalars().all()
    )
    hint: dict[str, Any] = {}
    for item in batch_rows:
        row = await _load_live_row(session, tenant.id, item.resource_type, item.resource_id)
        if row is None:
            continue
        if item.resource_type == "project" and getattr(row, "slug", None):
            from app.models.project import Project

            new_slug = await _unique_slug(session, Project, tenant.id, "slug", row.slug)
            if new_slug != row.slug:
                hint["slug"] = new_slug
                row.slug = new_slug
        if item.resource_type == "canvas":
            from app.models.project_canvas import ProjectCanvas

            new_slug = await _unique_slug(
                session,
                ProjectCanvas,
                tenant.id,
                "slug",
                row.slug,
                extra=[
                    ProjectCanvas.owner_kind == row.owner_kind,
                    ProjectCanvas.owner_id == row.owner_id,
                ],
            )
            if new_slug != row.slug:
                hint["slug"] = new_slug
                row.slug = new_slug
        if item.resource_type == "knowledge" and getattr(row, "path", None):
            from app.models.workspace import WorkspaceDoc

            new_path = await _unique_slug(session, WorkspaceDoc, tenant.id, "path", row.path)
            if new_path != row.path:
                hint["path"] = new_path
                row.path = new_path
        if item.resource_type == "case_type" and getattr(row, "slug", None):
            from app.models.case import CaseType

            new_slug = await _unique_slug(session, CaseType, tenant.id, "slug", row.slug)
            if new_slug != row.slug:
                hint["slug"] = new_slug
                row.slug = new_slug
        unstamp_row(row)
        session.add(row)
        await session.delete(item)
    await record_audit(
        session,
        tenant.id,
        action="trash:restored",
        actor_type="user" if user_id else "system",
        actor_id=user_id or "",
        resource_type=entry.resource_type,
        resource_id=entry.resource_id,
        summary=(entry.title or "")[:120],
        payload={"reason": reason, "batch_id": str(entry.batch_id), **hint},
        commit=False,
    )
    payload = {**serialize_entry(entry), "restore_hint": hint}
    if commit:
        await session.commit()
    return payload


async def restore_resource_if_binned(
    session: AsyncSession,
    tenant: Tenant,
    resource_type: str,
    resource_id: UUID,
    *,
    reason: str,
) -> bool:
    entry = await _entry_for_resource(session, tenant.id, resource_type, resource_id)
    row = await _load_live_row(session, tenant.id, resource_type, resource_id)
    if row is None:
        return False
    if getattr(row, "deleted_at", None) is None and entry is None:
        return False
    if entry is None:
        unstamp_row(row)
        session.add(row)
        await record_audit(
            session,
            tenant.id,
            action="trash:restored",
            actor_type="system",
            actor_id="",
            resource_type=resource_type,
            resource_id=resource_id,
            summary=reason,
            payload={"reason": reason},
            commit=False,
        )
        return True
    await restore_entry(session, tenant, entry, user_id=None, reason=reason, commit=False)
    return True


async def purge_entry(
    session: AsyncSession,
    tenant: Tenant,
    entry: TrashEntry,
    *,
    user_id: UUID | None,
    commit: bool = True,
) -> dict[str, Any]:
    batch_rows = list(
        (
            await session.execute(
                select(TrashEntry).where(
                    TrashEntry.tenant_id == tenant.id,
                    TrashEntry.batch_id == entry.batch_id,
                )
            )
        ).scalars().all()
    )
    ordered = sorted(batch_rows, key=lambda r: (r.parent_entry_id is None, str(r.id)))
    for item in ordered:
        await _hard_delete_resource(
            session, tenant.id, item.resource_type, item.resource_id
        )
        await session.delete(item)
    await record_audit(
        session,
        tenant.id,
        action="trash:purged",
        actor_type="user" if user_id else "system",
        actor_id=user_id or "",
        resource_type=entry.resource_type,
        resource_id=entry.resource_id,
        summary=(entry.title or "")[:120],
        payload={"batch_id": str(entry.batch_id)},
        commit=False,
    )
    if commit:
        await session.commit()
    return {"ok": True}


async def empty_bin(
    session: AsyncSession, tenant: Tenant, *, user_id: UUID | None
) -> dict[str, int]:
    rows = list(
        (
            await session.execute(
                select(TrashEntry).where(
                    TrashEntry.tenant_id == tenant.id,
                    TrashEntry.parent_entry_id.is_(None),
                )
            )
        ).scalars().all()
    )
    count = 0
    for row in rows:
        await purge_entry(session, tenant, row, user_id=user_id, commit=False)
        count += 1
    await session.commit()
    return {"purged": count}


async def purge_expired_trash(session: AsyncSession, tenant: Tenant) -> int:
    now = datetime.utcnow()
    rows = list(
        (
            await session.execute(
                select(TrashEntry).where(
                    TrashEntry.tenant_id == tenant.id,
                    TrashEntry.parent_entry_id.is_(None),
                    TrashEntry.purge_after <= now,
                )
            )
        ).scalars().all()
    )
    for row in rows:
        await purge_entry(session, tenant, row, user_id=None, commit=False)
    if rows:
        await session.commit()
    return len(rows)


async def purge_matching_for_subject(
    session: AsyncSession,
    tenant: Tenant,
    *,
    resource_ids: list[tuple[str, UUID]],
) -> int:
    count = 0
    for rtype, rid in resource_ids:
        entry = await _entry_for_resource(session, tenant.id, rtype, rid)
        if entry is None:
            continue
        await purge_entry(session, tenant, entry, user_id=None, commit=False)
        count += 1
    return count


async def _hard_delete_resource(
    session: AsyncSession, tenant_id: UUID, resource_type: str, resource_id: UUID
) -> None:
    handler = _PURGE_HANDLERS.get(resource_type)
    if handler is None:
        return
    await handler(session, tenant_id, resource_id)


async def _purge_conversation(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.services.signal_threads import delete_thread

    await delete_thread(session, tenant_id, resource_id, permanent=True, commit=False)


async def _purge_contact(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.models.channel import Contact
    from app.models.signal import Signal
    from sqlalchemy import update

    contact = (
        await session.execute(
            select(Contact).where(Contact.id == resource_id, Contact.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if contact is None:
        return
    await session.execute(
        update(Signal)
        .where(Signal.tenant_id == tenant_id, Signal.contact_id == resource_id)
        .values(contact_id=None)
    )
    await session.delete(contact)


async def _purge_company(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.models.channel import Company, Contact
    from sqlalchemy import update

    company = (
        await session.execute(
            select(Company).where(Company.id == resource_id, Company.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if company is None:
        return
    await session.execute(
        update(Contact)
        .where(Contact.tenant_id == tenant_id, Contact.company_id == resource_id)
        .values(company_id=None)
    )
    await session.delete(company)


async def _purge_project(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.services.projects import delete_project

    row = await _load_live_row(session, tenant_id, "project", resource_id)
    if row is None:
        return
    await delete_project(session, tenant_id, resource_id, row.name, permanent=True, commit=False)


async def _purge_canvas(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.services.project_canvas import delete_canvas

    await delete_canvas(session, tenant_id, resource_id, permanent=True, commit=False)


async def _purge_knowledge(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.services.workspace import delete_doc

    await delete_doc(session, tenant_id, resource_id, permanent=True, commit=False)


async def _purge_playbook(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.services.workstreams import delete_workstream

    await delete_workstream(session, tenant_id, resource_id, permanent=True)


async def _purge_trigger(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.models.trigger import Trigger

    row = (
        await session.execute(
            select(Trigger).where(Trigger.id == resource_id, Trigger.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is not None:
        await session.delete(row)


async def _purge_team(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.models.team import Team
    from app.services.teams import delete_team

    team = (
        await session.execute(
            select(Team).where(Team.id == resource_id, Team.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if team is None:
        return
    await delete_team(session, team, permanent=True)


async def _purge_inbox_rule(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.models.learning import InboxRule

    row = (
        await session.execute(
            select(InboxRule).where(InboxRule.id == resource_id, InboxRule.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is not None:
        await session.delete(row)


async def _purge_saved_reply(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.models.signal import SavedReply

    row = (
        await session.execute(
            select(SavedReply).where(SavedReply.id == resource_id, SavedReply.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is not None:
        await session.delete(row)


async def _purge_case_type(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.services.cases import delete_case_type

    await delete_case_type(session, tenant_id, resource_id, permanent=True, commit=False)


async def _purge_project_resource(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.models.project_work import ProjectResource

    row = (
        await session.execute(
            select(ProjectResource).where(
                ProjectResource.id == resource_id, ProjectResource.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        await session.delete(row)


async def _purge_queue_item(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    from app.models.orchestration import AgentTask

    row = (
        await session.execute(
            select(AgentTask).where(AgentTask.id == resource_id, AgentTask.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is not None:
        await session.delete(row)


_PURGE_HANDLERS = {
    "conversation": _purge_conversation,
    "contact": _purge_contact,
    "company": _purge_company,
    "project": _purge_project,
    "canvas": _purge_canvas,
    "knowledge": _purge_knowledge,
    "playbook": _purge_playbook,
    "trigger": _purge_trigger,
    "team": _purge_team,
    "inbox_rule": _purge_inbox_rule,
    "saved_reply": _purge_saved_reply,
    "case_type": _purge_case_type,
    "project_resource": _purge_project_resource,
    "queue_item": _purge_queue_item,
}


def _bind_models() -> dict[str, type]:
    from app.models.case import CaseType
    from app.models.channel import Company, Contact
    from app.models.learning import InboxRule
    from app.models.orchestra import Workstream
    from app.models.orchestration import AgentTask
    from app.models.project import Project
    from app.models.project_canvas import ProjectCanvas
    from app.models.project_work import ProjectResource
    from app.models.signal import SavedReply, Signal
    from app.models.team import Team
    from app.models.trigger import Trigger
    from app.models.workspace import WorkspaceDoc

    return {
        "conversation": Signal,
        "contact": Contact,
        "company": Company,
        "project": Project,
        "canvas": ProjectCanvas,
        "knowledge": WorkspaceDoc,
        "playbook": Workstream,
        "trigger": Trigger,
        "team": Team,
        "inbox_rule": InboxRule,
        "saved_reply": SavedReply,
        "case_type": CaseType,
        "project_resource": ProjectResource,
        "queue_item": AgentTask,
    }


_MODEL_FOR_TYPE = _bind_models()
