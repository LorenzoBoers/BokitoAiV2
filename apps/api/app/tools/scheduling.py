"""Agenda tools: tasks, thread schedules, wakes, and triggers."""

from __future__ import annotations

from typing import Any
from uuid import UUID


from app.tools._common import (
    _parse_when,
)
from app.tools.registry import ToolContext, ToolSpec, register_tool


async def _schedule_task(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Plan a Task for later: for yourself, a peer agent, or a human."""
    from uuid import UUID as _UUID

    from app.services.agent.style import strip_emoji
    from app.services.orchestration.dispatcher import create_agent_task

    assignee = str(tool_input.get("assignee") or "agent").strip().lower()
    if assignee not in ("agent", "human"):
        return {"error": "assignee must be 'agent' or 'human'"}
    scheduled_for = _parse_when(tool_input.get("scheduled_for"))
    if tool_input.get("scheduled_for") and scheduled_for is None:
        return {"error": "scheduled_for must be an ISO datetime, e.g. 2026-09-04T09:00"}
    title = strip_emoji(str(tool_input.get("title", ""))) or "Planned task"

    agent_id = (
        _UUID(str(tool_input["agent_id"]))
        if tool_input.get("agent_id")
        else (ctx.agent.id if ctx.agent else None)
    )
    # Explicit user_id wins; for human work default to the operator who invoked
    # the tool so promotion can notify someone.
    if tool_input.get("user_id"):
        user_id = _UUID(str(tool_input["user_id"]))
    elif assignee == "human":
        user_id = ctx.user_id
    else:
        user_id = None
    task = await create_agent_task(
        ctx.session,
        ctx.tenant_id,
        title=title,
        description=str(tool_input.get("description") or ""),
        agent_id=agent_id,
        project_id=_UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else None,
        signal_id=ctx.signal_id,
        created_by=ctx.user_id,
        origin="delegation" if ctx.agent else "manual",
        kind=str(tool_input.get("kind") or "task"),
        priority=str(tool_input.get("priority") or "normal"),
        assignee_kind=assignee,
        assignee_user_id=user_id,
        scheduled_for=scheduled_for,
        auto_start=scheduled_for is None and assignee == "agent",
    )
    return {
        "task_id": str(task.id),
        "status": task.status,
        "assignee_kind": task.assignee_kind,
        "scheduled_for": task.scheduled_for.isoformat() if task.scheduled_for else None,
    }


async def _set_thread_schedule(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Put a date or a repeat on a conversation; a new one with ``new_thread``."""
    from uuid import UUID as _UUID

    from fastapi import HTTPException

    from app.models.signal import Signal
    from app.services.agent.style import strip_emoji
    from app.services.thread_schedule import (
        apply_thread_schedule,
        resolve_owner,
        runner_agent_id,
        schedule_payload,
    )

    at = _parse_when(tool_input.get("at"))
    if tool_input.get("at") and at is None:
        return {"error": "at must be an ISO datetime, e.g. 2026-09-04T09:00:00+02:00"}
    ends_at = _parse_when(tool_input.get("ends_at"))
    cron = str(tool_input.get("cron") or "").strip() or None
    try:
        every_minutes = int(tool_input.get("every_minutes") or 0) or None
    except (TypeError, ValueError):
        every_minutes = None
    instructions = tool_input.get("instructions")
    instructions = strip_emoji(str(instructions)).strip() if instructions is not None else None
    title = strip_emoji(str(tool_input.get("title") or "")).strip()
    raw_owner = tool_input.get("owner") or tool_input.get("agent_id")
    try:
        owner = await resolve_owner(ctx.session, ctx.tenant_id, raw_owner) if raw_owner else ...
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    if owner is None and ctx.user_id:
        owner = ("user", ctx.user_id)
    wants_rule = bool(cron or every_minutes or instructions)

    signal: Signal | None = None
    raw_id = tool_input.get("signal_id")
    if raw_id:
        try:
            signal = await ctx.session.get(Signal, _UUID(str(raw_id)))
        except ValueError:
            signal = None
        if signal is None or signal.tenant_id != ctx.tenant_id or signal.deleted_at is not None:
            return {"error": "Conversation not found"}
    elif not tool_input.get("new_thread") and ctx.signal_id:
        signal = await ctx.session.get(Signal, ctx.signal_id)
    # A personal chat stays a chat: a recurring task gets its own conversation.
    if signal is not None and signal.channel == "assistant" and wants_rule and not raw_id:
        signal = None
    if signal is None and not title:
        title = (instructions or "")[:60].strip()
    if not wants_rule and at is None and signal is not None and ends_at is None:
        return {"error": "Pass at (a moment), cron or every_minutes."}
    if owner is ...:
        if signal is None:
            if instructions and ctx.agent is not None:
                owner = ("agent", ctx.agent.id)
            elif ctx.user_id:
                owner = ("user", ctx.user_id)
        elif instructions and runner_agent_id(signal) is None:
            return {
                "error": (
                    "This conversation is owned by a person or team, so no agent runs at the "
                    "moment. Pass owner (an agent) to hand it to that agent with these "
                    "instructions, or pass note instead of instructions for a reminder."
                )
            }
    if owner is not ... and owner[0] != "agent" and instructions and not tool_input.get("note"):
        tool_input = {**tool_input, "note": instructions}
        instructions = None

    details: dict = {}
    if tool_input.get("note"):
        details["note"] = str(tool_input["note"])
    if "notify" in tool_input:
        details["notify"] = bool(tool_input.get("notify"))
    try:
        signal, rule = await apply_thread_schedule(
            ctx.session,
            ctx.tenant_id,
            signal=signal,
            title=title,
            at=at,
            ends_at=ends_at,
            cron=cron,
            every_minutes=every_minutes,
            instructions=instructions,
            owner=owner,
            hide=bool(tool_input.get("hide")),
            surface_before_minutes=int(tool_input.get("surface_before_minutes") or 0),
            details=details or None,
            created_by_user_id=ctx.user_id,
            project_id=_UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else None,
            actor_type="agent" if ctx.agent else "user",
            actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
            enabled=tool_input.get("enabled") is not False,
        )
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    await ctx.session.commit()
    from app.gateway.publish import publish_thread_update

    await publish_thread_update(signal)
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "subject": signal.subject,
        "next_at": signal.next_at.isoformat() if signal.next_at else None,
        "schedule": schedule_payload(rule),
    }


async def _clear_thread_schedule(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.signal import Signal
    from app.services.thread_schedule import clear_thread_schedule

    raw = tool_input.get("signal_id") or ctx.signal_id
    if not raw:
        return {"error": "signal_id is required"}
    try:
        signal = await ctx.session.get(Signal, _UUID(str(raw)))
    except ValueError:
        signal = None
    if signal is None or signal.tenant_id != ctx.tenant_id:
        return {"error": "Conversation not found"}
    await clear_thread_schedule(
        ctx.session,
        signal,
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
    )
    await ctx.session.commit()
    from app.gateway.publish import publish_thread_update

    await publish_thread_update(signal)
    return {"ok": True, "signal_id": str(signal.id)}


async def _schedule_wake(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Alias of set_thread_schedule with an agent wake (yourself by default)."""
    if not str(tool_input.get("instructions") or "").strip():
        return {"error": "instructions is required: what should the agent do on wake?"}
    mapped = dict(tool_input)
    if tool_input.get("name") and not tool_input.get("title"):
        mapped["title"] = tool_input["name"]
    if not (mapped.get("owner") or mapped.get("agent_id")) and ctx.agent is None:
        return {"error": "No agent to wake: pass owner (an agent) or call as an agent."}
    return await _set_thread_schedule(ctx, mapped)


register_tool(
    ToolSpec(
        name="schedule_task",
        description=(
            "Plan a Task for later or assign work to a human. Set scheduled_for "
            "(ISO datetime) to make it dormant until then; assignee 'human' puts "
            "it in front of the team (optionally a specific user_id) instead of "
            "an agent. Use this whenever something must be done later — by you, "
            "a peer agent, or a person."
        ),
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "assignee": {"type": "string", "enum": ["agent", "human"]},
                "agent_id": {"type": "string", "description": "Agent to run it (default: yourself)."},
                "user_id": {"type": "string", "description": "Specific human owner; empty = any member."},
                "scheduled_for": {"type": "string", "description": "ISO datetime when the task becomes active."},
                "project_id": {"type": "string"},
                "kind": {"type": "string", "enum": ["task", "job", "feature", "bug", "idea", "risk"]},
                "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
            },
            "required": ["title"],
        },
        handler=_schedule_task,
        mutating=True,
        gated=True,
    )
)

_THREAD_SCHEDULE_PROPS: dict[str, Any] = {
    "signal_id": {
        "type": "string",
        "description": "Conversation to plan (default: this conversation).",
    },
    "new_thread": {
        "type": "boolean",
        "description": "Start a new agenda conversation instead (needs title).",
    },
    "title": {"type": "string", "description": "Subject of the (new) conversation."},
    "at": {"type": "string", "description": "ISO datetime: the moment, or the first run of a repeat."},
    "ends_at": {"type": "string", "description": "ISO datetime the appointment ends."},
    "cron": {"type": "string", "description": "5-field cron (UTC) for a repeat, e.g. 0 7 * * 1-5."},
    "every_minutes": {"type": "integer", "description": "Repeat every N minutes (min 5)."},
    "owner": {
        "type": "string",
        "description": (
            "Who it is for, which also becomes the conversation owner: a member's name or "
            "email, an agent's name or id, a team name, or 'me' (the person asking). A person "
            "or team gets the conversation back unread; an agent runs the instructions. "
            "Default: keep the current owner (a new conversation goes to you when you pass "
            "instructions, else to the person asking)."
        ),
    },
    "instructions": {"type": "string", "description": "What the agent owner does on each moment."},
    "hide": {
        "type": "boolean",
        "description": "Snooze: hide the conversation from the open lists until the moment (one moment only).",
    },
    "surface_before_minutes": {
        "type": "integer",
        "enum": [0, 15, 30, 60, 1440],
        "description": "With hide: bring it back this many minutes before the moment.",
    },
    "notify": {
        "type": "boolean",
        "description": "Push a notification when the conversation comes back (default true).",
    },
    "note": {"type": "string", "description": "Short note shown with the date."},
    "project_id": {"type": "string"},
    "enabled": {"type": "boolean", "description": "false pauses the repeat."},
}

register_tool(
    ToolSpec(
        name="set_thread_schedule",
        description=(
            "Plan a conversation. A conversation with a date is an agenda item; with "
            "a repeat (cron or every_minutes) it is a recurring task. The conversation "
            "owner is who the moment is for: a person or team owner gets it back (open, "
            "unread, notified); an agent owner works in the conversation with the "
            "instructions and writes only when there is something new. hide snoozes it "
            "out of the open lists until the moment; a new inbound message wakes it. "
            "Use for reminders ('look at this Friday'), snoozes, appointments, and "
            "recurring tasks such as a weekly summary. every_minutes may be 10; the "
            "minimum is 5. Call it once per plan. A second call for the same plan "
            "while a card is open does not add another card. Edits the existing "
            "schedule when called again on the same conversation."
        ),
        category="triggers",
        input_schema={"type": "object", "properties": _THREAD_SCHEDULE_PROPS},
        handler=_set_thread_schedule,
        mutating=True,
        gated=True,
    )
)

register_tool(
    ToolSpec(
        name="clear_thread_schedule",
        description="Remove the date and any repeat from a conversation (default: this one).",
        category="triggers",
        input_schema={"type": "object", "properties": {"signal_id": {"type": "string"}}},
        handler=_clear_thread_schedule,
        mutating=True,
        gated=True,
    )
)

register_tool(
    ToolSpec(
        name="schedule_wake",
        description=(
            "Alias of set_thread_schedule for an agent wake (yourself by default): "
            "once (at), cron, or every_minutes. The wake runs in a conversation of "
            "its own, or in this one when it is not a personal chat."
        ),
        category="triggers",
        input_schema={
            "type": "object",
            "properties": {**_THREAD_SCHEDULE_PROPS, "name": {"type": "string"}},
            "required": ["instructions"],
        },
        handler=_schedule_wake,
        mutating=True,
        gated=True,
    )
)


async def _upsert_trigger(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Same write path as schedule_wake: a scheduled conversation.

    With ``flow`` it is a recurring ticket: a new conversation each period on
    that flow label, in ``folder``, named from ``title``.
    """
    if str(tool_input.get("flow") or "").strip():
        from app.services.recurring_tickets import upsert_recurring_ticket

        try:
            agent_id = UUID(str(tool_input["agent_id"])) if tool_input.get("agent_id") else None
        except ValueError:
            return {"error": "invalid_agent_id"}
        return await upsert_recurring_ticket(
            ctx.session,
            ctx.tenant_id,
            flow=str(tool_input.get("flow")),
            cron=str(tool_input.get("cron") or tool_input.get("cron_expr") or ""),
            folder=str(tool_input.get("folder") or ""),
            title=str(tool_input.get("title") or ""),
            instructions=str(tool_input.get("instructions") or ""),
            name=str(tool_input.get("name") or ""),
            agent_id=agent_id or (ctx.agent.id if ctx.agent else None),
            user_id=ctx.user_id,
        )
    return await _schedule_wake(ctx, tool_input)


register_tool(
    ToolSpec(
        name="upsert_trigger",
        description=(
            "Alias of set_thread_schedule for an agent wake (one-off or recurring); "
            "same scheduled conversation, same Agenda. With flow (a label hashtag with a "
            "flow) and cron it is a recurring ticket instead: each period a new "
            "conversation on that flow, in folder, named from title ({month}, {maand}, "
            "{week}, {date}). One rule per flow and folder; calling again updates it."
        ),
        category="triggers",
        input_schema={
            "type": "object",
            "properties": {
                **_THREAD_SCHEDULE_PROPS,
                "name": {"type": "string"},
                "flow": {"type": "string", "description": "Recurring ticket: label hashtag of the flow."},
                "folder": {"type": "string", "description": "Recurring ticket: folder id, slug or name."},
                "title": {"type": "string", "description": "Recurring ticket: title template, e.g. 'Maandcontent {maand}'."},
                "cron": {"type": "string", "description": "Recurring ticket: 5-field cron, e.g. '0 7 1 * *'."},
            },
        },
        handler=_upsert_trigger,
        mutating=True,
        gated=True,
    )
)
