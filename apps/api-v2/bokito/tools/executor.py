"""Tool executor: validate, evaluate policy, run, record.

Outcome shapes (`ToolOutcome.status`):
- done      handler ran; `result` holds its return value
- decision  the policy said ask; a Decision was created in the conversation
- denied    the policy said deny (also raised as `Denied` when `raise_on_deny`)
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.deps import Principal
from bokito.domain.base import utcnow
from bokito.domain.conversation import Conversation
from bokito.domain.identity import Posture
from bokito.domain.orient import SignalType
from bokito.domain.work import Agent, Run, RunEvent, RunKind, RunStatus
from bokito.errors import AppError, Denied, NotFound
from bokito.services import audit
from bokito.services import policy as policy_svc
from bokito.tools.registry import ToolContext, ToolDef, registry

log = logging.getLogger(__name__)


class InvalidToolArgs(AppError):
    status_code = 422
    code = "invalid_tool_args"


class ToolFailed(AppError):
    status_code = 500
    code = "tool_failed"


@dataclass
class ToolOutcome:
    status: str
    run_id: uuid.UUID
    result: Any = None
    decision_id: uuid.UUID | None = None
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "run_id": str(self.run_id),
            "result": self.result,
            "decision_id": str(self.decision_id) if self.decision_id else None,
            "reason": self.reason,
        }


def _serialisable(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _serialisable(v) for k, v in value.items()}
    if isinstance(value, list | tuple | set):
        return [_serialisable(v) for v in value]
    if hasattr(value, "model_dump"):
        return _serialisable(value.model_dump(mode="json"))
    return str(value)


async def _caps(
    session: AsyncSession, conversation: Conversation | None, agent_id: uuid.UUID | None
) -> list[Posture | None]:
    caps: list[Posture | None] = []
    if agent_id:
        agent = await session.get(Agent, agent_id)
        if agent:
            caps.append(agent.autonomy_cap)
    if conversation and conversation.signal_type_id:
        st = await session.get(SignalType, conversation.signal_type_id)
        if st:
            caps.append(st.autonomy_cap)
    return caps


async def _event(
    session: AsyncSession, run: Run, seq: int, kind: str, payload: dict[str, Any]
) -> None:
    session.add(
        RunEvent(
            tenant_id=run.tenant_id,
            run_id=run.id,
            seq=seq,
            kind=kind,
            payload=payload,
            created_at=utcnow(),
        )
    )


async def execute_tool(
    session: AsyncSession,
    principal: Principal,
    name: str,
    args: dict[str, Any] | None = None,
    *,
    conversation_id: uuid.UUID | None = None,
    parent_run_id: uuid.UUID | None = None,
    skip_policy: bool = False,
    raise_on_deny: bool = True,
) -> ToolOutcome:
    tool: ToolDef | None = registry.get(name)
    if tool is None:
        raise NotFound(f"unknown tool {name}", code="unknown_tool")
    if principal.trust not in tool.trusts:
        raise Denied(f"tool {name} is not available for {principal.trust}", code="tool_trust")
    if tool.module:
        from bokito.services import modules as modules_svc

        if tool.module not in await modules_svc.installed_slugs(session, principal.tenant_id):
            raise Denied(
                f"tool {name} belongs to module {tool.module}, which is not installed",
                code="module_not_installed",
            )

    try:
        parsed = tool.input_model.model_validate(args or {})
    except ValidationError as exc:
        raise InvalidToolArgs(
            f"invalid arguments for {name}", code="invalid_tool_args", details=exc.errors()
        ) from exc

    conversation = None
    if conversation_id:
        conversation = await session.get(Conversation, conversation_id)
        if conversation and conversation.tenant_id != principal.tenant_id:
            raise NotFound("conversation not found", code="conversation_not_found")

    run = Run(
        tenant_id=principal.tenant_id,
        kind=RunKind.tool,
        status=RunStatus.running,
        title=name,
        actor=principal.actor,
        trust=principal.trust,
        conversation_id=conversation_id,
        agent_id=principal.agent_id,
        parent_run_id=parent_run_id,
        tool_name=name,
        input=_serialisable(parsed.model_dump(mode="json")),
        created_at=utcnow(),
        started_at=utcnow(),
    )
    session.add(run)
    await session.flush()

    if not skip_policy:
        pol = await policy_svc.get_policy(session, principal.tenant_id)
        caps = await _caps(session, conversation, principal.agent_id)
        ev = policy_svc.evaluate(
            pol,
            tool_name=name,
            category=tool.category,
            consequential=tool.consequential,
            trust=principal.trust,
            caps=caps,
        )
        await _event(session, run, 0, "policy", {"verdict": ev.verdict, "reason": ev.reason})
        if ev.verdict == "deny":
            run.status = RunStatus.failed
            run.error = ev.reason
            run.finished_at = utcnow()
            await audit.record(
                session,
                principal.tenant_id,
                actor=principal.actor,
                trust=principal.trust,
                action="tool.denied",
                target_kind="tool",
                target_id=name,
                conversation_id=conversation_id,
                run_id=run.id,
                payload={"reason": ev.reason},
            )
            if raise_on_deny:
                raise Denied(ev.reason, code="policy_denied")
            return ToolOutcome("denied", run.id, reason=ev.reason)
        if ev.verdict == "ask":
            from bokito.services import decision as decision_svc

            if conversation is None:
                conversation = await decision_svc.govern_conversation(session, principal.tenant_id)
                run.conversation_id = conversation.id
            decision = await decision_svc.create(
                session,
                conversation,
                title=f"Approve {tool.name.replace('_', ' ').replace('.', ' ')}",
                summary=tool.description,
                tool_call={
                    "name": name,
                    "args": run.input,
                    "principal": _principal_dict(principal),
                },
                requested_by=principal.actor,
                run_id=run.id,
            )
            run.status = RunStatus.waiting
            await _event(session, run, 1, "decision", {"decision_id": str(decision.id)})
            await session.flush()
            return ToolOutcome("decision", run.id, decision_id=decision.id, reason=ev.reason)

    ctx = ToolContext(
        session=session,
        principal=principal,
        tenant_id=principal.tenant_id,
        run_id=run.id,
        conversation_id=conversation_id or run.conversation_id,
        agent_id=principal.agent_id,
    )
    try:
        result = await tool.handler(ctx, parsed)
    except AppError as exc:
        run.status = RunStatus.failed
        run.error = f"{exc.code}: {exc.message}"
        run.finished_at = utcnow()
        await _event(session, run, 2, "error", {"code": exc.code, "message": exc.message})
        await session.flush()
        raise
    except Exception as exc:
        log.exception("tool %s failed", name)
        run.status = RunStatus.failed
        run.error = str(exc)[:2000]
        run.finished_at = utcnow()
        await _event(session, run, 2, "error", {"message": str(exc)[:500]})
        await session.flush()
        raise ToolFailed(f"{name} failed", code="tool_failed") from exc

    serial = _serialisable(result)
    run.status = RunStatus.done
    run.output = serial if isinstance(serial, dict) else {"value": serial}
    run.finished_at = utcnow()
    await _event(session, run, 2, "result", {"ok": True})
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action=f"tool.{name}",
        target_kind="tool",
        target_id=name,
        conversation_id=run.conversation_id,
        run_id=run.id,
        payload={"args": run.input},
    )
    await session.flush()
    return ToolOutcome("done", run.id, result=serial)


def _principal_dict(p: Principal) -> dict[str, Any]:
    return {
        "trust": p.trust,
        "tenant_id": str(p.tenant_id),
        "user_id": str(p.user_id) if p.user_id else None,
        "agent_id": str(p.agent_id) if p.agent_id else None,
        "contact_id": str(p.contact_id) if p.contact_id else None,
        "role": p.role.value if p.role else None,
        "scopes": list(p.scopes),
    }


def principal_from_dict(data: dict[str, Any]) -> Principal:
    from bokito.domain.identity import Role

    return Principal(
        trust=data.get("trust", "system"),
        tenant_id=uuid.UUID(data["tenant_id"]),
        user_id=uuid.UUID(data["user_id"]) if data.get("user_id") else None,
        agent_id=uuid.UUID(data["agent_id"]) if data.get("agent_id") else None,
        contact_id=uuid.UUID(data["contact_id"]) if data.get("contact_id") else None,
        role=Role(data["role"]) if data.get("role") else None,
        scopes=list(data.get("scopes") or []),
    )
