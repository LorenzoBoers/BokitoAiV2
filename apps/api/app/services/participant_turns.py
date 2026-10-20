"""Floor helpers and the one door to queue an agent turn.

The queue itself lives in ``app.services.agent_turns``. ``active_turn`` on the
signal is a read model of that queue, plus a presence chip while an inbound
reply runs outside it.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_thread_presence, publish_thread_update
from app.models.agent import Agent
from app.models.signal import Signal

logger = logging.getLogger(__name__)


def _parse_active(signal: Signal) -> dict[str, Any]:
    try:
        data = json.loads(signal.active_turn_json or "{}")
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def clear_active_turn(signal: Signal, **_: Any) -> None:
    signal.active_turn_json = "{}"


async def clear_ask_floor_chip(
    session: AsyncSession,
    signal: Signal,
    *,
    agent_id: UUID | None,
) -> bool:
    """Drop a presence chip for ``agent_id`` that no turn row backs."""
    if agent_id is None:
        return False
    floor = _parse_active(signal)
    if not floor.get("ref_id") or floor.get("turn_id"):
        return False
    if str(floor.get("ref_id")) != str(agent_id):
        return False
    clear_active_turn(signal)
    session.add(signal)
    try:
        await publish_thread_presence(
            signal.tenant_id,
            signal.id,
            phase="idle",
            actor_kind="agent",
            actor_id=str(agent_id),
            actor_name=str(floor.get("name") or ""),
            item={"active_turn": None},
        )
        await publish_thread_update(signal)
    except Exception:  # noqa: BLE001
        logger.debug("publish clear floor chip failed", exc_info=True)
    return True


async def request_participant_turn(
    session: AsyncSession,
    signal: Signal,
    *,
    member_kind: str,
    member_ref_id: UUID,
    prompt: str = "",
    requested_by_kind: str = "agent",
    requested_by_id: UUID | None = None,
    run: bool = True,
    cause_kind: str | None = None,
    cause_message_id: UUID | None = None,
    idempotency_key: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    """Queue a turn for an agent, or (``run=False``) only show it as the speaker."""
    if member_kind != "agent":
        return {"ok": False, "error": "Only agent participants can take a turn"}
    agent = await session.get(Agent, member_ref_id)
    if agent is None or agent.tenant_id != signal.tenant_id:
        return {"ok": False, "error": "Agent not found"}
    if not agent.is_active or agent.kind == "archived":
        return {"ok": False, "error": "Agent is not active"}

    if not run:
        floor = {
            "kind": "agent",
            "ref_id": str(member_ref_id),
            "name": agent.name,
            "nonce": f"chip:{member_ref_id}",
            "requested_by_kind": requested_by_kind,
        }
        current = _parse_active(signal)
        if not current.get("turn_id"):
            signal.active_turn_json = json.dumps(floor)
            session.add(signal)
            await session.flush()
            try:
                await publish_thread_presence(
                    signal.tenant_id,
                    signal.id,
                    phase="thinking",
                    actor_kind="agent",
                    actor_id=str(member_ref_id),
                    actor_name=agent.name,
                    item={"active_turn": floor},
                )
            except Exception:  # noqa: BLE001
                logger.debug("publish floor chip failed", exc_info=True)
        return {"ok": True, "outcome": "requested", "active_turn": floor}

    from app.services.agent_turns import enqueue_turn

    kind = cause_kind or {"user": "human", "agent": "handoff"}.get(requested_by_kind, "system")
    return await enqueue_turn(
        session,
        signal,
        agent_id=member_ref_id,
        cause_kind=kind,
        requested_by_kind=requested_by_kind,
        requested_by_id=requested_by_id,
        prompt=prompt,
        cause_message_id=cause_message_id,
        idempotency_key=idempotency_key,
    )
