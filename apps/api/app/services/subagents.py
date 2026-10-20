"""Subagents: hand a piece of work to a child agent with its own context.

Derived from xai-org/grok-build (Apache-2.0); changes listed in docs/third_party/grok-build/CHANGES.md.

Contract (spawn parameters): ``prompt``, ``description``, ``run_in_background``
(default true), ``resume_from``, ``model``, plus Bokito's ``agent_id``,
``persona`` and ``role``.

Limits:
- ``DEFAULT_MAX_CONCURRENT`` running children per workspace (0 clamps to 1);
  over the limit ``limit_behavior`` ``queue`` (default) parks the child,
  ``fail`` refuses the spawn.
- ``MAX_DEPTH`` = 1: a child cannot spawn children.
- Messages: ``MAX_IN_FLIGHT_PER_PAIR`` undelivered per sender-target pair and
  ``MAX_OUTBOUND_PER_ATTEMPT`` per parent turn; over either the call returns
  ``QuotaExceeded``.
- ``resume_from`` only continues a completed child of the same agent.

A child is an ``AgentRun(run_role="delegate")``. It works on the same thread
for tool calls but does not speak there; one collapsed ``system_event`` row
with ``metadata.kind = "subagent"`` shows it. A background child wakes the
parent with an ``AgentTurn(cause_kind="subagent_result")`` when it ends.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.agent import Agent, AgentRun
from app.models.agent_context import SubagentMessage
from app.models.signal import Signal, SignalMessage

logger = logging.getLogger(__name__)

DEFAULT_MAX_CONCURRENT = 32
LIMIT_BEHAVIORS = ("queue", "fail")
MAX_DEPTH = 1
MAX_IN_FLIGHT_PER_PAIR = 4
MAX_OUTBOUND_PER_ATTEMPT = 32
DELIVERIES = ("steer", "queue", "interject")
INLINE_WAIT_SECONDS = 120
RESULT_CHARS = 8000
SUBAGENT_TOOLS = frozenset({"spawn_subagent", "get_subagent_output", "kill_subagent", "send_subagent_message"})
ACTIVE = ("queued", "running")

# In-process children (API inline waits and the no-Redis fallback).
_LOCAL_TASKS: dict[UUID, asyncio.Task] = {}
# Outbound message count per parent turn (the "attempt").
_OUTBOUND: dict[str, int] = {}


class SubagentError(ValueError):
    pass


def limits(tenant: Any | None) -> dict[str, Any]:
    from app.dependencies import tenant_settings

    raw = tenant_settings(tenant).get("subagents") if tenant is not None else None
    raw = raw if isinstance(raw, dict) else {}
    try:
        max_concurrent = int(raw.get("max_concurrent", DEFAULT_MAX_CONCURRENT))
    except (TypeError, ValueError):
        max_concurrent = DEFAULT_MAX_CONCURRENT
    behavior = str(raw.get("limit_behavior") or "queue")
    return {
        "max_concurrent": max(1, max_concurrent),
        "limit_behavior": behavior if behavior in LIMIT_BEHAVIORS else "queue",
    }


def _meta(run: AgentRun) -> dict[str, Any]:
    try:
        data = json.loads(run.runtime_snapshot_json or "{}")
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def _result_text(run: AgentRun) -> str:
    try:
        return str(json.loads(run.result_json or "{}").get("text") or "")
    except (json.JSONDecodeError, AttributeError):
        return ""


def serialize_run(run: AgentRun, agent_name: str = "") -> dict[str, Any]:
    meta = _meta(run)
    return {
        "run_id": str(run.id),
        "agent_id": str(run.agent_id),
        "agent_name": agent_name or meta.get("agent_name") or "",
        "description": meta.get("description") or run.subject,
        "status": run.status,
        "stop_reason": run.stop_reason or "",
        "background": bool(meta.get("background", True)),
        "persona": meta.get("persona") or "",
        "role": meta.get("role") or "",
        "model": meta.get("model") or "",
        "tokens_input": run.tokens_input,
        "tokens_output": run.tokens_output,
        "result": _result_text(run),
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
    }


async def _active_count(session: AsyncSession, tenant_id: UUID) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(AgentRun)
                .where(
                    AgentRun.tenant_id == tenant_id,
                    AgentRun.run_role == "delegate",
                    AgentRun.status == "running",
                )
            )
        ).scalar_one()
    )


async def _is_child_run(session: AsyncSession, run_id: UUID | None) -> bool:
    if run_id is None:
        return False
    run = await session.get(AgentRun, run_id)
    return run is not None and run.run_role == "delegate"


async def _own_child(session: AsyncSession, ctx: Any, run_id: Any) -> AgentRun:
    try:
        rid = UUID(str(run_id))
    except (TypeError, ValueError) as exc:
        raise SubagentError("run_id required") from exc
    run = await session.get(AgentRun, rid)
    if run is None or run.tenant_id != ctx.tenant_id or run.run_role != "delegate":
        raise SubagentError("Subagent not found")
    meta = _meta(run)
    parent_agent = str(ctx.agent.id) if ctx.agent is not None else ""
    if (ctx.run_id is None or run.parent_run_id != ctx.run_id) and meta.get("parent_agent_id") != parent_agent:
        raise SubagentError("That subagent was not started by you")
    return run


def _session_factory(session: AsyncSession) -> async_sessionmaker:
    return async_sessionmaker(session.bind, class_=AsyncSession, expire_on_commit=False)


async def _post_row(session: AsyncSession, run: AgentRun, agent_name: str) -> UUID | None:
    if run.signal_id is None:
        return None
    meta = _meta(run)
    body = f"{agent_name}: {meta.get('description') or run.subject}"
    row = SignalMessage(
        signal_id=run.signal_id,
        tenant_id=run.tenant_id,
        kind="system_event",
        direction="internal",
        role="system",
        author_agent_id=run.agent_id,
        body_text=body,
        body_preview=body[:200],
        metadata_json=json.dumps({"kind": "subagent", **_row_meta(run, agent_name)}),
        received_at=datetime.utcnow(),
    )
    session.add(row)
    await session.flush()
    return row.id


def _row_meta(run: AgentRun, agent_name: str) -> dict[str, Any]:
    data = serialize_run(run, agent_name)
    data["result_preview"] = data.pop("result")[:280]
    return data


async def _refresh_row(session: AsyncSession, run: AgentRun) -> None:
    meta = _meta(run)
    row_id = meta.get("row_id")
    if not row_id:
        return
    row = await session.get(SignalMessage, UUID(row_id))
    if row is None:
        return
    row.metadata_json = json.dumps({"kind": "subagent", **_row_meta(run, meta.get("agent_name") or "")})
    session.add(row)
    await session.flush()
    signal = await session.get(Signal, row.signal_id)
    if signal is not None:
        from app.gateway.publish import publish_signal_message

        try:
            await publish_signal_message(signal, row)
        except Exception:  # noqa: BLE001
            logger.info("subagent row publish skipped for %s", row.id)


# --- Tools --------------------------------------------------------------------


async def spawn(ctx: Any, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.models.auth import Tenant
    from app.services.agent_definition import resolve_subagent_seat
    from app.services.agent.style import strip_emoji

    session: AsyncSession = ctx.session
    prompt = str(tool_input.get("prompt") or "").strip()
    if not prompt:
        return {"error": "prompt required"}
    if await _is_child_run(session, ctx.run_id):
        return {"error": f"Subagents cannot start subagents (max depth {MAX_DEPTH})", "status": "denied"}
    tenant = await session.get(Tenant, ctx.tenant_id)

    child: Agent | None = ctx.agent
    if tool_input.get("agent_id"):
        try:
            child = await session.get(Agent, UUID(str(tool_input["agent_id"])))
        except ValueError:
            child = None
    if child is None or child.tenant_id != ctx.tenant_id or not child.is_active:
        return {"error": "Target agent not found in this workspace"}

    try:
        seat = resolve_subagent_seat(
            tenant,
            child,
            ctx.agent,
            explicit_model=str(tool_input.get("model") or ""),
            role_name=str(tool_input.get("role") or ""),
            persona_name=str(tool_input.get("persona") or ""),
        )
    except ValueError as exc:
        return {"error": str(exc)}

    checkpoint = "[]"
    resume_from = str(tool_input.get("resume_from") or "").strip()
    if resume_from:
        try:
            previous = await session.get(AgentRun, UUID(resume_from))
        except ValueError:
            previous = None
        if (
            previous is None
            or previous.tenant_id != ctx.tenant_id
            or previous.run_role != "delegate"
            or previous.status != "completed"
            or previous.agent_id != child.id
        ):
            return {"error": "resume_from must be a completed subagent of the same agent"}
        checkpoint = previous.checkpoint_json or "[]"

    cfg = limits(tenant)
    status = "running"
    if await _active_count(session, ctx.tenant_id) >= cfg["max_concurrent"]:
        if cfg["limit_behavior"] == "fail":
            return {
                "error": "QuotaExceeded",
                "detail": f"{cfg['max_concurrent']} subagents are already running",
                "status": "denied",
            }
        status = "queued"

    background = bool(tool_input.get("run_in_background", True))
    description = strip_emoji(str(tool_input.get("description") or "")).strip()[:200] or prompt[:80]
    run = AgentRun(
        tenant_id=ctx.tenant_id,
        agent_id=child.id,
        project_id=ctx.project_id,
        status=status,
        trigger_type="subagent",
        subject=description,
        signal_id=ctx.signal_id,
        parent_run_id=ctx.run_id,
        run_role="delegate",
        checkpoint_json=checkpoint,
        runtime_snapshot_json=json.dumps(
            {
                "kind": "subagent",
                "prompt": prompt[:8000],
                "description": description,
                "background": background,
                "model": seat.model,
                "capability_mode": seat.capability_mode,
                "persona": seat.persona.name if seat.persona else "",
                "role": seat.role.name if seat.role else "",
                "parent_agent_id": str(ctx.agent.id) if ctx.agent is not None else "",
                "parent_user_id": str(ctx.user_id) if ctx.user_id else "",
                "agent_name": child.name,
                "resumed_from": resume_from,
            }
        ),
    )
    session.add(run)
    await session.flush()
    row_id = await _post_row(session, run, child.name)
    if row_id:
        meta = _meta(run)
        meta["row_id"] = str(row_id)
        run.runtime_snapshot_json = json.dumps(meta)
        session.add(run)
    await session.commit()

    if status == "queued":
        return {
            "run_id": str(run.id),
            "status": "queued",
            "note": "Queued until a running subagent finishes. You get the result in this conversation.",
        }
    if background:
        await _start(session, run.id)
        return {
            "run_id": str(run.id),
            "status": "running",
            "note": "Runs in the background. Its result arrives in this conversation; end your turn or keep working.",
        }

    task = _start_local(session, run.id)
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=INLINE_WAIT_SECONDS)
    except TimeoutError:
        await _mark_background(session, run.id)
        return {
            "run_id": str(run.id),
            "status": "running",
            "note": "Still running after 120 seconds. It continues in the background and reports here.",
        }
    await session.refresh(run)
    return serialize_run(run, child.name)


async def output(ctx: Any, tool_input: dict[str, Any]) -> dict[str, Any]:
    try:
        run = await _own_child(ctx.session, ctx, tool_input.get("run_id"))
    except SubagentError as exc:
        return {"error": str(exc)}
    await ctx.session.refresh(run)
    return serialize_run(run)


async def kill(ctx: Any, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.agent.run_cancel import request_cancel

    try:
        run = await _own_child(ctx.session, ctx, tool_input.get("run_id"))
    except SubagentError as exc:
        return {"error": str(exc)}
    if run.status not in ACTIVE:
        return {"run_id": str(run.id), "status": run.status, "note": "Already finished"}
    request_cancel(run.id)
    run.status = "cancelled"
    run.stop_reason = "user_interrupt"
    run.completed_at = datetime.utcnow()
    ctx.session.add(run)
    await _refresh_row(ctx.session, run)
    await ctx.session.commit()
    task = _LOCAL_TASKS.get(run.id)
    if task is not None and not task.done():
        task.cancel()
    return {"run_id": str(run.id), "status": "cancelled"}


async def send_message(ctx: Any, tool_input: dict[str, Any]) -> dict[str, Any]:
    session: AsyncSession = ctx.session
    try:
        run = await _own_child(session, ctx, tool_input.get("run_id"))
    except SubagentError as exc:
        return {"error": str(exc)}
    body = str(tool_input.get("message") or "").strip()
    if not body:
        return {"error": "message required"}
    delivery = str(tool_input.get("delivery") or "steer")
    if delivery not in DELIVERIES:
        return {"error": "delivery is steer, queue or interject"}
    if run.status not in ACTIVE:
        return {"error": "That subagent has finished. Start it again with resume_from to continue it."}

    in_flight = int(
        (
            await session.execute(
                select(func.count())
                .select_from(SubagentMessage)
                .where(
                    SubagentMessage.target_run_id == run.id,
                    SubagentMessage.sender_run_id == ctx.run_id
                    if ctx.run_id is not None
                    else SubagentMessage.sender_run_id.is_(None),
                    SubagentMessage.status == "pending",
                )
            )
        ).scalar_one()
    )
    if in_flight >= MAX_IN_FLIGHT_PER_PAIR:
        return {"error": "QuotaExceeded", "detail": f"{MAX_IN_FLIGHT_PER_PAIR} messages are still undelivered"}
    attempt = ctx.bundle_id or str(ctx.run_id or "")
    if attempt and _OUTBOUND.get(attempt, 0) >= MAX_OUTBOUND_PER_ATTEMPT:
        return {"error": "QuotaExceeded", "detail": f"At most {MAX_OUTBOUND_PER_ATTEMPT} messages per turn"}
    if attempt:
        if len(_OUTBOUND) > 2000:
            _OUTBOUND.clear()
        _OUTBOUND[attempt] = _OUTBOUND.get(attempt, 0) + 1

    row = SubagentMessage(
        tenant_id=ctx.tenant_id,
        target_run_id=run.id,
        sender_run_id=ctx.run_id,
        body=body[:4000],
        delivery=delivery,
    )
    session.add(row)
    await session.commit()
    return {"message_id": str(row.id), "status": "pending", "delivery": delivery}


# --- Delivery into a running child -------------------------------------------


async def take_messages(session: AsyncSession, run_id: UUID, *, deliveries: tuple[str, ...]) -> list[str]:
    """Pending messages for a child, interject first, marked delivered."""
    rows = list(
        (
            await session.execute(
                select(SubagentMessage)
                .where(
                    SubagentMessage.target_run_id == run_id,
                    SubagentMessage.status == "pending",
                    SubagentMessage.delivery.in_(deliveries),
                )
                .order_by(SubagentMessage.created_at)
            )
        ).scalars()
    )
    rows.sort(key=lambda r: 0 if r.delivery == "interject" else 1)
    now = datetime.utcnow()
    for row in rows:
        row.status = "delivered"
        row.delivered_at = now
        session.add(row)
    if rows:
        await session.flush()
    return [r.body for r in rows]


def reminder(bodies: list[str]) -> str:
    joined = "\n\n".join(bodies)
    return f"<system-reminder>\nMessage from the agent that started you:\n{joined}\n</system-reminder>"


# --- Execution ------------------------------------------------------------------


def _start_local(session: AsyncSession, run_id: UUID) -> asyncio.Task:
    factory = _session_factory(session)

    async def _go() -> None:
        async with factory() as child_session:
            await execute(child_session, run_id)

    task = asyncio.create_task(_go())
    _LOCAL_TASKS[run_id] = task
    task.add_done_callback(lambda _t: _LOCAL_TASKS.pop(run_id, None))
    return task


async def _start(session: AsyncSession, run_id: UUID) -> None:
    """Background start: the worker when Redis is up, else this process."""
    try:
        from app.workers.tasks import _get_arq_pool

        pool = await _get_arq_pool()
        await pool.enqueue_job("run_subagent_job", str(run_id))
        return
    except Exception:  # noqa: BLE001
        logger.info("subagent %s runs in-process (no worker queue)", run_id)
    _start_local(session, run_id)


async def _mark_background(session: AsyncSession, run_id: UUID) -> None:
    run = await session.get(AgentRun, run_id)
    if run is None:
        return
    await session.refresh(run)
    meta = _meta(run)
    meta["background"] = True
    run.runtime_snapshot_json = json.dumps(meta)
    session.add(run)
    await session.commit()


def _runtime_agent(agent: Agent, meta: dict[str, Any]) -> Agent:
    from app.services.orchestration.profiles import apply_snapshot_to_agent, resolve_runtime_snapshot

    snapshot = resolve_runtime_snapshot(agent)
    if meta.get("model"):
        snapshot["model"] = meta["model"]
    runtime = apply_snapshot_to_agent(agent, snapshot)
    if meta.get("capability_mode"):
        runtime.capability_mode = meta["capability_mode"]
    return runtime


async def _extra_context(session: AsyncSession, run: AgentRun, meta: dict[str, Any]) -> str:
    from app.models.auth import Tenant
    from app.services.agent_definition import tenant_personas, tenant_roles

    parent_name = "the agent that started you"
    if meta.get("parent_agent_id"):
        parent = await session.get(Agent, UUID(meta["parent_agent_id"]))
        if parent is not None:
            parent_name = parent.name
    parts = [
        "## You are a subagent\n"
        f"{parent_name} gave you one piece of work. You have your own context: the "
        "conversation it came from is not in front of you, only the brief. Your final "
        "message is returned to them as the result, so make it the result itself: "
        "complete, plain, no greeting. You do not talk to the customer or the team, "
        "and you cannot start subagents."
    ]
    tenant = await session.get(Tenant, run.tenant_id)
    persona = tenant_personas(tenant).get(meta.get("persona") or "")
    role = tenant_roles(tenant).get(meta.get("role") or "")
    if persona is not None:
        lines = [persona.instructions]
        if persona.outputs:
            lines.append("Return these outputs: " + ", ".join(o["name"] for o in persona.outputs))
        parts.append("<system-reminder>\n" + "\n\n".join(lines) + "\n</system-reminder>")
    if role is not None and role.instructions:
        parts.append(f"## Role: {role.name}\n{role.instructions}")
    return "\n\n".join(parts)


async def execute(session: AsyncSession, run_id: UUID) -> dict[str, Any]:
    """Run one child to its end, record the result, wake the parent."""
    from app.services.chat_runtime import build_agent_loop

    run = await session.get(AgentRun, run_id)
    if run is None or run.status not in ACTIVE:
        return {"ok": False, "reason": "not_active"}
    if run.status == "queued":
        from app.models.auth import Tenant

        tenant = await session.get(Tenant, run.tenant_id)
        if await _active_count(session, run.tenant_id) >= limits(tenant)["max_concurrent"]:
            return {"ok": False, "reason": "still_queued"}
        run.status = "running"
        run.started_at = datetime.utcnow()
        session.add(run)
        await session.commit()

    meta = _meta(run)
    agent = await session.get(Agent, run.agent_id)
    if agent is None:
        run.status = "failed"
        session.add(run)
        await session.commit()
        return {"ok": False, "reason": "agent_missing"}

    try:
        checkpoint = json.loads(run.checkpoint_json or "[]")
    except json.JSONDecodeError:
        checkpoint = []
    messages = [m for m in checkpoint if isinstance(m, dict)] if isinstance(checkpoint, list) else []
    messages.append({"role": "user", "content": meta.get("prompt") or run.subject})

    user_id = UUID(meta["parent_user_id"]) if meta.get("parent_user_id") else None
    loop = build_agent_loop(
        session,
        tenant_id=run.tenant_id,
        user_id=user_id,
        agent=_runtime_agent(agent, meta),
        signal_id=None,
        tool_signal_id=run.signal_id,
        trust="agent",
        run=run,
        surface="subagent",
    )
    loop.tools = [t for t in loop.tools if t["name"] not in SUBAGENT_TOOLS]
    loop.subagent_run_id = run.id
    loop.usage_scope = "orchestration"
    loop.usage_call_type = "subagent"

    text = ""
    error = ""
    try:
        text, tokens = await loop.run_chat(messages, extra_context=await _extra_context(session, run, meta))
        run.tokens_input = int(tokens.get("input_tokens", 0))
        run.tokens_output = int(tokens.get("output_tokens", 0))
    except asyncio.CancelledError:
        error = "cancelled"
    except Exception as exc:  # noqa: BLE001
        logger.exception("subagent %s failed", run_id)
        error = str(exc)[:300] or exc.__class__.__name__
        try:
            await session.rollback()
        except Exception:  # noqa: BLE001
            pass

    await session.refresh(run)
    if run.status == "cancelled" or error == "cancelled":
        run.status = "cancelled"
        run.stop_reason = run.stop_reason or "user_interrupt"
    elif error:
        run.status = "failed"
        run.result_json = json.dumps({"text": "", "error": error})
    else:
        run.status = "completed"
        run.stop_reason = getattr(loop, "stop_reason", "") or "end_turn"
        run.result_json = json.dumps({"text": text[:RESULT_CHARS]})
        run.checkpoint_json = json.dumps([*messages, {"role": "assistant", "content": text}][-40:])
    run.completed_at = datetime.utcnow()
    session.add(run)
    await _refresh_row(session, run)
    await session.commit()

    await _wake_parent(session, run)
    await _start_next_queued(session, run.tenant_id)
    return {"ok": run.status == "completed", "status": run.status}


async def _wake_parent(session: AsyncSession, run: AgentRun) -> None:
    from app.services.agent_turns import enqueue_turn

    meta = _meta(run)
    if not meta.get("background", True) or not meta.get("parent_agent_id") or run.signal_id is None:
        return
    signal = await session.get(Signal, run.signal_id)
    if signal is None:
        return
    name = meta.get("agent_name") or "The subagent"
    if run.status == "completed":
        body = _result_text(run)[:3000] or "(no text)"
        prompt = (
            f'{name} finished the subagent work "{meta.get("description") or run.subject}" '
            f"(run {run.id}). Result:\n{body}\n\n"
            "Continue the work for the person who asked you, using this result."
        )
    else:
        prompt = (
            f'{name} did not finish the subagent work "{meta.get("description") or run.subject}" '
            f"({run.status}). Continue without it or tell the person in one sentence."
        )
    try:
        await enqueue_turn(
            session,
            signal,
            agent_id=UUID(meta["parent_agent_id"]),
            cause_kind="subagent_result",
            requested_by_kind="system",
            prompt=prompt,
            idempotency_key=f"subagent:{run.id}",
        )
        await session.commit()
    except Exception:  # noqa: BLE001
        logger.exception("waking parent for subagent %s failed", run.id)
        await session.rollback()


async def _start_next_queued(session: AsyncSession, tenant_id: UUID) -> None:
    nxt = (
        await session.execute(
            select(AgentRun)
            .where(
                AgentRun.tenant_id == tenant_id,
                AgentRun.run_role == "delegate",
                AgentRun.status == "queued",
            )
            .order_by(AgentRun.started_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    if nxt is not None:
        await _start(session, nxt.id)


async def transcript(session: AsyncSession, tenant_id: UUID, signal_id: UUID, run_id: UUID) -> dict[str, Any] | None:
    """Child run for the thread row: status, result, and its event log."""
    from app.models.agent import RunEvent

    run = await session.get(AgentRun, run_id)
    if run is None or run.tenant_id != tenant_id or run.signal_id != signal_id or run.run_role != "delegate":
        return None
    agent = await session.get(Agent, run.agent_id)
    events = (
        await session.execute(
            select(RunEvent).where(RunEvent.run_id == run.id).order_by(RunEvent.sequence, RunEvent.id).limit(200)
        )
    ).scalars().all()
    data = serialize_run(run, agent.name if agent else "")
    data["events"] = [
        {"type": e.event_type, "message": e.message[:500], "detail_level": e.detail_level} for e in events
    ]
    return data
