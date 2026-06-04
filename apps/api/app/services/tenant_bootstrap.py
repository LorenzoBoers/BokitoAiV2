"""Tenant bootstrap defaults on signup."""

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.blueprint import BlueprintBlock, BlueprintDoc, BlueprintPage
from app.models.inbox import InboxSettings
from app.models.policy import ActionPolicy, AssistantPersona
from app.models.project import Project, ProjectOrchestration
from app.services.agent.rag import upsert_index_chunk


ONBOARDING_SYSTEM_PROMPT = """You are the Bokito onboarding assistant. Interview the user about their organization:
what they do, who their customers are, how they operate, and their tone of voice.
Use write_blueprint to document findings. Use suggest_integration when relevant integrations would help.
Ask clarifying questions before making blueprint changes. Be concise and friendly."""


async def bootstrap_tenant(session: AsyncSession, tenant_id: UUID) -> None:
    session.add(InboxSettings(tenant_id=tenant_id))
    session.add(ActionPolicy(tenant_id=tenant_id, mode="whitelist"))
    session.add(AssistantPersona(tenant_id=tenant_id, tone="Professional and helpful"))
    session.add(
        Agent(
            tenant_id=tenant_id,
            name="Assistant",
            role="assistant",
            slug="assistant",
            runtime_status="standby",
            system_prompt=ONBOARDING_SYSTEM_PROMPT,
        )
    )
    session.add(
        Agent(
            tenant_id=tenant_id,
            name="Orchestrator",
            role="orchestrator",
            slug="manager",
            runtime_status="standby",
            system_prompt="You are the PM orchestrator. Maintain blueprint, agenda, and propose workstreams.",
        )
    )
    doc = BlueprintDoc(tenant_id=tenant_id, title="Blueprint")
    session.add(doc)
    await session.flush()
    overview = BlueprintPage(
        doc_id=doc.id,
        tenant_id=tenant_id,
        title="Overview",
        slug="overview",
        kind="overview",
    )
    session.add(overview)
    await session.flush()
    session.add(
        BlueprintBlock(
            page_id=overview.id,
            tenant_id=tenant_id,
            block_type="paragraph",
            content_json=json.dumps({"text": [{"text": "Organization blueprint - fill during onboarding."}], "props": {}}),
        )
    )
    await upsert_index_chunk(
        session,
        tenant_id,
        "blueprint_summary",
        str(doc.id),
        "Blueprint",
        "Organization blueprint - to be filled during onboarding.",
    )
    await seed_demo_project(session, tenant_id)


async def seed_demo_project(session: AsyncSession, tenant_id: UUID) -> None:
    """Default demo project so project hub and workforce surfaces are usable."""
    from sqlalchemy import select

    existing = await session.execute(select(Project).where(Project.tenant_id == tenant_id))
    if existing.scalar_one_or_none():
        return
    po_result = await session.execute(
        select(Agent).where(Agent.tenant_id == tenant_id, Agent.role == "po")
    )
    po = po_result.scalar_one_or_none()
    if not po:
        po = Agent(
            tenant_id=tenant_id,
            name="Platform PO",
            role="po",
            slug="po",
            runtime_status="standby",
            system_prompt="Product owner for the default demo project.",
        )
        session.add(po)
        await session.flush()
    project = Project(
        tenant_id=tenant_id,
        name="Demo Project",
        slug="demo-project",
        description="Auto-seeded project for onboarding and local development.",
        autonomous_scope="Explore Bokito AI OS features with a starter project.",
        po_agent_id=po.id,
    )
    session.add(project)
    await session.flush()
    session.add(ProjectOrchestration(tenant_id=tenant_id, project_id=project.id))


def default_tenant_settings() -> dict:
    return {
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


def serialize_settings(settings: dict) -> str:
    return json.dumps(settings)
