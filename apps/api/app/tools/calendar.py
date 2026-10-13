"""Calendar tools: list and propose create/update on connected calendars."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any
from re import Match

from app.tools.registry import ToolContext, ToolSpec, register_tool


def _event_id_from_agenda(item: dict[str, Any]) -> str:
    raw = str(item.get("id") or "")
    return raw[4:] if raw.startswith("cal:") else raw


def _parse_when(value: str) -> datetime | date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if len(text) == 10 and text[4] == "-" and text[7] == "-":
            return date.fromisoformat(text)
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _format_point(value: datetime | date) -> str:
    """Compact operator-facing stamp (no ISO ``T``)."""
    if isinstance(value, datetime):
        local = value if value.tzinfo is None else value.astimezone()
        return local.strftime("%d %b %Y, %H:%M")
    return value.strftime("%d %b %Y")


def format_event_when(start_at: str, end_at: str, *, all_day: bool = False) -> str:
    """Human range for decision titles/summaries, e.g. ``14 Oct 2026, 10:30–11:30``."""
    if all_day:
        start = _parse_when(start_at)
        end = _parse_when(end_at)
        if start is None:
            return "all day"
        if end is None or end == start:
            return f"all day {_format_point(start)}"
        return f"all day {_format_point(start)} – {_format_point(end)}"
    start = _parse_when(start_at)
    end = _parse_when(end_at)
    if start is None and end is None:
        return humanize_iso_in_text(f"from {start_at} to {end_at}").strip()
    if start is None:
        return _format_point(end) if isinstance(end, (datetime, date)) else humanize_iso_in_text(str(end_at))
    if end is None:
        return _format_point(start)
    if isinstance(start, datetime) and isinstance(end, datetime):
        # Naive stamps are wall-clock as the agent meant them — do not shift via server TZ.
        s = start.replace(tzinfo=None) if start.tzinfo is None else start.astimezone().replace(tzinfo=None)
        e = end.replace(tzinfo=None) if end.tzinfo is None else end.astimezone().replace(tzinfo=None)
        if s.date() == e.date():
            return f"{s.strftime('%d %b %Y, %H:%M')}–{e.strftime('%H:%M')}"
        return f"{_format_point(s)} – {_format_point(e)}"
    return f"{_format_point(start)} – {_format_point(end)}"


_ISO_IN_TEXT = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?"
)


def humanize_iso_in_text(text: str) -> str:
    """Replace ISO datetimes in free text with compact operator-facing stamps."""

    def _repl(match: Match[str]) -> str:
        parsed = _parse_when(match.group(0))
        if isinstance(parsed, (datetime, date)):
            return _format_point(parsed)
        return match.group(0)

    return _ISO_IN_TEXT.sub(_repl, text or "")


NO_CALENDAR = {
    "ok": False,
    "error": "no_calendar",
    "message": (
        "No calendar you may use is connected. Connect Google Calendar or Outlook "
        "Calendar under Connections (Agenda), or ask its owner for access."
    ),
}

REPAIR_PATH = "/connections?kind=calendar"


def _write_readiness_error(connection: dict[str, Any]) -> dict[str, Any] | None:
    """Refuse create/update proposals when sync is broken or nothing is writable.

    Agents still see the connection via calendar_list_events (so they can explain
    the fault); they must not open a decision that can only fail on approve.
    """
    status = str(connection.get("sync_status") or "").strip().lower()
    sync_error = str(connection.get("sync_error") or "").strip()
    if status in ("error", "reconnect") or sync_error:
        return {
            "ok": False,
            "error": "calendar_sync",
            "message": sync_error
            or (
                "This calendar connection needs repair before new events can be "
                "created. Open Connections (Agenda) and reconnect or fix the sync error."
            ),
            "connection_id": connection.get("id"),
            "sync_status": status or "error",
            "repair_path": REPAIR_PATH,
        }
    if not connection.get("default_write_calendar"):
        return {
            "ok": False,
            "error": "no_writable_calendar",
            "message": (
                "None of the calendars on this account accepts new events. "
                "Open Connections (Agenda), switch a writable calendar on, and set it as default."
            ),
            "connection_id": connection.get("id"),
            "repair_path": REPAIR_PATH,
        }
    return None


def _connection_sync_error(conn: Any) -> dict[str, Any] | None:
    """Same readiness check for an IntegrationConnection ORM row (updates)."""
    from app.services.calendar_sync import _parse_json, default_write_calendar

    meta = _parse_json(getattr(conn, "metadata_json", None))
    return _write_readiness_error(
        {
            "id": str(conn.id),
            "sync_status": meta.get("sync_status") or "idle",
            "sync_error": meta.get("sync_error") or "",
            "default_write_calendar": default_write_calendar(conn),
        }
    )


async def _calendar_list_events(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.calendar_sync import (
        calendar_events_in_window,
        list_calendar_connections,
        viewer_for_tool,
    )

    viewer = viewer_for_tool(ctx)
    connections = await list_calendar_connections(ctx.session, ctx.tenant_id, viewer)
    if not connections:
        return dict(NO_CALENDAR)
    days = int(tool_input.get("days") or 7)
    days = max(1, min(days, 60))
    start = datetime.utcnow() - timedelta(hours=1)
    end = datetime.utcnow() + timedelta(days=days)
    items = await calendar_events_in_window(
        ctx.session, ctx.tenant_id, start=start, end=end, viewer=viewer
    )
    return {
        "ok": True,
        "connections": [
            {
                "id": c["id"],
                "name": c["display_name"],
                "account": c["account"],
                "sync_status": c["sync_status"],
                "default_calendar_id": c["default_write_calendar"],
                "calendars": [
                    {"id": cal["id"], "name": cal["name"], "writable": cal["writable"]}
                    for cal in c["calendars"]
                    if cal["enabled"]
                ],
            }
            for c in connections
        ],
        "events": [
            {
                "id": _event_id_from_agenda(i),
                "title": i.get("title"),
                "at": i.get("start"),
                "end_at": i.get("end"),
                "all_day": bool(i.get("all_day")),
                "provider": i.get("provider_label") or i.get("provider"),
                "calendar": i.get("calendar_name") or "",
                "location": i.get("location") or "",
                "link": i.get("html_link") or "",
                "connection_id": i.get("connection_id") or "",
            }
            for i in items[:50]
        ],
        "count": len(items),
    }


async def _writable_connection(
    ctx: ToolContext, connection_id: str
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """The connection to write to (named or first with a default calendar),
    or an error payload when this caller may not write anywhere.

    Named connections are checked the same way as the default: sync must be
    healthy and a writable default calendar must exist.
    """
    from app.services.calendar_sync import list_calendar_connections, viewer_for_tool

    connections = await list_calendar_connections(ctx.session, ctx.tenant_id, viewer_for_tool(ctx))
    if not connections:
        return None, dict(NO_CALENDAR)
    if connection_id:
        match = next((c for c in connections if c["id"] == connection_id), None)
        if match is None:
            return None, {
                "ok": False,
                "error": "calendar_access",
                "message": "That calendar is not connected or you have no access to it.",
            }
    else:
        match = next((c for c in connections if c["default_write_calendar"]), None)
        if match is None:
            # Prefer a sync/repair error when every connection is broken, so the
            # agent can tell the operator what to fix instead of a blank "none writable".
            broken = next((c for c in connections if _write_readiness_error(c)), None)
            if broken is not None:
                return None, _write_readiness_error(broken)
            return None, {
                "ok": False,
                "error": "no_writable_calendar",
                "message": "None of the connected calendars accepts new events.",
                "repair_path": REPAIR_PATH,
            }
    readiness = _write_readiness_error(match)
    if readiness:
        return None, readiness
    return match, None


async def _calendar_propose_event(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.tools.builtin import _create_decision_request

    title = str(tool_input.get("title") or "").strip()
    start_at = str(tool_input.get("start_at") or "").strip()
    end_at = str(tool_input.get("end_at") or "").strip()
    if not title or not start_at or not end_at:
        return {"ok": False, "error": "title, start_at and end_at are required"}
    connection, error = await _writable_connection(
        ctx, str(tool_input.get("connection_id") or "").strip()
    )
    if error:
        return error
    calendar_id = (
        str(tool_input.get("calendar_id") or "").strip() or connection["default_write_calendar"] or ""
    )
    calendar = next((c for c in connection["calendars"] if c["id"] == calendar_id), None)
    if not calendar_id or calendar is None or not calendar.get("writable"):
        return {
            "ok": False,
            "error": "no_writable_calendar",
            "message": "That calendar does not accept new events.",
            "repair_path": REPAIR_PATH,
        }
    description = str(tool_input.get("description") or "").strip()
    location = str(tool_input.get("location") or "").strip()
    all_day = bool(tool_input.get("all_day"))
    payload = {
        "connection_id": connection["id"],
        "calendar_id": calendar_id,
        "title": title,
        "start_at": start_at,
        "end_at": end_at,
        "description": description,
        "location": location,
        "all_day": all_day,
    }
    when = format_event_when(start_at, end_at, all_day=all_day)
    where = (calendar or {}).get("name") or connection["display_name"]
    result = await _create_decision_request(
        ctx,
        {
            "title": f"Create calendar event: {title}",
            "summary": f"{title} · {when} · {where}",
            "signal_id": tool_input.get("signal_id")
            or (str(ctx.signal_id) if ctx.signal_id else None),
            "options": [
                {
                    "id": "approve",
                    "label": "Create event",
                    "action_type": "calendar_create_event",
                    "payload": payload,
                },
                {"id": "reject", "label": "Reject", "action_type": "reject"},
            ],
        },
    )
    return {
        "ok": True,
        "decision_id": result.get("decision_request_id"),
        "status": result.get("status", "awaiting_human"),
    }


async def _calendar_propose_update(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.tools.builtin import _create_decision_request

    event_id = str(tool_input.get("event_id") or "").strip()
    if not event_id:
        return {"ok": False, "error": "event_id is required (from calendar_list_events)"}
    from uuid import UUID

    from app.services.calendar_sync import connection_level, event_connection, viewer_for_tool

    try:
        _, conn = await event_connection(ctx.session, ctx.tenant_id, UUID(event_id))
    except ValueError:
        return {"ok": False, "error": "Event not found; use an id from calendar_list_events"}
    if conn is None or await connection_level(ctx.session, conn, viewer_for_tool(ctx)) is None:
        return {"ok": False, "error": "You have no access to this calendar."}
    sync_block = _connection_sync_error(conn)
    if sync_block:
        return sync_block
    title = str(tool_input.get("title") or "").strip()
    start_at = str(tool_input.get("start_at") or "").strip()
    end_at = str(tool_input.get("end_at") or "").strip()
    description = tool_input.get("description")
    location = tool_input.get("location")
    if not any(
        [
            title,
            start_at,
            end_at,
            description is not None,
            location is not None,
            "all_day" in tool_input,
        ]
    ):
        return {
            "ok": False,
            "error": "Provide at least one of title, start_at, end_at, description, location, all_day",
        }
    payload: dict[str, Any] = {"event_id": event_id}
    if title:
        payload["title"] = title
    if start_at:
        payload["start_at"] = start_at
    if end_at:
        payload["end_at"] = end_at
    if description is not None:
        payload["description"] = str(description)
    if location is not None:
        payload["location"] = str(location)
    if "all_day" in tool_input:
        payload["all_day"] = bool(tool_input.get("all_day"))
    label = title or "calendar event"
    when = format_event_when(start_at, end_at) if start_at and end_at else ""
    result = await _create_decision_request(
        ctx,
        {
            "title": f"Update calendar event: {label}",
            "summary": f"Reschedule or edit {label}" + (f" · {when}" if when else ""),
            "signal_id": tool_input.get("signal_id")
            or (str(ctx.signal_id) if ctx.signal_id else None),
            "options": [
                {
                    "id": "approve",
                    "label": "Update event",
                    "action_type": "calendar_update_event",
                    "payload": payload,
                },
                {"id": "reject", "label": "Reject", "action_type": "reject"},
            ],
        },
    )
    return {
        "ok": True,
        "decision_id": result.get("decision_request_id"),
        "status": result.get("status", "awaiting_human"),
    }


register_tool(
    ToolSpec(
        name="calendar_list_events",
        description=(
            "List upcoming events from connected Google Calendar or Outlook Calendar. "
            "Returns stable event ids for calendar_propose_update. "
            "Use when the user asks what is on their calendar or about free time."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "How many days ahead to list (1-60). Default 7.",
                }
            },
        },
        handler=_calendar_list_events,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="calendar_propose_event",
        description=(
            "Propose creating an event on a connected calendar. Always creates a "
            "decision card for human approval before writing to Google or Outlook. "
            "Required whenever the user asks to put something on their agenda — "
            "never invent a chat line with ISO timestamps (e.g. "
            "'Title from 2026-10-14T14:00:00 to …'); call this tool so Approve / "
            "Reject buttons appear. After the tool returns, keep chat short "
            "(e.g. ask if the card looks right) — the card already shows the "
            "human-readable when/where. Fails with calendar_sync when the "
            "connection has a sync error — tell the user to repair it under "
            "Connections (Agenda) instead of proposing."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "start_at": {
                    "type": "string",
                    "description": "ISO start datetime, or the first date when all_day",
                },
                "end_at": {
                    "type": "string",
                    "description": "ISO end datetime, or the last inclusive date when all_day",
                },
                "all_day": {
                    "type": "boolean",
                    "description": "Date-only event; shows in the Agenda all-day row.",
                },
                "description": {"type": "string"},
                "location": {"type": "string"},
                "connection_id": {
                    "type": "string",
                    "description": (
                        "Calendar connection id from calendar_list_events; "
                        "default: the first connection with a default calendar"
                    ),
                },
                "calendar_id": {
                    "type": "string",
                    "description": (
                        "Calendar id inside that connection (calendars[].id); "
                        "default: the connection's default calendar"
                    ),
                },
            },
            "required": ["title", "start_at", "end_at"],
        },
        handler=_calendar_propose_event,
        mutating=True,
        gated=True,
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="calendar_propose_update",
        description=(
            "Propose updating or rescheduling an existing calendar event. Always "
            "creates a decision card for human approval. Use event_id from "
            "calendar_list_events. Do not paste ISO timestamps into chat — the "
            "card shows the readable summary."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "event_id": {
                    "type": "string",
                    "description": "Event id from calendar_list_events",
                },
                "title": {"type": "string"},
                "start_at": {
                    "type": "string",
                    "description": "ISO start datetime, or the first date when all_day",
                },
                "end_at": {
                    "type": "string",
                    "description": "ISO end datetime, or the last inclusive date when all_day",
                },
                "all_day": {
                    "type": "boolean",
                    "description": "Date-only event; shows in the Agenda all-day row.",
                },
                "description": {"type": "string"},
                "location": {"type": "string"},
            },
            "required": ["event_id"],
        },
        handler=_calendar_propose_update,
        mutating=True,
        gated=True,
        handles_ask=True,
    )
)
