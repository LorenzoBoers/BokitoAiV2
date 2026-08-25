"""Workforce runtime service (agents, work logs, messages, graph controls)."""

import json
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun, RunEvent
from app.models.notification import DecisionRequest
from app.models.project import Project

ROLE_SLUG_MAP = {
    "po": "orchestrator",
    "orchestrator": "orchestrator",
    "manager": "orchestrator",
    "assistant": "assistant",
    "communication": "communication",
    "coding": "builder",
    "orchestra": "orchestra",
}

ROLE_NAME_MAP = {
    "po": "Orchestrator",
    "orchestrator": "Orchestrator",
    "manager": "Orchestrator",
    "assistant": "Assistant",
    "communication": "Communication",
    "coding": "Builder",
    "orchestra": "Orchestra",
}


def tenant_numeric_id(tenant_id: UUID) -> int:
    return int(tenant_id.hex[:8], 16)


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return base or "agent"


def _ms(value: datetime | None) -> int:
    if not value:
        return 0
    return int(value.timestamp() * 1000)


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def role_slug(agent: Agent) -> str:
    if agent.slug and agent.slug in ROLE_SLUG_MAP.values():
        return agent.slug
    return ROLE_SLUG_MAP.get(agent.role, agent.role)


def serialize_runtime_agent(agent: Agent, *, latest_run: AgentRun | None = None) -> dict[str, Any]:
    org_id = str(tenant_numeric_id(agent.tenant_id))
    slug = agent.slug or _slugify(agent.name)
    rslug = role_slug(agent)
    status = agent.runtime_status or ("active" if agent.is_active else "standby")
    if status not in ("standby", "active", "sleeping", "error"):
        status = "standby"
    summary = agent.current_activity_summary or ""
    session_id = None
    activity_id = None
    if latest_run:
        session_id = str(latest_run.id)
        if latest_run.status == "running":
            activity_id = str(latest_run.id)
            if not summary:
                summary = latest_run.subject or "Running"
    return {
        "id": str(agent.id),
        "organisation_id": org_id,
        "name": agent.name,
        "slug": slug,
        "role_id": rslug,
        "role_name": ROLE_NAME_MAP.get(agent.role, agent.name),
        "role_slug": rslug,
        "parent_agent_id": str(agent.parent_agent_id) if agent.parent_agent_id else None,
        "status": status,
        "model": agent.model,
        "provider": agent.provider,
        "system_prompt": agent.system_prompt or "",
        "chat_access": agent.chat_access,
        "kind": agent.kind,
        "email_signature_html": str(
            _parse_json(agent.settings_json).get("email_signature_html") or ""
        ),
        "current_session_id": session_id,
        "current_activity_id": activity_id,
        "current_activity_summary": summary or None,
        "updated_at": _ms(agent.updated_at or agent.created_at),
    }


# Roles a workspace admin may pick when creating a worker agent. Orchestrators
# are created via the project orchestrator flow, not here.
CREATABLE_AGENT_ROLES = ("assistant", "communication", "builder", "orchestra")


async def list_runtime_agents(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(Agent)
        .where(Agent.tenant_id == tenant_id, Agent.kind == "company")
        .order_by(Agent.updated_at.desc())
    )
    agents = list(result.scalars().all())
    if not agents:
        return []
    # Latest run per agent in one query (avoids N+1 on the agents list).
    runs_result = await session.execute(
        select(AgentRun)
        .where(
            AgentRun.tenant_id == tenant_id,
            AgentRun.agent_id.in_([a.id for a in agents]),
        )
        .order_by(AgentRun.started_at.desc())
    )
    latest_by_agent: dict[UUID, AgentRun] = {}
    for run in runs_result.scalars().all():
        if run.agent_id is not None and run.agent_id not in latest_by_agent:
            latest_by_agent[run.agent_id] = run
    return [
        serialize_runtime_agent(agent, latest_run=latest_by_agent.get(agent.id))
        for agent in agents
    ]


async def update_agent_runtime_status(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID, status: str
) -> dict[str, Any]:
    if status not in ("standby", "active", "sleeping", "error"):
        raise HTTPException(status_code=400, detail="Invalid status")
    result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent.runtime_status = status
    agent.is_active = status in ("active", "sleeping")
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return {"ok": True, "agent": serialize_runtime_agent(agent)}


async def archive_agent(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> dict[str, Any]:
    """Archive a company agent: hidden from the workforce list, history preserved.

    The default workspace assistant (slug 'assistant') cannot be archived.
    """
    result = await session.execute(
        select(Agent).where(
            Agent.id == agent_id, Agent.tenant_id == tenant_id, Agent.kind == "company"
        )
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if (agent.slug or "") == "assistant":
        raise HTTPException(status_code=409, detail="The default assistant cannot be archived")
    if agent.role == "assistant":
        other = await session.execute(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.kind == "company",
                Agent.role == "assistant",
                Agent.id != agent_id,
            )
        )
        if not other.scalars().first():
            raise HTTPException(
                status_code=409, detail="The last assistant cannot be archived"
            )
    agent.kind = "archived"
    agent.is_active = False
    agent.runtime_status = "standby"
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    await session.commit()
    return {"ok": True, "id": str(agent_id)}


async def update_agent_model(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID, model_slug: str
) -> dict[str, Any]:
    """Set an agent's chat model, validated against tenant-enabled models."""
    from app.services import provider_connections, tenant_model_catalog as tmc
    from app.services.model_catalog import get_model
    from app.services.tenant_models import get_tenant_model_prefs, is_chat_model_allowed

    result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    provider_type = ""
    if await tmc.tenant_has_models(session, tenant_id):
        model = await tmc.get_model(session, tenant_id, model_slug)
        if not model or model.kind != "chat" or not model.enabled:
            raise HTTPException(status_code=400, detail="Unknown or unavailable chat model")
        conn = await provider_connections.get_connection(session, tenant_id, model.connection_id)
        if not conn or not conn.enabled:
            raise HTTPException(status_code=400, detail="Provider connection unavailable")
        provider_type = conn.provider_type
        slug = model.slug
    else:
        model = await get_model(session, model_slug)
        if not model or model.kind != "chat" or not model.enabled:
            raise HTTPException(status_code=400, detail="Unknown or unavailable chat model")
        prefs = await get_tenant_model_prefs(session, tenant_id)
        if not is_chat_model_allowed(prefs, model.slug):
            raise HTTPException(status_code=403, detail="Model not permitted for this workspace")
        provider_type = model.provider
        slug = model.slug

    agent.model = slug
    agent.provider = provider_type
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return {"ok": True, "agent": serialize_runtime_agent(agent)}


async def create_agent(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str,
    role: str = "assistant",
    system_prompt: str = "",
    model_slug: str = "",
    chat_access: str = "everyone",
) -> dict[str, Any]:
    """Create a company worker agent, with its model validated against tenant models."""
    from app.services import provider_connections, tenant_model_catalog as tmc
    from app.services.model_catalog import get_default_model, get_model
    from app.services.tenant_models import get_tenant_model_prefs, is_chat_model_allowed

    clean_name = (name or "").strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Agent name is required")
    norm_role = role if role in CREATABLE_AGENT_ROLES else "assistant"
    if chat_access not in ("everyone", "selected", "nobody"):
        chat_access = "nobody"

    slug = ""
    provider_type = ""
    has_tenant = await tmc.tenant_has_models(session, tenant_id)

    if has_tenant:
        tenant_model = None
        if model_slug:
            tenant_model = await tmc.get_model(session, tenant_id, model_slug)
            if not tenant_model or tenant_model.kind != "chat" or not tenant_model.enabled:
                raise HTTPException(status_code=400, detail="Unknown or unavailable chat model")
        else:
            tenant_model = await tmc.get_default_model(session, tenant_id, "chat")
        if tenant_model:
            conn = await provider_connections.get_connection(
                session, tenant_id, tenant_model.connection_id
            )
            if conn and conn.enabled:
                slug = tenant_model.slug
                provider_type = conn.provider_type
    else:
        prefs = await get_tenant_model_prefs(session, tenant_id)
        model = None
        if model_slug:
            model = await get_model(session, model_slug)
            if not model or model.kind != "chat" or not model.enabled:
                raise HTTPException(status_code=400, detail="Unknown or unavailable chat model")
            if not is_chat_model_allowed(prefs, model.slug):
                raise HTTPException(status_code=403, detail="Model not permitted for this workspace")
        else:
            if prefs.get("default_chat"):
                model = await get_model(session, prefs["default_chat"])
            if not model:
                model = await get_default_model(session, "chat")
        if model:
            slug = model.slug
            provider_type = model.provider

    agent = Agent(
        tenant_id=tenant_id,
        name=clean_name,
        role=norm_role,
        kind="company",
        chat_access=chat_access,
        system_prompt=(system_prompt or "").strip(),
        slug=_slugify(clean_name),
        runtime_status="standby",
        is_active=True,
    )
    if slug:
        agent.model = slug
        agent.provider = provider_type
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return {"ok": True, "agent": serialize_runtime_agent(agent)}


async def update_agent(
    session: AsyncSession,
    tenant_id: UUID,
    agent_id: UUID,
    *,
    name: str | None = None,
    system_prompt: str | None = None,
    email_signature_html: str | None = None,
) -> dict[str, Any]:
    """Edit a company agent's identity (name), system prompt, and signature."""
    result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if not agent or agent.kind != "company":
        raise HTTPException(status_code=404, detail="Agent not found")
    if name is not None:
        clean = name.strip()
        if not clean:
            raise HTTPException(status_code=400, detail="Agent name cannot be empty")
        agent.name = clean
    if system_prompt is not None:
        agent.system_prompt = system_prompt.strip()
    if email_signature_html is not None:
        from app.services.signatures import MAX_SIGNATURE_LENGTH, SIGNATURE_KEY

        signature = email_signature_html.strip()
        if len(signature) > MAX_SIGNATURE_LENGTH:
            raise HTTPException(status_code=400, detail="Signature too long")
        stored = _parse_json(agent.settings_json)
        if signature:
            stored[SIGNATURE_KEY] = signature
        else:
            stored.pop(SIGNATURE_KEY, None)
        agent.settings_json = json.dumps(stored)
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return {"ok": True, "agent": serialize_runtime_agent(agent)}


def serialize_work_log(run: AgentRun) -> dict[str, Any]:
    tokens = (run.tokens_input or 0) + (run.tokens_output or 0)
    return {
        "id": str(run.id),
        "project_id": str(run.project_id) if run.project_id else "",
        "agent_id": str(run.agent_id),
        "task_subject": run.subject or None,
        "status": run.status,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.completed_at.isoformat() if run.completed_at else None,
        "tokens_used": tokens,
    }


async def list_work_logs(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    project_id: str | None = None,
    agent_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    query = select(AgentRun).where(AgentRun.tenant_id == tenant_id)
    if project_id:
        try:
            query = query.where(AgentRun.project_id == UUID(project_id))
        except ValueError:
            return []
    if agent_id:
        try:
            query = query.where(AgentRun.agent_id == UUID(agent_id))
        except ValueError:
            return []
    if status:
        query = query.where(AgentRun.status == status)
    query = query.order_by(AgentRun.started_at.desc()).limit(min(limit, 200))
    result = await session.execute(query)
    return [serialize_work_log(r) for r in result.scalars().all()]


async def get_work_log_events(
    session: AsyncSession, tenant_id: UUID, work_log_id: UUID
) -> dict[str, Any]:
    run_result = await session.execute(
        select(AgentRun).where(AgentRun.id == work_log_id, AgentRun.tenant_id == tenant_id)
    )
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Work log not found")
    events_result = await session.execute(
        select(RunEvent)
        .where(RunEvent.run_id == run.id, RunEvent.tenant_id == tenant_id)
        .order_by(RunEvent.created_at)
    )
    events = []
    for ev in events_result.scalars().all():
        payload = _parse_json(ev.payload_json)
        events.append(
            {
                "type": ev.event_type,
                "title": payload.get("title") or ev.event_type.replace("_", " ").title(),
                "body": ev.message or payload.get("body", ""),
                "payload": payload,
            }
        )
    if not events:
        events.append(
            {
                "type": "run_started",
                "title": "Run started",
                "body": run.subject or "Agent run started",
                "payload": {"status": run.status},
            }
        )
    tokens = (run.tokens_input or 0) + (run.tokens_output or 0)
    return {
        "events": events,
        "status": run.status,
        "task_subject": run.subject or None,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.completed_at.isoformat() if run.completed_at else None,
        "tokens_used": tokens,
    }


async def ensure_run_events(session: AsyncSession, run: AgentRun) -> None:
    existing = await session.execute(select(RunEvent).where(RunEvent.run_id == run.id).limit(1))
    if existing.scalar_one_or_none():
        return
    session.add(
        RunEvent(
            run_id=run.id,
            tenant_id=run.tenant_id,
            event_type="run_started",
            message=run.subject or "Run started",
            payload_json=json.dumps({"title": "Run started"}),
        )
    )
    if run.status in ("completed", "failed"):
        session.add(
            RunEvent(
                run_id=run.id,
                tenant_id=run.tenant_id,
                event_type=f"run_{run.status}",
                message=f"Run {run.status}",
                payload_json=json.dumps({"title": f"Run {run.status}"}),
            )
        )


def serialize_message(row: DecisionRequest) -> dict[str, Any]:
    from app.services.decisions import serialize_decision_as_message

    return serialize_decision_as_message(row)


async def list_messages(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    status: str | None = None,
    message_type: str | None = None,
    channel: str | None = None,
    thread_id: str | None = None,
    project_id: str | None = None,
) -> list[dict[str, Any]]:
    from app.services.decisions import list_decision_messages

    return await list_decision_messages(
        session,
        tenant_id,
        status=status,
        message_type=message_type,
        channel=channel,
        thread_id=thread_id,
        project_id=project_id,
    )


async def resolve_message(
    session: AsyncSession,
    tenant_id: UUID,
    message_id: UUID,
    *,
    new_status: str,
    user_id: UUID | None = None,
    defer_days: int | None = None,
) -> None:
    from app.services.decisions import resolve_decision_message

    action_map = {"done": "approved", "rejected": "rejected", "deferred": "deferred"}
    await resolve_decision_message(
        session,
        tenant_id,
        message_id,
        action=action_map.get(new_status, new_status),
        user_id=user_id,
    )
    # A defer with a horizon snoozes the linked thread until then, so it
    # resurfaces in the inbox instead of silently disappearing.
    if new_status == "deferred" and defer_days and defer_days > 0:
        from app.models.signal import Signal

        decision = (
            await session.execute(
                select(DecisionRequest).where(
                    DecisionRequest.id == message_id,
                    DecisionRequest.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if decision and decision.signal_id:
            signal = (
                await session.execute(
                    select(Signal).where(
                        Signal.id == decision.signal_id, Signal.tenant_id == tenant_id
                    )
                )
            ).scalar_one_or_none()
            if signal and signal.status == "open":
                signal.status = "pending"
                signal.snoozed_until = datetime.utcnow() + timedelta(days=defer_days)
                signal.updated_at = datetime.utcnow()
                session.add(signal)
                await session.commit()


def default_workforce_config(tenant_id: UUID) -> dict[str, Any]:
    org = tenant_numeric_id(tenant_id)
    now = _ms(datetime.utcnow())
    return {
        "id": org,
        "organisation_id": org,
        "enabled": True,
        "autonomy_level": "medium",
        "check_interval_sec": 300,
        "max_retry_per_feature": 3,
        "allow_verdict_override": True,
        "sleep_mode": "hybrid",
        "last_wake_at": now,
        "next_wake_at": now + 300_000,
        "updated_at": now,
    }


# Keys a tenant may override; everything else in the config dict is derived.
WORKFORCE_CONFIG_KEYS = (
    "enabled",
    "autonomy_level",
    "check_interval_sec",
    "max_retry_per_feature",
    "allow_verdict_override",
    "sleep_mode",
)


async def get_workforce_config(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    """Defaults merged with the tenant's persisted overrides."""
    from app.models.auth import Tenant

    config = default_workforce_config(tenant_id)
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    if tenant:
        settings = json.loads(tenant.settings_json or "{}")
        stored = settings.get("workforce_config")
        if isinstance(stored, dict):
            for key in WORKFORCE_CONFIG_KEYS:
                if key in stored:
                    config[key] = stored[key]
            if stored.get("updated_at"):
                config["updated_at"] = stored["updated_at"]
    return config


async def update_workforce_config(
    session: AsyncSession, tenant_id: UUID, patch: dict[str, Any]
) -> dict[str, Any]:
    """Persist overridable keys into tenant settings and return the result."""
    from app.models.auth import Tenant

    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    settings = json.loads(tenant.settings_json or "{}")
    stored = settings.get("workforce_config")
    if not isinstance(stored, dict):
        stored = {}
    for key, value in patch.items():
        if key in WORKFORCE_CONFIG_KEYS and value is not None:
            stored[key] = value
    stored["updated_at"] = _ms(datetime.utcnow())
    settings["workforce_config"] = stored
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    return await get_workforce_config(session, tenant_id)


async def get_workforce_status(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    config = await get_workforce_config(session, tenant_id)
    agents = await list_runtime_agents(session, tenant_id)
    timeline = await list_timeline(session, tenant_id)
    recent_tasks = [
        {
            "id": i + 1,
            "organisation_id": config["organisation_id"],
            "pipeline_id": 1,
            "feature_id": i + 1,
            "task_type": "agent_run",
            "status": a.get("status", "standby"),
            "attempt": 1,
            "payload": None,
            "planned_for": a.get("updated_at", 0),
            "completed_at": 0,
            "result_summary": a.get("current_activity_summary") or "",
            "created_at": a.get("updated_at", 0),
            "updated_at": a.get("updated_at", 0),
        }
        for i, a in enumerate(agents[:5])
    ]
    recent_logs = [
        {
            "id": i + 1,
            "organisation_id": config["organisation_id"],
            "pipeline_id": 1,
            "feature_id": 0,
            "task_id": 0,
            "level": "info",
            "action_type": "status",
            "message": t.get("title") or "Activity",
            "metadata": t.get("result"),
            "created_at": t.get("updated_at") or t.get("created_at") or 0,
        }
        for i, t in enumerate(timeline[:10])
    ]
    return {
        "config": config,
        "pipelines": [{"id": 1, "name": "Default", "status": "active"}],
        "recent_tasks": recent_tasks,
        "recent_logs": recent_logs,
    }


async def list_timeline(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(AgentRun, Agent)
        .join(Agent, Agent.id == AgentRun.agent_id)
        .where(AgentRun.tenant_id == tenant_id)
        .order_by(AgentRun.started_at.desc())
        .limit(40)
    )
    org = str(tenant_numeric_id(tenant_id))
    items: list[dict[str, Any]] = []
    for run, agent in result.all():
        ended = run.completed_at is not None
        atype = "completed" if run.status == "completed" else "failed" if run.status == "failed" else "executing"
        if ended and run.status == "completed":
            atype = "completed"
        items.append(
            {
                "id": str(run.id),
                "organisation_id": org,
                "agent_id": str(agent.id),
                "session_id": str(run.id),
                "task_id": str(run.project_id) if run.project_id else None,
                "title": run.subject or f"{agent.name} run",
                "description": run.subject,
                "type": atype,
                "status_detail": run.status,
                "planned_for": None,
                "started_at": _ms(run.started_at),
                "ended_at": _ms(run.completed_at) if ended else None,
                "result": _parse_json(run.result_json) or None,
                "created_at": _ms(run.started_at),
                "updated_at": _ms(run.completed_at or run.started_at),
            }
        )
    return items


async def trigger_agent(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    agent_id: UUID,
    instruction: str,
    project_id: UUID | None = None,
) -> dict[str, Any]:
    agent_result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not project_id:
        proj = await session.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.po_agent_id == agent.id).limit(1)
        )
        p = proj.scalar_one_or_none()
        project_id = p.id if p else None

    from app.services.orchestration.dispatcher import create_agent_task
    from app.services.orchestration.queue import enqueue_agent_task_segment
    from app.services.orchestration.runner import run_agent_task_segment

    task = await create_agent_task(
        session,
        tenant_id,
        title=instruction[:200] if instruction else f"{agent.name} run",
        description=instruction,
        project_id=project_id,
        agent_id=agent.id,
        trigger_type="manual",
        auto_start=False,
    )
    agent.runtime_status = "active"
    agent.current_activity_summary = instruction[:200] if instruction else "Running"
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    await session.commit()

    if not await enqueue_agent_task_segment(str(tenant_id), str(task.id)):
        await run_agent_task_segment(session, tenant_id, task.id)
        await session.refresh(task)

    ctx = _parse_json(task.context_json)
    run_id = ctx.get("active_run_id")
    return {"ok": True, "run_id": run_id, "task_id": str(task.id), "activity_id": run_id or str(task.id)}


async def complete_activity(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    activity_id: UUID,
    outcome: str,
    summary: str | None = None,
) -> dict[str, Any]:
    result = await session.execute(
        select(AgentRun).where(AgentRun.id == activity_id, AgentRun.tenant_id == tenant_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Activity not found")
    run.status = "failed" if outcome == "failed" else "completed" if outcome == "completed" else "completed"
    if outcome == "cancelled":
        run.status = "failed"
    run.completed_at = datetime.utcnow()
    if summary:
        run.subject = summary[:500]
    session.add(run)
    agent_result = await session.execute(
        select(Agent).where(Agent.id == run.agent_id, Agent.tenant_id == tenant_id)
    )
    agent = agent_result.scalar_one_or_none()
    if agent:
        agent.runtime_status = "standby"
        agent.current_activity_summary = summary or ""
        agent.updated_at = datetime.utcnow()
        session.add(agent)
    await ensure_run_events(session, run)
    await session.commit()
    return {"ok": True, "outcome": outcome}


async def clear_stale_runtime(
    session: AsyncSession, tenant_id: UUID, *, max_stale_minutes: int = 15
) -> dict[str, int]:
    """Reset agents/runs stuck in an active state past the staleness window.

    DB-only maintenance: an agent whose `runtime_status` is active/running but
    has not been updated within `max_stale_minutes` is returned to standby, and
    any long-running `AgentRun` is marked failed.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=max(1, max_stale_minutes))
    now = datetime.utcnow()

    agents_cleared = 0
    agent_result = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.runtime_status.in_(["active", "running"]),
            Agent.updated_at < cutoff,
        )
    )
    for agent in agent_result.scalars().all():
        agent.runtime_status = "standby"
        agent.current_activity_summary = ""
        agent.updated_at = now
        session.add(agent)
        agents_cleared += 1

    runs_cleared = 0
    run_result = await session.execute(
        select(AgentRun).where(
            AgentRun.tenant_id == tenant_id,
            AgentRun.status == "running",
            AgentRun.started_at < cutoff,
        )
    )
    for run in run_result.scalars().all():
        run.status = "failed"
        run.completed_at = now
        run.pause_reason = "cleared_stale"
        session.add(run)
        runs_cleared += 1

    await session.commit()
    return {
        "agents_cleared": agents_cleared,
        "runs_cleared": runs_cleared,
        "stale_cleared": agents_cleared + runs_cleared,
    }


async def create_demo_run(
    session: AsyncSession,
    tenant_id: UUID,
    agent_id: UUID,
    project_id: UUID,
    *,
    subject: str,
    status: str = "completed",
) -> AgentRun:
    run = AgentRun(
        tenant_id=tenant_id,
        agent_id=agent_id,
        project_id=project_id,
        status=status,
        trigger_type="seed",
        subject=subject,
        tokens_input=120,
        tokens_output=80,
        completed_at=datetime.utcnow() if status != "running" else None,
    )
    session.add(run)
    await session.flush()
    await ensure_run_events(session, run)
    return run
