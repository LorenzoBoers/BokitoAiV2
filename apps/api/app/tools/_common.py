"""Helpers shared by the built-in tool modules."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.models.auth import Tenant
from app.tools.registry import ToolContext

TO_TARGET_SCHEMA = {
    "type": "string",
    "description": (
        "Optional: who to ask. 'user:<email>' or 'team:<team name>'. "
        "Leave empty to follow the agent's Ask questions to setting."
    ),
}

PROPOSAL_ITEMS_SCHEMA = {
    "type": "array",
    "description": (
        "Showcase cards inside your message (EntityRow previews). Prefer #name "
        "for tags in prose. Types: conversation | trash_entry | trigger | file | "
        "image | user | agent | tag | flow | folder | canvas | contact | "
        "integration | marketplace | module | help_doc | knowledge | message. Pass id (tag: name; file: "
        "message_id + name/index; image: https url in url or id; "
        "marketplace/module/help_doc: slug or path; knowledge: workspace doc id; marketplace id is the "
        "catalog slug e.g. github). "
        "Example: items:[{type:\"marketplace\", id:\"slack\"}] or "
        "[{type:\"image\", url:\"https://…\", title:\"…\"}]."
    ),
    "items": {
        "type": "object",
        "properties": {
            "type": {"type": "string"},
            "id": {"type": "string"},
            "name": {"type": "string"},
            "url": {"type": "string"},
            "image_url": {"type": "string"},
            "title": {"type": "string"},
            "message_id": {"type": "string"},
            "index": {"type": "integer"},
        },
        "required": ["type"],
    },
}


async def _get_tenant(ctx: ToolContext) -> Tenant:
    result = await ctx.session.execute(select(Tenant).where(Tenant.id == ctx.tenant_id))
    return result.scalar_one()


def _target_signal_id(ctx: ToolContext, tool_input: dict[str, Any]) -> UUID | None:
    """Thread a messaging tool acts on: explicit input, else the call's thread."""
    raw = tool_input.get("signal_id")
    if raw:
        try:
            return UUID(str(raw))
        except ValueError:
            return ctx.signal_id
    return ctx.signal_id


async def _resolve_messaging_signal(
    ctx: ToolContext, tool_input: dict[str, Any]
):
    """Resolve the conversation a messaging tool should mutate.

    Ask sessions already pass the host as ``ctx.signal_id``, but models still
    sometimes pass the session id or a stale uuid. Remap assistant sessions to
    their host, and fall back to ``ctx.signal_id`` when an explicit id is gone.
    """
    from app.models.signal import Signal

    candidates: list[UUID] = []
    raw = tool_input.get("signal_id")
    if raw not in (None, ""):
        try:
            candidates.append(UUID(str(raw)))
        except ValueError:
            pass
    if ctx.signal_id is not None and ctx.signal_id not in candidates:
        candidates.append(ctx.signal_id)
    if not candidates:
        return None, "signal_id required"

    for cand in candidates:
        signal = (
            await ctx.session.execute(
                select(Signal).where(Signal.id == cand, Signal.tenant_id == ctx.tenant_id)
            )
        ).scalar_one_or_none()
        if signal is None:
            continue
        if signal.channel == "assistant" and signal.context_signal_id:
            host = (
                await ctx.session.execute(
                    select(Signal).where(
                        Signal.id == signal.context_signal_id,
                        Signal.tenant_id == ctx.tenant_id,
                    )
                )
            ).scalar_one_or_none()
            if host is not None:
                return host, None
            # Orphan session — still prefer something real over failing.
        return signal, None
    return None, "Signal not found"


def _parse_when(raw: Any):
    from datetime import datetime as _dt

    text = str(raw or "").strip()
    if not text:
        return None
    try:
        parsed = _dt.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    # Store naive UTC like the rest of the schema.
    if parsed.tzinfo is not None:
        from datetime import timezone as _tz

        parsed = parsed.astimezone(_tz.utc).replace(tzinfo=None)
    return parsed


