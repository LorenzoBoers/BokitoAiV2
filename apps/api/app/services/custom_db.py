"""Custom database service (tables, fields, records, views)."""

import csv
import io
import json
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership, User
from app.models.custom_db import (
    CustomField,
    CustomRecord,
    CustomRecordActivity,
    CustomRecordComment,
    CustomTable,
    CustomView,
)
from app.services.workforce_runtime import tenant_numeric_id

STANDARD_SLUGS = ("klanten", "berichten", "taken")


def _slugify(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return base or "table"


def _parse_json(raw: str | None, default: Any) -> Any:
    try:
        return json.loads(raw or "")
    except json.JSONDecodeError:
        return default


def _iso(value: datetime | None) -> str:
    return value.isoformat() if value else datetime.utcnow().isoformat()


def serialize_table(row: CustomTable) -> dict[str, Any]:
    return {
        "id": row.id,
        "organisation_id": row.organisation_id,
        "name": row.name,
        "slug": row.slug,
        "description": row.description or "",
        "icon": row.icon or "Database",
        "color": row.color or "#3b82f6",
        "is_standard": row.is_standard,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "magic_table_config": _parse_json(row.magic_table_config_json, {}),
    }


def serialize_field(row: CustomField) -> dict[str, Any]:
    default_value = _parse_json(row.default_value_json, None)
    return {
        "id": row.id,
        "custom_table_id": row.custom_table_id,
        "name": row.name,
        "slug": row.slug,
        "field_type": row.field_type,
        "config": _parse_json(row.config_json, {}),
        "required": row.required,
        "position": row.position,
        "default_value": default_value if default_value is not None else None,
        "created_at": _iso(row.created_at),
        "is_system": row.is_system,
    }


def serialize_record(row: CustomRecord) -> dict[str, Any]:
    return {
        "id": row.id,
        "custom_table_id": row.custom_table_id,
        "data": _parse_json(row.data_json, {}),
        "is_deleted": row.is_deleted,
        "deleted_at": _iso(row.deleted_at) if row.deleted_at else None,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "owner_id": row.owner_id,
    }


def serialize_view(row: CustomView) -> dict[str, Any]:
    return {
        "id": row.id,
        "custom_table_id": row.custom_table_id,
        "name": row.name,
        "view_type": row.view_type,
        "config": _parse_json(row.config_json, {}),
        "position": row.position,
        "created_at": _iso(row.created_at),
    }


def paginate(items: list[Any], page: int, per_page: int) -> dict[str, Any]:
    total = len(items)
    start = max(0, (page - 1) * per_page)
    end = start + per_page
    page_items = items[start:end]
    return {
        "items": page_items,
        "curPage": page,
        "nextPage": page + 1 if end < total else None,
        "prevPage": page - 1 if page > 1 else None,
        "itemsReceived": len(page_items),
        "itemsTotal": total,
    }


async def get_table(session: AsyncSession, tenant_id: UUID, table_id: int) -> CustomTable:
    result = await session.execute(
        select(CustomTable).where(CustomTable.id == table_id, CustomTable.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Table not found")
    return row


async def list_tables(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(CustomTable)
        .where(CustomTable.tenant_id == tenant_id, CustomTable.is_standard.is_(False))
        .order_by(CustomTable.name)
    )
    return [serialize_table(t) for t in result.scalars().all()]


async def list_standard_tables(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(CustomTable)
        .where(CustomTable.tenant_id == tenant_id, CustomTable.is_standard.is_(True))
        .order_by(CustomTable.slug)
    )
    return [serialize_table(t) for t in result.scalars().all()]


async def create_table(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str,
    description: str = "",
    icon: str = "Database",
    color: str = "#3b82f6",
) -> dict[str, Any]:
    org_id = tenant_numeric_id(tenant_id)
    slug = _slugify(name)
    existing = await session.execute(
        select(CustomTable).where(CustomTable.tenant_id == tenant_id, CustomTable.slug == slug)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Table slug already exists")
    now = datetime.utcnow()
    row = CustomTable(
        tenant_id=tenant_id,
        organisation_id=org_id,
        name=name.strip(),
        slug=slug,
        description=description,
        icon=icon,
        color=color,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    session.add(
        CustomView(
            tenant_id=tenant_id,
            custom_table_id=row.id,
            name="Grid",
            view_type="grid",
            config_json="{}",
            position=0,
        )
    )
    await session.commit()
    await session.refresh(row)
    return serialize_table(row)


async def update_table(
    session: AsyncSession,
    tenant_id: UUID,
    table_id: int,
    patch: dict[str, Any],
) -> dict[str, Any]:
    row = await get_table(session, tenant_id, table_id)
    for key in ("name", "description", "icon", "color"):
        if key in patch and patch[key] is not None:
            setattr(row, key, patch[key])
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_table(row)


async def delete_table(session: AsyncSession, tenant_id: UUID, table_id: int) -> dict[str, bool]:
    row = await get_table(session, tenant_id, table_id)
    if row.is_standard:
        raise HTTPException(status_code=400, detail="Cannot delete standard table")
    records = await session.execute(
        select(CustomRecord).where(CustomRecord.custom_table_id == table_id)
    )
    for rec in records.scalars().all():
        await session.delete(rec)
    fields = await session.execute(select(CustomField).where(CustomField.custom_table_id == table_id))
    for field in fields.scalars().all():
        await session.delete(field)
    views = await session.execute(select(CustomView).where(CustomView.custom_table_id == table_id))
    for view in views.scalars().all():
        await session.delete(view)
    await session.delete(row)
    await session.commit()
    return {"success": True}


async def list_fields(session: AsyncSession, tenant_id: UUID, table_id: int) -> list[dict[str, Any]]:
    await get_table(session, tenant_id, table_id)
    result = await session.execute(
        select(CustomField)
        .where(CustomField.custom_table_id == table_id, CustomField.tenant_id == tenant_id)
        .order_by(CustomField.position, CustomField.id)
    )
    return [serialize_field(f) for f in result.scalars().all()]


async def create_field(
    session: AsyncSession,
    tenant_id: UUID,
    table_id: int,
    data: dict[str, Any],
) -> dict[str, Any]:
    await get_table(session, tenant_id, table_id)
    slug = _slugify(data.get("slug") or data["name"])
    row = CustomField(
        tenant_id=tenant_id,
        custom_table_id=table_id,
        name=data["name"].strip(),
        slug=slug,
        field_type=data["field_type"],
        config_json=json.dumps(data.get("config") or {}),
        required=bool(data.get("required", False)),
        position=int(data.get("position", 0)),
        default_value_json=json.dumps(data.get("default_value")),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_field(row)


async def update_field(
    session: AsyncSession,
    tenant_id: UUID,
    field_id: int,
    patch: dict[str, Any],
) -> dict[str, Any]:
    result = await session.execute(
        select(CustomField).where(CustomField.id == field_id, CustomField.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Field not found")
    if "name" in patch and patch["name"] is not None:
        row.name = patch["name"].strip()
    if "config" in patch and patch["config"] is not None:
        row.config_json = json.dumps(patch["config"])
    if "required" in patch and patch["required"] is not None:
        row.required = bool(patch["required"])
    if "position" in patch and patch["position"] is not None:
        row.position = int(patch["position"])
    if "default_value" in patch:
        row.default_value_json = json.dumps(patch["default_value"])
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_field(row)


async def delete_field(session: AsyncSession, tenant_id: UUID, field_id: int) -> dict[str, bool]:
    result = await session.execute(
        select(CustomField).where(CustomField.id == field_id, CustomField.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Field not found")
    if row.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system field")
    await session.delete(row)
    await session.commit()
    return {"success": True}


async def _log_activity(
    session: AsyncSession,
    tenant_id: UUID,
    record_id: int,
    action: str,
    *,
    user_id: int = 0,
    user_name: str = "System",
    field_changes: list[dict[str, Any]] | None = None,
    note: str = "",
) -> None:
    session.add(
        CustomRecordActivity(
            tenant_id=tenant_id,
            record_id=record_id,
            user_id=user_id,
            user_name=user_name,
            action=action,
            field_changes_json=json.dumps(field_changes or []),
            note=note,
        )
    )


async def list_records(
    session: AsyncSession,
    tenant_id: UUID,
    table_id: int,
    *,
    page: int = 1,
    per_page: int = 50,
    include_deleted: bool = False,
) -> dict[str, Any]:
    await get_table(session, tenant_id, table_id)
    query = select(CustomRecord).where(
        CustomRecord.custom_table_id == table_id,
        CustomRecord.tenant_id == tenant_id,
    )
    if not include_deleted:
        query = query.where(CustomRecord.is_deleted.is_(False))
    query = query.order_by(CustomRecord.updated_at.desc())
    result = await session.execute(query)
    rows = [serialize_record(r) for r in result.scalars().all()]
    return paginate(rows, page, per_page)


async def search_records(
    session: AsyncSession,
    tenant_id: UUID,
    table_id: int,
    query_text: str,
    *,
    page: int = 1,
    per_page: int = 50,
) -> dict[str, Any]:
    data = await list_records(session, tenant_id, table_id, page=1, per_page=10_000)
    q = query_text.lower().strip()
    if not q:
        return paginate(data["items"], page, per_page)
    filtered = []
    for item in data["items"]:
        blob = json.dumps(item.get("data") or {}).lower()
        if q in blob:
            filtered.append(item)
    return paginate(filtered, page, per_page)


async def get_record(session: AsyncSession, tenant_id: UUID, record_id: int) -> CustomRecord:
    result = await session.execute(
        select(CustomRecord).where(CustomRecord.id == record_id, CustomRecord.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")
    return row


async def create_record(
    session: AsyncSession,
    tenant_id: UUID,
    table_id: int,
    data: dict[str, Any],
    *,
    user_id: int = 0,
    user_name: str = "System",
) -> dict[str, Any]:
    await get_table(session, tenant_id, table_id)
    now = datetime.utcnow()
    row = CustomRecord(
        tenant_id=tenant_id,
        custom_table_id=table_id,
        data_json=json.dumps(data),
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    await _log_activity(session, tenant_id, row.id, "create", user_id=user_id, user_name=user_name)
    await session.commit()
    await session.refresh(row)
    return serialize_record(row)


async def update_record(
    session: AsyncSession,
    tenant_id: UUID,
    record_id: int,
    data: dict[str, Any],
    *,
    user_id: int = 0,
    user_name: str = "System",
) -> dict[str, Any]:
    row = await get_record(session, tenant_id, record_id)
    old = _parse_json(row.data_json, {})
    row.data_json = json.dumps(data)
    row.updated_at = datetime.utcnow()
    session.add(row)
    changes = [
        {
            "field_slug": key,
            "field_name": key,
            "old_value": old.get(key),
            "new_value": data.get(key),
        }
        for key in set(old) | set(data)
        if old.get(key) != data.get(key)
    ]
    await _log_activity(
        session,
        tenant_id,
        record_id,
        "update",
        user_id=user_id,
        user_name=user_name,
        field_changes=changes,
    )
    await session.commit()
    await session.refresh(row)
    return serialize_record(row)


async def delete_record(session: AsyncSession, tenant_id: UUID, record_id: int) -> dict[str, bool]:
    row = await get_record(session, tenant_id, record_id)
    await _log_activity(session, tenant_id, record_id, "delete")
    await session.delete(row)
    await session.commit()
    return {"success": True}


async def soft_delete_record(session: AsyncSession, tenant_id: UUID, record_id: int) -> dict[str, Any]:
    row = await get_record(session, tenant_id, record_id)
    row.is_deleted = True
    row.deleted_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    session.add(row)
    await _log_activity(session, tenant_id, record_id, "delete")
    await session.commit()
    await session.refresh(row)
    return serialize_record(row)


async def restore_record(session: AsyncSession, tenant_id: UUID, record_id: int) -> dict[str, Any]:
    row = await get_record(session, tenant_id, record_id)
    row.is_deleted = False
    row.deleted_at = None
    row.updated_at = datetime.utcnow()
    session.add(row)
    await _log_activity(session, tenant_id, record_id, "restore")
    await session.commit()
    await session.refresh(row)
    return serialize_record(row)


async def duplicate_record(session: AsyncSession, tenant_id: UUID, record_id: int) -> dict[str, Any]:
    row = await get_record(session, tenant_id, record_id)
    data = _parse_json(row.data_json, {})
    return await create_record(session, tenant_id, row.custom_table_id, data)


async def bulk_update(
    session: AsyncSession,
    tenant_id: UUID,
    record_ids: list[int],
    data: dict[str, Any],
) -> dict[str, Any]:
    updated = 0
    for rid in record_ids:
        try:
            row = await get_record(session, tenant_id, rid)
            existing = _parse_json(row.data_json, {})
            existing.update(data)
            row.data_json = json.dumps(existing)
            row.updated_at = datetime.utcnow()
            session.add(row)
            updated += 1
        except HTTPException:
            continue
    await session.commit()
    return {"success": True, "updated": updated}


async def bulk_soft_delete(session: AsyncSession, tenant_id: UUID, record_ids: list[int]) -> dict[str, Any]:
    deleted = 0
    for rid in record_ids:
        try:
            await soft_delete_record(session, tenant_id, rid)
            deleted += 1
        except HTTPException:
            continue
    return {"success": True, "deleted": deleted}


async def bulk_restore(session: AsyncSession, tenant_id: UUID, record_ids: list[int]) -> dict[str, Any]:
    restored = 0
    for rid in record_ids:
        try:
            await restore_record(session, tenant_id, rid)
            restored += 1
        except HTTPException:
            continue
    return {"success": True, "restored": restored}


async def list_views(session: AsyncSession, tenant_id: UUID, table_id: int) -> list[dict[str, Any]]:
    await get_table(session, tenant_id, table_id)
    result = await session.execute(
        select(CustomView)
        .where(CustomView.custom_table_id == table_id, CustomView.tenant_id == tenant_id)
        .order_by(CustomView.position)
    )
    return [serialize_view(v) for v in result.scalars().all()]


async def create_view(session: AsyncSession, tenant_id: UUID, table_id: int, data: dict[str, Any]) -> dict[str, Any]:
    await get_table(session, tenant_id, table_id)
    row = CustomView(
        tenant_id=tenant_id,
        custom_table_id=table_id,
        name=data["name"].strip(),
        view_type=data.get("view_type") or "grid",
        config_json=json.dumps(data.get("config") or {}),
        position=int(data.get("position", 0)),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_view(row)


async def update_view(
    session: AsyncSession, tenant_id: UUID, view_id: int, patch: dict[str, Any]
) -> dict[str, Any]:
    result = await session.execute(
        select(CustomView).where(CustomView.id == view_id, CustomView.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="View not found")
    if "name" in patch and patch["name"] is not None:
        row.name = patch["name"].strip()
    if "config" in patch and patch["config"] is not None:
        row.config_json = json.dumps(patch["config"])
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_view(row)


async def delete_view(session: AsyncSession, tenant_id: UUID, view_id: int) -> dict[str, bool]:
    result = await session.execute(
        select(CustomView).where(CustomView.id == view_id, CustomView.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="View not found")
    await session.delete(row)
    await session.commit()
    return {"success": True}


async def list_activity(session: AsyncSession, tenant_id: UUID, record_id: int) -> list[dict[str, Any]]:
    await get_record(session, tenant_id, record_id)
    result = await session.execute(
        select(CustomRecordActivity)
        .where(CustomRecordActivity.record_id == record_id, CustomRecordActivity.tenant_id == tenant_id)
        .order_by(CustomRecordActivity.created_at.desc())
    )
    return [
        {
            "id": a.id,
            "record_id": a.record_id,
            "user_id": a.user_id,
            "user_name": a.user_name,
            "action": a.action,
            "field_changes": _parse_json(a.field_changes_json, []),
            "created_at": _iso(a.created_at),
            "note": a.note,
        }
        for a in result.scalars().all()
    ]


async def add_activity_note(
    session: AsyncSession, tenant_id: UUID, record_id: int, note: str, *, user_name: str = "User"
) -> dict[str, Any]:
    await get_record(session, tenant_id, record_id)
    row = CustomRecordActivity(
        tenant_id=tenant_id,
        record_id=record_id,
        user_id=0,
        user_name=user_name,
        action="note",
        note=note,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {
        "id": row.id,
        "record_id": row.record_id,
        "action": "note",
        "note": row.note,
        "created_at": _iso(row.created_at),
    }


async def list_comments(session: AsyncSession, tenant_id: UUID, record_id: int) -> list[dict[str, Any]]:
    await get_record(session, tenant_id, record_id)
    result = await session.execute(
        select(CustomRecordComment)
        .where(CustomRecordComment.record_id == record_id, CustomRecordComment.tenant_id == tenant_id)
        .order_by(CustomRecordComment.created_at)
    )
    return [
        {
            "id": c.id,
            "record_id": c.record_id,
            "user_id": c.user_id,
            "user_name": c.user_name,
            "content": c.content,
            "created_at": _iso(c.created_at),
            "updated_at": _iso(c.updated_at),
        }
        for c in result.scalars().all()
    ]


async def create_comment(
    session: AsyncSession,
    tenant_id: UUID,
    record_id: int,
    *,
    content: str,
    parent_id: int | None = None,
    user_name: str = "User",
) -> dict[str, Any]:
    await get_record(session, tenant_id, record_id)
    row = CustomRecordComment(
        tenant_id=tenant_id,
        record_id=record_id,
        content=content.strip(),
        parent_id=parent_id,
        user_name=user_name,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {
        "id": row.id,
        "record_id": row.record_id,
        "user_id": row.user_id,
        "user_name": row.user_name,
        "content": row.content,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


async def update_comment(
    session: AsyncSession, tenant_id: UUID, comment_id: int, content: str
) -> dict[str, Any]:
    result = await session.execute(
        select(CustomRecordComment).where(
            CustomRecordComment.id == comment_id,
            CustomRecordComment.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Comment not found")
    row.content = content.strip()
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {
        "id": row.id,
        "record_id": row.record_id,
        "content": row.content,
        "updated_at": _iso(row.updated_at),
    }


async def delete_comment(session: AsyncSession, tenant_id: UUID, comment_id: int) -> dict[str, bool]:
    result = await session.execute(
        select(CustomRecordComment).where(
            CustomRecordComment.id == comment_id,
            CustomRecordComment.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Comment not found")
    await session.delete(row)
    await session.commit()
    return {"success": True}


async def list_workspace_users(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.tenant_id == tenant_id)
    )
    users = []
    for user, membership in result.all():
        users.append(
            {
                "id": tenant_numeric_id(user.id),
                "name": user.display_name or user.email,
                "email": user.email,
                "role": membership.role,
            }
        )
    return users


def _standard_table_specs() -> list[dict[str, Any]]:
    customer_status = [
        {"value": "lead", "label": "Lead", "color": "#3b82f6"},
        {"value": "actief", "label": "Actief", "color": "#10b981"},
        {"value": "inactief", "label": "Inactief", "color": "#6b7280"},
        {"value": "geblokkeerd", "label": "Geblokkeerd", "color": "#ef4444"},
    ]
    return [
        {
            "name": "Klanten",
            "slug": "klanten",
            "description": "Beheer al je klanten en prospects",
            "icon": "Users",
            "color": "#3b82f6",
            "fields": [
                {"name": "Naam", "slug": "naam", "field_type": "text", "required": True, "position": 0},
                {"name": "E-mail", "slug": "email", "field_type": "email", "position": 1, "config": {"unique": True}},
                {"name": "Telefoon", "slug": "telefoon", "field_type": "phone", "position": 2},
                {"name": "Bedrijf", "slug": "bedrijf", "field_type": "text", "position": 3},
                {
                    "name": "Status",
                    "slug": "status",
                    "field_type": "select",
                    "position": 4,
                    "config": {"options": customer_status},
                },
                {"name": "Notities", "slug": "notities", "field_type": "long_text", "position": 5},
            ],
        },
        {
            "name": "Berichten",
            "slug": "berichten",
            "description": "Alle communicatie met klanten",
            "icon": "MessageSquare",
            "color": "#10b981",
            "fields": [
                {"name": "Onderwerp", "slug": "onderwerp", "field_type": "text", "required": True, "position": 0},
                {"name": "Berichttekst", "slug": "berichttekst", "field_type": "long_text", "position": 1},
                {
                    "name": "Kanaal",
                    "slug": "kanaal",
                    "field_type": "select",
                    "position": 2,
                    "config": {
                        "options": [
                            {"value": "email", "label": "Email", "color": "#3b82f6"},
                            {"value": "chat", "label": "Chat", "color": "#8b5cf6"},
                        ]
                    },
                },
                {
                    "name": "Klant",
                    "slug": "klant",
                    "field_type": "relation",
                    "required": True,
                    "position": 3,
                    "config": {"relationSlug": "klanten", "displayField": "naam"},
                },
            ],
        },
        {
            "name": "Taken",
            "slug": "taken",
            "description": "Beheer taken en to-dos",
            "icon": "CheckSquare",
            "color": "#f59e0b",
            "fields": [
                {"name": "Titel", "slug": "titel", "field_type": "text", "required": True, "position": 0},
                {"name": "Beschrijving", "slug": "beschrijving", "field_type": "long_text", "position": 1},
                {
                    "name": "Status",
                    "slug": "status",
                    "field_type": "select",
                    "position": 2,
                    "config": {
                        "options": [
                            {"value": "open", "label": "Open", "color": "#3b82f6"},
                            {"value": "klaar", "label": "Klaar", "color": "#10b981"},
                        ]
                    },
                },
                {
                    "name": "Gekoppelde klant",
                    "slug": "gekoppelde_klant",
                    "field_type": "relation",
                    "position": 3,
                    "config": {"relationSlug": "klanten", "displayField": "naam"},
                },
            ],
        },
    ]


async def create_standard_tables(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    existing = await list_standard_tables(session, tenant_id)
    if existing:
        return existing
    org_id = tenant_numeric_id(tenant_id)
    created_tables: dict[str, CustomTable] = {}
    for spec in _standard_table_specs():
        table = CustomTable(
            tenant_id=tenant_id,
            organisation_id=org_id,
            name=spec["name"],
            slug=spec["slug"],
            description=spec["description"],
            icon=spec["icon"],
            color=spec["color"],
            is_standard=True,
        )
        session.add(table)
        await session.flush()
        created_tables[spec["slug"]] = table
        session.add(
            CustomView(
                tenant_id=tenant_id,
                custom_table_id=table.id,
                name="Grid",
                view_type="grid",
                config_json="{}",
            )
        )
        for field_spec in spec["fields"]:
            config = dict(field_spec.get("config") or {})
            rel_slug = config.pop("relationSlug", None)
            if rel_slug and rel_slug in created_tables:
                config["tableId"] = created_tables[rel_slug].id
                config["displayField"] = config.get("displayField", "naam")
            session.add(
                CustomField(
                    tenant_id=tenant_id,
                    custom_table_id=table.id,
                    name=field_spec["name"],
                    slug=field_spec["slug"],
                    field_type=field_spec["field_type"],
                    config_json=json.dumps(config),
                    required=bool(field_spec.get("required", False)),
                    position=int(field_spec.get("position", 0)),
                    is_system=True,
                )
            )
        if spec["slug"] == "klanten":
            await create_record(
                session,
                tenant_id,
                table.id,
                {
                    "naam": "Demo Klant",
                    "email": "demo@klant.nl",
                    "status": "actief",
                    "bedrijf": "Bokito BV",
                },
            )
    await session.commit()
    return await list_standard_tables(session, tenant_id)


async def import_csv(
    session: AsyncSession,
    tenant_id: UUID,
    table_id: int,
    file: UploadFile,
    mapping: dict[str, str],
) -> dict[str, Any]:
    await get_table(session, tenant_id, table_id)
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    imported = 0
    errors: list[dict[str, Any]] = []
    for row_num, row in enumerate(reader, start=2):
        data: dict[str, Any] = {}
        for csv_col, field_slug in mapping.items():
            if field_slug and csv_col in row:
                data[field_slug] = row[csv_col]
        if not data:
            errors.append({"row": row_num, "message": "No mapped columns"})
            continue
        try:
            await create_record(session, tenant_id, table_id, data)
            imported += 1
        except Exception as exc:
            errors.append({"row": row_num, "message": str(exc)})
    return {"imported": imported, "skipped": len(errors), "errors": errors}


async def export_table(
    session: AsyncSession,
    tenant_id: UUID,
    table_id: int,
    fmt: str,
    fields: list[str] | None,
) -> tuple[bytes, str, str]:
    table = await get_table(session, tenant_id, table_id)
    field_rows = await list_fields(session, tenant_id, table_id)
    slugs = fields or [f["slug"] for f in field_rows]
    data = await list_records(session, tenant_id, table_id, page=1, per_page=100_000)
    items = data["items"]
    if fmt == "json":
        body = json.dumps(items, ensure_ascii=False, indent=2).encode("utf-8")
        return body, "application/json", f"{table.slug}.json"
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["id", *slugs])
    writer.writeheader()
    for item in items:
        row = {"id": item["id"]}
        for slug in slugs:
            row[slug] = item.get("data", {}).get(slug, "")
        writer.writerow(row)
    body = output.getvalue().encode("utf-8-sig")
    return body, "text/csv", f"{table.slug}.csv"
