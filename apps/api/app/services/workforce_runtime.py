"""Workforce runtime service (agents, work logs, messages, graph controls)."""

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun, RunEvent
from app.models.notification import DecisionRequest
from app.models.project import Project
from app.models.signal import Signal

ROLE_SLUG_MAP = {
    "po": "orchestrator",
    "orchestrator": "orchestrator",
    "manager": "orchestrator",
    "assistant": "assistant",
    "communication": "communication",
    "coding": "builder",
    "orchestra": "orchestra",
}

MAX_AGENT_DESCRIPTION = 280

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


def normalize_agent_description(raw: str | None) -> str:
    return (raw or "").strip()[:MAX_AGENT_DESCRIPTION]


def _ms(value: datetime | None) -> int:
    if not value:
        return 0
    return int(value.timestamp() * 1000)


def _utc_ms(value: datetime | None) -> int | None:
    """Naive DB datetimes are UTC; read them as such regardless of server tz."""
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
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


AgentView = Literal["summary", "picker", "passport", "runtime"]


def serialize_agent(
    agent: Agent,
    *,
    view: AgentView = "summary",
    running: bool = False,
    latest_run: AgentRun | None = None,
    open_conversations: int = 0,
    awaiting_decision: int = 0,
) -> dict[str, Any]:
    """The one agent DTO. Views only add fields on top of ``summary``.

    - ``summary``: identity, avatar and live status (rows, chips, project orchestrator)
    - ``picker``: summary for chat targets and assignee pickers (callers add their flags)
    - ``passport``: summary + model, autonomy, tools and scopes (Govern, agent tools)
    - ``runtime``: everything the Agents page and agent detail render

    ``status`` is ``standby | working | error``; an open AgentRun (``running``
    or a running ``latest_run``) reads as working.
    """
    from app.services.agent_avatar import avatar_payload
    from app.services.presence import STANDBY, WORKING, agent_status

    status = agent_status(agent.runtime_status)
    live_run = latest_run if latest_run is not None and latest_run.status == "running" else None
    if status == STANDBY and (running or live_run is not None):
        status = WORKING
    summary = agent.current_activity_summary or ""
    if live_run is not None and not summary:
        summary = live_run.subject or "Running"
    payload: dict[str, Any] = {
        "id": str(agent.id),
        "name": agent.name,
        "description": agent.description or "",
        "slug": agent.slug or _slugify(agent.name),
        "role": agent.role,
        "kind": agent.kind,
        "is_active": bool(agent.is_active),
        "status": status,
        "current_activity_summary": summary or None,
        "current_thread_id": str(agent.current_signal_id) if agent.current_signal_id else None,
        # Last run, reply or tool step (ms, UTC); null before the first run.
        "last_active_at": _utc_ms(agent.last_active_at),
    }
    payload.update(avatar_payload(agent))
    if view in ("passport", "runtime"):
        from app.services.agent_rules import normalize_autonomy

        payload.update(
            {
                "model": agent.model,
                "provider": agent.provider,
                "is_lead": bool(agent.is_lead),
                "acts_for_user": bool(agent.acts_for_user),
                "autonomy_level": normalize_autonomy(agent.autonomy_level),
                "tools": _parse_json_list(agent.tools_json),
                "permission_scopes": _parse_json_list(agent.permission_scopes_json),
            }
        )
    if view != "runtime":
        return payload

    from app.services.addressee import agent_ask_target
    from app.services.managed_resources import management_payload
    from app.services.signatures import (
        agent_reply_send_as,
        agent_signature_html,
        agent_signature_text,
    )

    rslug = role_slug(agent)
    payload.update(
        {
            "organisation_id": str(tenant_numeric_id(agent.tenant_id)),
            "role_id": rslug,
            "role_name": ROLE_NAME_MAP.get(agent.role, agent.name),
            "role_slug": rslug,
            "parent_agent_id": str(agent.parent_agent_id) if agent.parent_agent_id else None,
            "purpose": agent.system_prompt or "",
            "system_prompt": agent.system_prompt or "",
            "owner_user_id": str(agent.owner_user_id) if agent.owner_user_id else None,
            "default_channels": _parse_json_list(agent.default_channels_json),
            "default_signal_types": _parse_json_list(agent.default_signal_types_json),
            "chat_access": agent.chat_access,
            "email_signature_text": agent_signature_text(agent),
            "email_signature_html": agent_signature_html(agent),
            "reply_send_as": agent_reply_send_as(agent),
            "current_session_id": str(latest_run.id) if latest_run else None,
            "current_activity_id": str(live_run.id) if live_run else None,
            "open_conversations": int(open_conversations),
            "awaiting_decision": int(awaiting_decision),
            "updated_at": _ms(agent.updated_at or agent.created_at),
            "ask_target": agent_ask_target(agent),
        }
    )
    payload.update(management_payload(agent))
    return payload


def _parse_json_list(raw: str | None) -> list[Any]:
    try:
        value = json.loads(raw or "[]")
    except (json.JSONDecodeError, TypeError):
        return []
    return value if isinstance(value, list) else []


async def _conversation_counts_by_agent(
    session: AsyncSession, tenant_id: UUID, agent_ids: list[UUID]
) -> tuple[dict[UUID, int], dict[UUID, int]]:
    """Open customer threads and real awaiting-decision counts per agent."""
    if not agent_ids:
        return {}, {}
    open_rows = (
        await session.execute(
            select(Signal.agent_id, func.count())
            .where(
                Signal.tenant_id == tenant_id,
                Signal.agent_id.in_(agent_ids),
                Signal.status == "open",
                Signal.channel.notin_(("assistant",)),
            )
            .group_by(Signal.agent_id)
        )
    ).all()
    open_by = {agent_id: int(count) for agent_id, count in open_rows if agent_id}

    from app.services.signal_threads import attention_counts

    attention = await attention_counts(session, tenant_id, by_agent=True)
    decision_by = attention["decisions_by_agent"]
    return open_by, decision_by


# Roles a workspace admin may pick when creating a worker agent. Orchestrators
# are created via the project orchestrator flow, not here.
CREATABLE_AGENT_ROLES = ("assistant", "communication", "builder", "orchestra")


async def list_runtime_agents(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    include_inactive: bool = False,
) -> list[dict[str, Any]]:
    """List company agents. Deactivated (archived) rows are omitted unless requested."""
    kinds = ("company", "archived") if include_inactive else ("company",)
    filters = [
        Agent.tenant_id == tenant_id,
        Agent.acts_for_user.is_(False),
        Agent.kind.in_(kinds),
    ]
    if not include_inactive:
        filters.append(Agent.is_active.is_(True))
    result = await session.execute(
        select(Agent).where(*filters).order_by(Agent.updated_at.desc())
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
    open_by, decision_by = await _conversation_counts_by_agent(
        session, tenant_id, [a.id for a in agents]
    )
    return [
        serialize_agent(
            agent,
            view="runtime",
            latest_run=latest_by_agent.get(agent.id),
            open_conversations=open_by.get(agent.id, 0),
            awaiting_decision=decision_by.get(agent.id, 0),
        )
        for agent in agents
    ]


def apply_agent_runtime(
    agent: Agent,
    *,
    status: str,
    summary: str | None = None,
    signal_id: UUID | None = None,
    activity_id: UUID | str | None = None,
) -> str | None:
    """Mutate live work fields. Returns activity id string for the WS payload."""
    from app.services.presence import agent_status

    status = agent_status(status)
    agent.runtime_status = status
    now = datetime.utcnow()
    agent.updated_at = now
    agent.last_active_at = now
    live_activity: str | None = str(activity_id) if activity_id else None
    if status == "standby":
        agent.current_activity_summary = ""
        agent.current_signal_id = None
        live_activity = None
    else:
        if summary is not None:
            agent.current_activity_summary = (summary or "")[:200]
        if signal_id is not None:
            agent.current_signal_id = signal_id
    return live_activity


async def broadcast_agent_live(agent: Agent, *, activity_id: str | None = None) -> None:
    from app.gateway.publish import publish_agent_status
    from app.services.presence import agent_status

    corner = agent_status(agent.runtime_status)
    thread_id = str(agent.current_signal_id) if agent.current_signal_id else None
    await publish_agent_status(
        agent.tenant_id,
        agent_id=agent.id,
        status=corner,
        summary=agent.current_activity_summary or None,
        thread_id=thread_id,
        activity_id=activity_id,
        last_active_at=_utc_ms(agent.last_active_at),
    )


async def mark_agent_activity(
    session: AsyncSession,
    agent: Agent,
    *,
    status: str,
    summary: str | None = None,
    signal_id: UUID | None = None,
    activity_id: UUID | str | None = None,
) -> None:
    """Set runtime status for inbox/orchestration loops and broadcast live work.

    ``status`` is ``working``, ``standby`` or ``error``.
    """
    live_activity = apply_agent_runtime(
        agent, status=status, summary=summary, signal_id=signal_id, activity_id=activity_id
    )
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    await broadcast_agent_live(agent, activity_id=live_activity)


async def update_agent_runtime_status(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID, status: str
) -> dict[str, Any]:
    """Update run-time status only (idle / working / error).

    Operators no longer pause or wake agents. Hide an agent with archive.
    """
    if status not in ("standby", "working", "error"):
        raise HTTPException(status_code=400, detail="Invalid status")
    result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    await mark_agent_activity(session, agent, status=status)
    return {"ok": True, "agent": serialize_agent(agent, view="runtime")}


async def archive_agent(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> dict[str, Any]:
    """Deactivate a company agent: hidden from the working roster, history preserved.

    Channel defaults are cleared; existing conversation history stays pinned.
    """
    result = await session.execute(
        select(Agent).where(
            Agent.id == agent_id, Agent.tenant_id == tenant_id, Agent.kind == "company"
        )
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.acts_for_user:
        raise HTTPException(
            status_code=409,
            detail="The Bokito system agent cannot be deactivated.",
        )
    from sqlalchemy import update

    from app.models.channel import ChannelAccount

    await session.execute(
        update(ChannelAccount)
        .where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.default_agent_id == agent.id,
        )
        .values(default_agent_id=None)
    )
    agent.kind = "archived"
    agent.is_active = False
    agent.runtime_status = "standby"
    agent.is_lead = False
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    await session.commit()
    return {"ok": True, "id": str(agent_id)}


async def restore_agent(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> dict[str, Any]:
    """Reactivate a deactivated company agent. History was never deleted."""
    result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.acts_for_user:
        raise HTTPException(
            status_code=409,
            detail="The Bokito system agent cannot be deactivated.",
        )
    if agent.kind not in ("company", "archived"):
        raise HTTPException(status_code=404, detail="Agent not found")
    agent.kind = "company"
    agent.is_active = True
    agent.runtime_status = "standby"
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    await session.commit()
    return {"ok": True, "id": str(agent_id), "agent": serialize_agent(agent, view="runtime")}


async def update_agent_model(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID, model_slug: str
) -> dict[str, Any]:
    """Set an agent's chat model or mode (inherit / automatic / managed / BYOK)."""
    from app.services import model_policy, provider_connections, tenant_model_catalog as tmc
    from app.services.model_catalog import get_model
    from app.services.tenant_models import get_tenant_model_prefs, is_chat_model_allowed

    result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    mode = model_policy.normalize_agent_mode(model_slug)
    if mode == model_policy.INHERIT:
        agent.model = model_policy.INHERIT
        agent.provider = "bokito"
        agent.updated_at = datetime.utcnow()
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        return {"ok": True, "agent": serialize_agent(agent, view="runtime")}
    if mode == model_policy.AUTOMATIC:
        agent.model = model_policy.AUTOMATIC
        agent.provider = "bokito"
        agent.updated_at = datetime.utcnow()
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        return {"ok": True, "agent": serialize_agent(agent, view="runtime")}

    provider_type = ""
    if await tmc.tenant_has_models(session, tenant_id):
        model = await tmc.get_model(session, tenant_id, mode)
        if not model or model.kind != "chat" or not model.enabled:
            # Managed Bokito tiers stay selectable even when BYOK is active.
            catalog = await get_model(session, mode)
            if (
                catalog
                and catalog.kind == "chat"
                and catalog.enabled
                and catalog.provider == "bokito"
            ):
                slug = catalog.slug
                provider_type = "bokito"
            else:
                raise HTTPException(status_code=400, detail="Unknown or unavailable chat model")
        else:
            conn = await provider_connections.get_connection(session, tenant_id, model.connection_id)
            if not conn or not conn.enabled:
                raise HTTPException(status_code=400, detail="Provider connection unavailable")
            provider_type = conn.provider_type
            slug = model.slug
    else:
        model = await get_model(session, mode)
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
    return {"ok": True, "agent": serialize_agent(agent, view="runtime")}


async def create_agent(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str,
    role: str = "assistant",
    description: str = "",
    system_prompt: str = "",
    tools: list[str] | None = None,
    owner_user_id: UUID | None = None,
    default_channels: list[str] | None = None,
    default_signal_types: list[str] | None = None,
    model_slug: str = "",
    chat_access: str = "everyone",
) -> dict[str, Any]:
    """Create a company worker agent, with its model validated against tenant models."""
    from app.services import model_policy, provider_connections, tenant_model_catalog as tmc
    from app.services.model_catalog import get_model
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
    mode = model_policy.normalize_agent_mode(model_slug)

    if mode in (model_policy.INHERIT, model_policy.AUTOMATIC) or not model_slug.strip():
        # Empty create → follow workspace; explicit automatic stays on the agent.
        slug = model_policy.AUTOMATIC if mode == model_policy.AUTOMATIC else model_policy.INHERIT
        provider_type = "bokito"
    elif has_tenant:
        tenant_model = await tmc.get_model(session, tenant_id, mode)
        if tenant_model and tenant_model.kind == "chat" and tenant_model.enabled:
            conn = await provider_connections.get_connection(
                session, tenant_id, tenant_model.connection_id
            )
            if conn and conn.enabled:
                slug = tenant_model.slug
                provider_type = conn.provider_type
        if not slug:
            model = await get_model(session, mode)
            if not model or model.kind != "chat" or not model.enabled:
                raise HTTPException(status_code=400, detail="Unknown or unavailable chat model")
            slug = model.slug
            provider_type = model.provider
    else:
        prefs = await get_tenant_model_prefs(session, tenant_id)
        model = await get_model(session, mode)
        if not model or model.kind != "chat" or not model.enabled:
            raise HTTPException(status_code=400, detail="Unknown or unavailable chat model")
        if not is_chat_model_allowed(prefs, model.slug):
            raise HTTPException(status_code=403, detail="Model not permitted for this workspace")
        slug = model.slug
        provider_type = model.provider

    agent = Agent(
        tenant_id=tenant_id,
        name=clean_name,
        role=norm_role,
        kind="company",
        chat_access=chat_access,
        owner_user_id=owner_user_id,
        description=normalize_agent_description(description),
        system_prompt=(system_prompt or "").strip(),
        tools_json=json.dumps(tools or []),
        default_channels_json=json.dumps(default_channels or []),
        default_signal_types_json=json.dumps(default_signal_types or []),
        slug=_slugify(clean_name),
        runtime_status="standby",
        is_active=True,
        model=slug or model_policy.INHERIT,
        provider=provider_type or "bokito",
    )
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return {"ok": True, "agent": serialize_agent(agent, view="runtime")}


async def update_agent(
    session: AsyncSession,
    tenant_id: UUID,
    agent_id: UUID,
    *,
    name: str | None = None,
    description: str | None = None,
    system_prompt: str | None = None,
    tools: list[str] | None = None,
    owner_user_id: UUID | None = None,
    default_channels: list[str] | None = None,
    default_signal_types: list[str] | None = None,
    email_signature_html: str | None = None,
    email_signature_text: str | None = None,
    reply_send_as: str | None = None,
    avatar_kind: str | None = None,
    avatar_icon: str | None = None,
    avatar_color: str | None = None,
    avatar_image_url: str | None = None,
    ask_target: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Edit a company agent's identity, description, system prompt, signature, avatar, and who it asks."""
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
    if description is not None:
        agent.description = normalize_agent_description(description)
    if system_prompt is not None:
        agent.system_prompt = system_prompt.strip()
    if tools is not None:
        agent.tools_json = json.dumps(tools)
    if owner_user_id is not None:
        agent.owner_user_id = owner_user_id
    if default_channels is not None:
        agent.default_channels_json = json.dumps(default_channels)
    if default_signal_types is not None:
        agent.default_signal_types_json = json.dumps(default_signal_types)
    settings_touch = (
        email_signature_html is not None
        or email_signature_text is not None
        or reply_send_as is not None
        or avatar_kind is not None
        or avatar_icon is not None
        or avatar_color is not None
        or avatar_image_url is not None
    )
    if settings_touch:
        stored = _parse_json(agent.settings_json)
        if email_signature_text is not None or email_signature_html is not None:
            from app.services.signatures import (
                MAX_SIGNATURE_LENGTH,
                SIGNATURE_KEY,
                SIGNATURE_TEXT_KEY,
                html_signature_to_plain_text,
            )

            if email_signature_text is not None:
                signature = email_signature_text.strip()
            else:
                signature = html_signature_to_plain_text(email_signature_html or "")
            if len(signature) > MAX_SIGNATURE_LENGTH:
                raise HTTPException(status_code=400, detail="Signature too long")
            if signature:
                stored[SIGNATURE_TEXT_KEY] = signature
            else:
                stored.pop(SIGNATURE_TEXT_KEY, None)
            # Drop legacy HTML so plain text stays the single source of truth.
            stored.pop(SIGNATURE_KEY, None)
        if reply_send_as is not None:
            from app.services.signatures import SEND_AS_CHOICES

            value = reply_send_as.strip().lower()
            if value not in SEND_AS_CHOICES:
                raise HTTPException(
                    status_code=400, detail="reply_send_as must be 'user' or 'agent'"
                )
            stored["reply_send_as"] = value
        if any(
            value is not None
            for value in (avatar_kind, avatar_icon, avatar_color, avatar_image_url)
        ):
            from app.services.agent_avatar import apply_avatar_settings

            try:
                stored = apply_avatar_settings(
                    stored,
                    avatar_kind=avatar_kind,
                    avatar_icon=avatar_icon,
                    avatar_color=avatar_color,
                    avatar_image_url=avatar_image_url,
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        agent.settings_json = json.dumps(stored)
    if ask_target is not None:
        from app.services.addressee import parse_target, set_agent_ask_target

        kind = str(ask_target.get("kind") or "auto")
        target = None
        if kind != "auto":
            target = await parse_target(session, tenant_id, ask_target)
            if target is None:
                raise HTTPException(status_code=400, detail="Ask target not found")
        try:
            set_agent_ask_target(agent, kind, UUID(target["id"]) if target else None)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return {"ok": True, "agent": serialize_agent(agent, view="runtime")}


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
    apply_agent_runtime(
        agent,
        status="working",
        summary=instruction[:200] if instruction else "Running",
    )
    session.add(agent)
    await session.commit()
    await broadcast_agent_live(agent)

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
        apply_agent_runtime(agent, status="standby", summary=summary)
        session.add(agent)
    await ensure_run_events(session, run)
    await session.commit()
    if agent:
        await broadcast_agent_live(agent)
    return {"ok": True, "outcome": outcome}


async def clear_stale_runtime(
    session: AsyncSession, tenant_id: UUID, *, max_stale_minutes: int = 15
) -> dict[str, int]:
    """Reset agents/runs stuck in a working state past the staleness window.

    DB-only maintenance: an agent whose `runtime_status` is working but
    has not been updated within `max_stale_minutes` is returned to standby, and
    any long-running `AgentRun` is marked failed.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=max(1, max_stale_minutes))
    now = datetime.utcnow()

    agents_cleared = 0
    agent_result = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.runtime_status == "working",
            Agent.updated_at < cutoff,
        )
    )
    for agent in agent_result.scalars().all():
        agent.runtime_status = "standby"
        agent.current_activity_summary = ""
        agent.current_signal_id = None
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
