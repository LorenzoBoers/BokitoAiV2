"""Tenant bootstrap defaults on signup."""

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.inbox import InboxSettings
from app.models.policy import AssistantPersona
from app.models.project import Project, ProjectOrchestration
from app.services.workspace import upsert_doc
from app.tools.policy import DEFAULT_AUTONOMY_POSTURE


ONBOARDING_SYSTEM_PROMPT = """You are the Bokito onboarding assistant. Interview the user about their organization:
what they do, who their customers are, how they operate, and their tone of voice.
Use write_doc to document findings in workspace docs (company.md, memory.md, persona.md).
Use suggest_integration when relevant integrations would help.
Ask clarifying questions before writing docs. Be concise and friendly."""

DEFAULT_DOCS: list[tuple[str, str, str]] = [
    (
        "persona.md",
        "persona",
        "# Persona\n\nProfessional and helpful. Keep replies concise and concrete.\n",
    ),
    (
        "memory.md",
        "memory",
        "# Long-term memory\n\nDurable facts about this organization, learned over time.\n",
    ),
    (
        "company.md",
        "doc",
        "# Company\n\nDescribe what the organization does, who its customers are, and how it operates. Filled during onboarding.\n",
    ),
    (
        "heartbeat.md",
        "heartbeat",
        "# Heartbeat checklist\n\n- Review open threads needing a reply\n- Check pending decisions\n",
    ),
]


async def bootstrap_tenant(session: AsyncSession, tenant_id: UUID) -> None:
    session.add(InboxSettings(tenant_id=tenant_id))
    session.add(AssistantPersona(tenant_id=tenant_id, tone="Professional and helpful"))
    session.add(
        Agent(
            tenant_id=tenant_id,
            name="Assistant",
            role="assistant",
            slug="assistant",
            chat_access="everyone",
            runtime_status="standby",
            system_prompt=ONBOARDING_SYSTEM_PROMPT,
        )
    )
    for path, kind, content in DEFAULT_DOCS:
        await upsert_doc(
            session,
            tenant_id,
            path=path,
            content=content,
            kind=kind,
            created_by_type="system",
            commit=False,
        )
    await seed_demo_project(session, tenant_id)
    from app.services.orchestration.bootstrap import (
        seed_demo_workstream,
        seed_tenant_runtime_profiles,
    )

    await seed_tenant_runtime_profiles(session, tenant_id)
    await seed_demo_workstream(session, tenant_id)
    await seed_default_triggers(session, tenant_id)


async def seed_default_triggers(session: AsyncSession, tenant_id: UUID) -> None:
    """Default heartbeat trigger so the assistant wakes proactively."""
    from sqlalchemy import select

    from app.models.trigger import Trigger
    from app.services.triggers import compute_next_run

    existing = await session.execute(
        select(Trigger).where(Trigger.tenant_id == tenant_id, Trigger.kind == "heartbeat")
    )
    if existing.scalars().first():
        return
    trigger = Trigger(
        tenant_id=tenant_id,
        name="Heartbeat",
        kind="heartbeat",
        interval_minutes=30,
        agent_role="assistant",
        enabled=False,
    )
    trigger.next_run_at = compute_next_run(trigger)
    session.add(trigger)


async def seed_demo_project(session: AsyncSession, tenant_id: UUID) -> None:
    """Default demo project so project hub and workforce surfaces are usable."""
    from sqlalchemy import select

    existing = await session.execute(select(Project).where(Project.tenant_id == tenant_id))
    if existing.scalar_one_or_none():
        return
    orchestrator_result = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id, Agent.role.in_(("orchestrator", "po"))
        )
    )
    orchestrator = orchestrator_result.scalars().first()
    if not orchestrator:
        orchestrator = Agent(
            tenant_id=tenant_id,
            name="Demo Project Orchestrator",
            role="orchestrator",
            slug="orchestrator",
            runtime_status="standby",
            system_prompt="You are the orchestrator for the default demo project. Plan work, route agents, and keep project knowledge current.",
        )
        session.add(orchestrator)
        await session.flush()
    project = Project(
        tenant_id=tenant_id,
        name="Demo Project",
        slug="demo-project",
        description="Auto-seeded project for onboarding and local development.",
        autonomous_scope="Explore Bokito AI OS features with a starter project.",
        po_agent_id=orchestrator.id,
    )
    session.add(project)
    await session.flush()
    session.add(ProjectOrchestration(tenant_id=tenant_id, project_id=project.id))


def default_tenant_settings() -> dict:
    base = {
        "appearance": {
            "main_color": "#00FF99",
            "welcome_title": "Welcome",
            "welcome_subtitle": "How can we help?",
            "chatbot_name": "Assistant",
            "powered_by": True,
        },
        "orchestra_enabled": False,
        "monthly_budget_cents": 0,
        "widget_capabilities": {
            "anonymous": ["qa"],
            "member": ["qa", "capture", "actions", "handoff"],
        },
    }
    base["autonomy_posture"] = DEFAULT_AUTONOMY_POSTURE
    return base


def serialize_settings(settings: dict) -> str:
    return json.dumps(settings)
