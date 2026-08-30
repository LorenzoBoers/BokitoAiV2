"""Calendar tools: list and propose create/update on connected calendars."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.tools.registry import ToolContext, ToolSpec, register_tool


def _event_id_from_agenda(item: dict[str, Any]) -> str:
    raw = str(item.get("id") or "")
    return raw[4:] if raw.startswith("cal:") else raw


async def _calendar_list_events(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.calendar_sync import events_as_agenda_items, list_calendar_connections

    connections = await list_calendar_connections(ctx.session, ctx.tenant_id)
    if not connections:
        return {
            "ok": False,
            "error": "no_calendar",
            "message": (
                "No calendar connected. Connect Google Calendar or Outlook Calendar "
                "under Settings > Marketplace or Agenda."
            ),
        }
    days = int(tool_input.get("days") or 7)
    days = max(1, min(days, 60))
    start = datetime.utcnow() - timedelta(hours=1)
    end = datetime.utcnow() + timedelta(days=days)
    items = await events_as_agenda_items(ctx.session, ctx.tenant_id, start=start, end=end)
    return {
        "ok": True,
        "connections": connections,
        "events": [
            {
                "id": _event_id_from_agenda(i),
                "title": i.get("name"),
                "at": i.get("at"),
                "end_at": i.get("end_at"),
                "provider": i.get("provider_label") or i.get("provider"),
                "location": i.get("location") or "",
                "link": i.get("html_link") or "",
                "connection_id": i.get("connection_id") or "",
            }
            for i in items[:50]
        ],
        "count": len(items),
    }


async def _calendar_propose_event(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.tools.builtin import _create_decision_request

    title = str(tool_input.get("title") or "").strip()
    start_at = str(tool_input.get("start_at") or "").strip()
    end_at = str(tool_input.get("end_at") or "").strip()
    if not title or not start_at or not end_at:
        return {"ok": False, "error": "title, start_at and end_at are required"}
    connection_id = str(tool_input.get("connection_id") or "").strip()
    description = str(tool_input.get("description") or "").strip()
    location = str(tool_input.get("location") or "").strip()
    payload = {
        "connection_id": connection_id,
        "title": title,
        "start_at": start_at,
        "end_at": end_at,
        "description": description,
        "location": location,
    }
    result = await _create_decision_request(
        ctx,
        {
            "title": f"Create calendar event: {title}",
            "summary": f"{title} from {start_at} to {end_at}",
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
    title = str(tool_input.get("title") or "").strip()
    start_at = str(tool_input.get("start_at") or "").strip()
    end_at = str(tool_input.get("end_at") or "").strip()
    description = tool_input.get("description")
    location = tool_input.get("location")
    if not any([title, start_at, end_at, description is not None, location is not None]):
        return {
            "ok": False,
            "error": "Provide at least one of title, start_at, end_at, description, location",
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
    label = title or "calendar event"
    result = await _create_decision_request(
        ctx,
        {
            "title": f"Update calendar event: {label}",
            "summary": f"Reschedule or edit {label}"
            + (f" ({start_at} → {end_at})" if start_at and end_at else ""),
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
            "decision for human approval before writing to Google or Outlook."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "start_at": {"type": "string", "description": "ISO start datetime"},
                "end_at": {"type": "string", "description": "ISO end datetime"},
                "description": {"type": "string"},
                "location": {"type": "string"},
                "connection_id": {
                    "type": "string",
                    "description": "Calendar connection id from calendar_list_events",
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
            "creates a decision for human approval. Use event_id from calendar_list_events."
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
                "start_at": {"type": "string", "description": "ISO start datetime"},
                "end_at": {"type": "string", "description": "ISO end datetime"},
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
