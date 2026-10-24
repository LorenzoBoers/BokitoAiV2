"""Agents in a person's dock: pinned seats with a fixed dial key.

Pins live in ``users.settings_json.dock_agents`` as ``[{agent_id, dial_key}]``.
The rail the dock draws is built here: agents riding on stack cards first,
then pinned agents without a card, then agents that left a note for this
person while not pinned (a temporary seat until the note is played).
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import String, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import status_error
from app.models.agent import Agent
from app.models.auth import User

# Function keys Chrome and Bokito leave alone. Letters type, F5 reloads, F11 fills the screen.
DIAL_KEYS: tuple[str, ...] = ("F1", "F2", "F4", "F8", "F9", "Shift+F2")
ALL_CALL_KEY = "F12"
MAX_DOCK_AGENTS = len(DIAL_KEYS)
INTERCOM_SOURCE = "intercom"


def _settings(user: User | None) -> dict[str, Any]:
    try:
        parsed = json.loads((user.settings_json if user else None) or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def read_dock(user: User | None) -> list[dict[str, str]]:
    raw = _settings(user).get("dock_agents")
    rows: list[dict[str, str]] = []
    seen_agents: set[str] = set()
    seen_keys: set[str] = set()
    for row in raw if isinstance(raw, list) else []:
        if not isinstance(row, dict):
            continue
        agent_id = str(row.get("agent_id") or "").strip()
        key = str(row.get("dial_key") or "").strip()
        if not agent_id or agent_id in seen_agents:
            continue
        if key not in DIAL_KEYS or key in seen_keys:
            key = ""
        seen_agents.add(agent_id)
        if key:
            seen_keys.add(key)
        rows.append({"agent_id": agent_id, "dial_key": key})
    free = [k for k in DIAL_KEYS if k not in seen_keys]
    for row in rows:
        if not row["dial_key"] and free:
            row["dial_key"] = free.pop(0)
    return rows[:MAX_DOCK_AGENTS]


async def _active_agent_ids(
    session: AsyncSession, tenant_id: UUID, ids: list[UUID]
) -> set[UUID]:
    if not ids:
        return set()
    return set(
        (
            await session.execute(
                select(Agent.id).where(
                    Agent.tenant_id == tenant_id,
                    Agent.id.in_(ids),
                    Agent.is_active.is_(True),
                )
            )
        ).scalars()
    )


async def live_dock(
    session: AsyncSession, tenant_id: UUID, user: User | None
) -> list[dict[str, str]]:
    """Pins that still resolve to an active agent in this workspace.

    Stale pins (other tenant, archived, deleted) stay in settings until the
    next write; the dock and pin picker only see live seats so a save cannot
    fail with ``Unknown agent`` because of leftovers from another workspace.
    """
    rows = read_dock(user)
    if not rows:
        return []
    ids: list[UUID] = []
    for row in rows:
        try:
            ids.append(UUID(row["agent_id"]))
        except ValueError:
            continue
    found = await _active_agent_ids(session, tenant_id, ids)
    return [row for row in rows if UUID(row["agent_id"]) in found]


async def write_dock(
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    rows: list[dict[str, str]],
) -> list[dict[str, str]]:
    """Replace this person's pinned agents. Keys must be unique and known.

    Agents that are missing, inactive, or from another tenant are dropped
    instead of failing the whole save — docks are per-person and travel
    across workspace switches, so leftovers from a previous tenant are
    common. Unknown agent is only raised when every submitted pin is bad.
    """
    if len(rows) > MAX_DOCK_AGENTS:
        raise status_error(status_code=422, detail=f"At most {MAX_DOCK_AGENTS} agents fit in the dock")
    clean: list[dict[str, str]] = []
    keys: set[str] = set()
    ids: list[UUID] = []
    for row in rows:
        try:
            agent_id = UUID(str(row.get("agent_id") or ""))
        except ValueError as exc:
            raise status_error(status_code=422, detail="Unknown agent") from exc
        key = str(row.get("dial_key") or "").strip()
        if key not in DIAL_KEYS:
            raise status_error(status_code=422, detail="Unknown dial key")
        if key in keys or agent_id in ids:
            raise status_error(status_code=422, detail="Each agent and each key appears once")
        keys.add(key)
        ids.append(agent_id)
        clean.append({"agent_id": str(agent_id), "dial_key": key})
    if ids:
        found = await _active_agent_ids(session, tenant_id, ids)
        clean = [row for row in clean if UUID(row["agent_id"]) in found]
        if not clean:
            raise status_error(status_code=422, detail="Unknown agent")
    stored = _settings(user)
    stored["dock_agents"] = clean
    user.settings_json = json.dumps(stored)
    session.add(user)
    await session.flush()
    return clean


async def lane_ids(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, agent_ids: list[UUID]
) -> dict[UUID, UUID]:
    """Each agent's newest intercom lane with this person."""
    from app.models.signal import Signal

    if not agent_ids:
        return {}
    rows = (
        await session.execute(
            select(Signal.agent_id, Signal.id)
            .where(
                Signal.tenant_id == tenant_id,
                Signal.source == INTERCOM_SOURCE,
                Signal.owner_user_id == user_id,
                Signal.agent_id.in_(agent_ids),
                Signal.deleted_at.is_(None),
                Signal.superseded_by_id.is_(None),
            )
            .order_by(Signal.last_message_at.desc())
        )
    ).all()
    out: dict[UUID, UUID] = {}
    for agent_id, signal_id in rows:
        if agent_id is not None and agent_id not in out:
            out[agent_id] = signal_id
    return out


async def build_rail(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Seats for the dock. Each agent once; card agents carry their card."""
    from app.models.agent_call import AgentCall
    from app.models.voice_note import VoiceNote
    from app.services.presence import WORKING, agent_status
    from app.services.signal_threads.serialize import _speaker_payload

    user = await session.get(User, user_id)
    pinned = read_dock(user)
    pinned_keys = {row["agent_id"]: row["dial_key"] for row in pinned}

    order: list[tuple[str, str | None]] = []
    seen: set[str] = set()
    for item in items:
        for agent in item.get("agents") or []:
            aid = str(agent.get("id") or "")
            if aid and aid not in seen:
                seen.add(aid)
                order.append((aid, str(item["id"])))
    for row in pinned:
        if row["agent_id"] not in seen:
            seen.add(row["agent_id"])
            order.append((row["agent_id"], None))

    unplayed_rows = (
        await session.execute(
            select(
                VoiceNote.agent_id,
                func.count(VoiceNote.id),
                func.max(cast(VoiceNote.via_agent_id, String)),
            )
            .where(
                VoiceNote.tenant_id == tenant_id,
                VoiceNote.user_id == user_id,
                VoiceNote.status == "queued",
                VoiceNote.agent_id.is_not(None),
            )
            .group_by(VoiceNote.agent_id)
        )
    ).all()
    unplayed = {str(aid): int(count) for aid, count, _via in unplayed_rows}
    via = {str(aid): (str(v) if v else None) for aid, _count, v in unplayed_rows}
    temporary: set[str] = set()
    for aid in unplayed:
        if aid not in seen:
            seen.add(aid)
            temporary.add(aid)
            order.append((aid, None))

    ids: list[UUID] = []
    for aid, _card in order:
        try:
            ids.append(UUID(aid))
        except ValueError:
            continue
    if not ids:
        return []
    agents = {
        str(a.id): a
        for a in (
            await session.execute(
                select(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(ids), Agent.is_active.is_(True))
            )
        ).scalars()
    }
    lanes = await lane_ids(session, tenant_id, user_id, ids)
    live = (
        await session.execute(
            select(AgentCall.agent_id).where(
                AgentCall.tenant_id == tenant_id,
                AgentCall.user_id == user_id,
                AgentCall.status == "live",
            )
        )
    ).scalars().first()

    used_keys = set(pinned_keys.values())
    free_keys = [k for k in DIAL_KEYS if k not in used_keys]
    seats: list[dict[str, Any]] = []
    for aid, card_id in order:
        agent = agents.get(aid)
        if agent is None:
            continue
        key = pinned_keys.get(aid)
        if key is None and free_keys:
            key = free_keys.pop(0)
        working = agent_status(agent.runtime_status) == WORKING
        count = unplayed.get(aid, 0)
        if live is not None and str(live) == aid:
            state = "live"
        elif count:
            state = "has_note"
        elif working:
            state = "thinking"
        else:
            state = "idle"
        lane = lanes.get(agent.id)
        payload = _speaker_payload(agent)
        payload.update(
            {
                "agent_id": aid,
                "working": working,
                "summary": ((agent.current_activity_summary or "").strip() or None) if working else None,
                "thread_id": card_id or (str(lane) if lane else None),
                "lane_id": str(lane) if lane else None,
                "on_card_id": card_id,
                "pinned": aid in pinned_keys,
                "temporary": aid in temporary,
                "state": state,
                "unplayed": count,
                "dial_key": key,
                "via_agent_id": via.get(aid),
            }
        )
        seats.append(payload)
    return seats
