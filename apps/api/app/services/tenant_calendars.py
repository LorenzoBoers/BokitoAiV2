"""First-class workspace calendars backed by Google/Outlook connections."""

from __future__ import annotations

from app.core.time import utcnow

import json
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import CalendarEvent, CalendarTagLink, TenantCalendar
from app.models.integration import IntegrationConnection
from app.models.signal import SignalTag
from app.services import calendar_access

if TYPE_CHECKING:
    from app.services.calendar_sync import CalendarViewer


async def rows_for_connection(
    session: AsyncSession, connection_id: UUID
) -> list[TenantCalendar]:
    result = await session.execute(
        select(TenantCalendar)
        .where(TenantCalendar.connection_id == connection_id)
        .order_by(TenantCalendar.is_primary.desc(), TenantCalendar.name.asc())
    )
    return list(result.scalars().all())


async def get_calendar(
    session: AsyncSession, tenant_id: UUID, calendar_id: UUID
) -> TenantCalendar | None:
    row = await session.get(TenantCalendar, calendar_id)
    if row is None or row.tenant_id != tenant_id:
        return None
    return row


async def ensure_from_snapshot(
    session: AsyncSession,
    conn: IntegrationConnection,
    calendars: list[dict[str, Any]] | None = None,
) -> list[TenantCalendar]:
    """Upsert TenantCalendar rows from a provider snapshot (meta or fresh list).

    ``enabled`` on the snapshot seeds ``sync_enabled`` only for new rows.
    Existing rows keep their sync_enabled / access / tags.
    """
    from app.services.calendar_sync import stored_calendars

    snapshot = calendars if calendars is not None else stored_calendars(conn)
    existing = {row.external_id: row for row in await rows_for_connection(session, conn.id)}
    now = utcnow()
    out: list[TenantCalendar] = []
    for item in snapshot:
        external_id = str(item.get("id") or "")
        if not external_id:
            continue
        row = existing.get(external_id)
        if row is None:
            row = TenantCalendar(
                tenant_id=conn.tenant_id,
                connection_id=conn.id,
                external_id=external_id,
                name=str(item.get("name") or external_id),
                color=str(item.get("color") or ""),
                is_primary=bool(item.get("primary")),
                writable=bool(item.get("writable")),
                sync_enabled=bool(item.get("enabled")),
                access_json="[]",
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            existing[external_id] = row
        else:
            row.name = str(item.get("name") or row.name or external_id)
            row.color = str(item.get("color") or row.color or "")
            row.is_primary = bool(item.get("primary"))
            row.writable = bool(item.get("writable"))
            row.updated_at = now
            session.add(row)
        out.append(row)
    await session.flush()
    return out


def apply_enabled_flags(
    snapshot: list[dict[str, Any]], rows: list[TenantCalendar]
) -> list[dict[str, Any]]:
    """Overlay TenantCalendar.sync_enabled onto a provider calendar list."""
    by_ext = {r.external_id: r for r in rows}
    out: list[dict[str, Any]] = []
    for item in snapshot:
        ext = str(item.get("id") or "")
        row = by_ext.get(ext)
        enabled = bool(row.sync_enabled) if row else bool(item.get("enabled"))
        out.append(
            {
                **item,
                "enabled": enabled,
                "tenant_calendar_id": str(row.id) if row else None,
            }
        )
    return out


def _rows_as_snapshot(rows: list[TenantCalendar]) -> list[dict[str, Any]]:
    return [
        {
            "id": r.external_id,
            "name": r.name,
            "color": r.color,
            "primary": r.is_primary,
            "writable": r.writable,
            "enabled": r.sync_enabled,
        }
        for r in rows
    ]


async def calendars_payload_for_connection(
    session: AsyncSession, conn: IntegrationConnection
) -> list[dict[str, Any]]:
    from app.services.calendar_sync import stored_calendars

    rows = await ensure_from_snapshot(session, conn)
    return apply_enabled_flags(stored_calendars(conn) or _rows_as_snapshot(rows), rows)


async def set_selection(
    session: AsyncSession,
    conn: IntegrationConnection,
    *,
    enabled_ids: list[str] | None = None,
    default_write: str | None = None,
) -> list[dict[str, Any]]:
    """Enable/disable sync on tenant calendars; purge events when turned off."""
    from app.services.calendar_sync import _parse_json, _save_calendars, stored_calendars

    snapshot = stored_calendars(conn)
    rows = await ensure_from_snapshot(session, conn, snapshot)
    by_ext = {r.external_id: r for r in rows}
    known = set(by_ext)
    if enabled_ids is not None:
        wanted = {str(x) for x in enabled_ids}
        unknown = wanted - known
        if unknown:
            raise ValueError("Unknown calendar: " + ", ".join(sorted(unknown)))
        now = utcnow()
        disabled_ext: list[str] = []
        for ext, row in by_ext.items():
            on = ext in wanted
            if row.sync_enabled and not on:
                disabled_ext.append(ext)
            row.sync_enabled = on
            row.updated_at = now
            session.add(row)
        for item in snapshot:
            item["enabled"] = item["id"] in wanted
        _save_calendars(conn, snapshot)
        if disabled_ext:
            await session.execute(
                delete(CalendarEvent).where(
                    CalendarEvent.connection_id == conn.id,
                    CalendarEvent.calendar_id.in_(disabled_ext),
                )
            )
    if default_write is not None:
        target = by_ext.get(default_write)
        if target is None or not target.writable or not target.sync_enabled:
            raise ValueError("The default calendar must be switched on and writable.")
        meta = _parse_json(conn.metadata_json)
        meta["default_write_calendar"] = default_write
        conn.metadata_json = json.dumps(meta)
    session.add(conn)
    await session.commit()
    rows = await rows_for_connection(session, conn.id)
    return apply_enabled_flags(stored_calendars(conn) or _rows_as_snapshot(rows), rows)


async def calendar_level(
    session: AsyncSession, cal: TenantCalendar, viewer: CalendarViewer | None
) -> str | None:
    if viewer is None:
        return "manage"
    if viewer.agent_id is not None:
        return await calendar_access.agent_level(session, cal, viewer.agent_id)
    if viewer.user_id is not None:
        return await calendar_access.user_level(
            session, cal, user_id=viewer.user_id, role=viewer.role
        )
    return None


async def visible_calendars(
    session: AsyncSession, tenant_id: UUID, viewer: CalendarViewer | None
) -> list[tuple[TenantCalendar, str, IntegrationConnection]]:
    """Tenant calendars the viewer may use, with level and connection."""
    from app.services.access_list import UNRESTRICTED_ROLES, agent_principal, user_principal
    from app.services.calendar_sync import visible_connections

    visible_conns = await visible_connections(session, tenant_id, viewer)
    if not visible_conns:
        return []
    conn_by_id = {c.id: (c, level) for c, level in visible_conns}
    result = await session.execute(
        select(TenantCalendar)
        .where(
            TenantCalendar.tenant_id == tenant_id,
            TenantCalendar.connection_id.in_(list(conn_by_id)),
        )
        .order_by(TenantCalendar.name.asc())
    )
    rows = list(result.scalars().all())
    missing_conn_ids = {
        cid for cid in conn_by_id if not any(r.connection_id == cid for r in rows)
    }
    for cid in missing_conn_ids:
        conn, _ = conn_by_id[cid]
        rows.extend(await ensure_from_snapshot(session, conn))
    if viewer is None or (viewer.agent_id is None and viewer.role in UNRESTRICTED_ROLES):
        return [
            (r, "manage", conn_by_id[r.connection_id][0])
            for r in rows
            if r.connection_id in conn_by_id
        ]

    if viewer.agent_id is not None:
        principal = await agent_principal(session, tenant_id, viewer.agent_id)
    elif viewer.user_id is not None:
        principal = await user_principal(session, tenant_id, viewer.user_id, viewer.role)
    else:
        return []

    out: list[tuple[TenantCalendar, str, IntegrationConnection]] = []
    for row in rows:
        conn_pair = conn_by_id.get(row.connection_id)
        if conn_pair is None:
            continue
        conn, _conn_level = conn_pair
        level = calendar_access.level_for(row, principal)
        if level:
            out.append((row, level, conn))
    return out


async def tags_by_calendar(
    session: AsyncSession, tenant_id: UUID, calendar_ids: list[UUID]
) -> dict[UUID, list[dict[str, Any]]]:
    if not calendar_ids:
        return {}
    rows = (
        await session.execute(
            select(CalendarTagLink.calendar_id, SignalTag.id, SignalTag.name)
            .join(SignalTag, SignalTag.id == CalendarTagLink.tag_id)
            .where(
                CalendarTagLink.calendar_id.in_(calendar_ids),
                SignalTag.tenant_id == tenant_id,
            )
            .order_by(SignalTag.name)
        )
    ).all()
    out: dict[UUID, list[dict[str, Any]]] = {cid: [] for cid in calendar_ids}
    for calendar_id, tag_id, name in rows:
        out.setdefault(calendar_id, []).append({"id": str(tag_id), "name": name})
    return out


async def list_calendar_tags(
    session: AsyncSession, tenant_id: UUID, calendar_id: UUID
) -> list[dict[str, Any]]:
    return (await tags_by_calendar(session, tenant_id, [calendar_id])).get(calendar_id, [])


async def set_calendar_tags(
    session: AsyncSession,
    tenant_id: UUID,
    calendar_id: UUID,
    names: list[str],
    *,
    user_id: UUID | None = None,
) -> list[dict[str, Any]]:
    from app.services.signal_tags import ensure_tags

    cal = await get_calendar(session, tenant_id, calendar_id)
    if cal is None:
        raise ValueError("Calendar not found")
    wanted = await ensure_tags(session, tenant_id, names, user_id=user_id)
    await session.execute(delete(CalendarTagLink).where(CalendarTagLink.calendar_id == calendar_id))
    now = utcnow()
    for row in wanted.values():
        session.add(
            CalendarTagLink(
                calendar_id=calendar_id, tag_id=row.id, tenant_id=tenant_id, created_at=now
            )
        )
    await session.flush()
    return await list_calendar_tags(session, tenant_id, calendar_id)


async def list_tenant_calendars(
    session: AsyncSession, tenant_id: UUID, viewer: CalendarViewer | None = None
) -> list[dict[str, Any]]:
    from app.services.calendar_sync import _calendar_slug, _parse_json

    visible = await visible_calendars(session, tenant_id, viewer)
    tag_map = await tags_by_calendar(session, tenant_id, [c.id for c, _, _ in visible])
    out: list[dict[str, Any]] = []
    for cal, level, conn in visible:
        slug = _calendar_slug(conn)
        meta = _parse_json(conn.metadata_json)
        out.append(
            {
                "id": str(cal.id),
                "connection_id": str(cal.connection_id),
                "external_id": cal.external_id,
                "name": cal.name,
                "color": cal.color,
                "primary": cal.is_primary,
                "writable": cal.writable,
                "sync_enabled": cal.sync_enabled,
                "provider": slug,
                "account": str(meta.get("email") or meta.get("identity") or ""),
                "display_name": conn.display_name or "",
                "tags": tag_map.get(cal.id, []),
                "access": calendar_access.calendar_access(cal),
                "access_is_default": calendar_access.is_default_access(cal),
                "access_level": level,
                "can_manage": level == "manage",
            }
        )
    return out


async def patch_calendar(
    session: AsyncSession,
    cal: TenantCalendar,
    *,
    sync_enabled: bool | None = None,
) -> TenantCalendar:
    if sync_enabled is not None:
        was = cal.sync_enabled
        cal.sync_enabled = bool(sync_enabled)
        cal.updated_at = utcnow()
        session.add(cal)
        conn = await session.get(IntegrationConnection, cal.connection_id)
        if conn is not None:
            from app.services.calendar_sync import _save_calendars, stored_calendars

            snapshot = stored_calendars(conn)
            for item in snapshot:
                if item["id"] == cal.external_id:
                    item["enabled"] = cal.sync_enabled
            if snapshot:
                _save_calendars(conn, snapshot)
                session.add(conn)
        if was and not cal.sync_enabled:
            await session.execute(
                delete(CalendarEvent).where(CalendarEvent.tenant_calendar_id == cal.id)
            )
            await session.execute(
                delete(CalendarEvent).where(
                    CalendarEvent.connection_id == cal.connection_id,
                    CalendarEvent.calendar_id == cal.external_id,
                )
            )
    await session.commit()
    await session.refresh(cal)
    return cal


async def bind_event_calendar(
    session: AsyncSession, conn: IntegrationConnection, external_cal_id: str
) -> UUID | None:
    """Resolve tenant_calendar_id for an event being upserted."""
    row = (
        await session.execute(
            select(TenantCalendar).where(
                TenantCalendar.connection_id == conn.id,
                TenantCalendar.external_id == external_cal_id,
            )
        )
    ).scalars().first()
    return row.id if row else None
