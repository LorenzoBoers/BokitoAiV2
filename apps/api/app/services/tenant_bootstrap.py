"""Tenant bootstrap defaults on signup."""

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.blueprint import BlueprintDoc
from app.models.inbox import InboxSettings
from app.models.policy import ActionPolicy, AssistantPersona
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
            system_prompt=ONBOARDING_SYSTEM_PROMPT,
        )
    )
    session.add(
        Agent(
            tenant_id=tenant_id,
            name="Orchestrator",
            role="orchestrator",
            system_prompt="You are the PM orchestrator. Maintain blueprint, agenda, and propose workstreams.",
        )
    )
    doc = BlueprintDoc(tenant_id=tenant_id, title="Blueprint")
    session.add(doc)
    await session.flush()
    await upsert_index_chunk(
        session,
        tenant_id,
        "blueprint_summary",
        str(doc.id),
        "Blueprint",
        "Organization blueprint - to be filled during onboarding.",
    )


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
