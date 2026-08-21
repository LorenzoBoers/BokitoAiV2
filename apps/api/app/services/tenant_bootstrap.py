"""Tenant bootstrap defaults on signup."""

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.inbox import InboxSettings
from app.services.workspace import upsert_doc
from app.tools.policy import DEFAULT_AUTONOMY_POSTURE


ONBOARDING_SYSTEM_PROMPT = """You are the Bokito onboarding assistant. Interview the user about their organization:
what they do, who their customers are, how they operate, and their tone of voice.
Use write_doc to document findings in workspace docs (company.md, memory.md, persona.md).
Use suggest_integration when relevant integrations would help.
Ask clarifying questions before writing docs. Be concise and friendly.

When the user asks for help setting up the workspace, guide them through the
five setup pillars one at a time, in this order:
1. Communication - connect the channels where customers reach them (email
   mailbox first; the widget and other channels later).
2. Intelligence - learn about the organization and document it (company.md),
   then help shape the right agents for their work (create_agent).
3. Automations - recurring background work: daily digests, periodic checks,
   webhooks (they configure these on the Agenda page).
4. Branding and widget - workspace identity and installing the website chat
   widget (Settings > Branding, and the widget install page).
5. KPIs and metrics - which numbers matter to them; use record_metric to
   create those metrics so they appear on the Cockpit, and keep them updated
   when you learn new values.
Ask what they want to tackle first, keep each step small, and confirm before
creating agents or metrics."""

DEFAULT_DOCS: list[tuple[str, str, str]] = [
    (
        "persona.md",
        "persona",
        "# Persona\n\n## Tone\nProfessional and helpful. Keep replies concise and concrete.\n",
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
    # Persona lives in the persona.md workspace doc (DEFAULT_DOCS below).
    session.add(InboxSettings(tenant_id=tenant_id))
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
    # Fresh tenants stay empty: no demo project, orchestrator or workstream.
    # Only runtime profiles (infra defaults), the assistant, docs and a
    # disabled heartbeat trigger are seeded.
    from app.services.orchestration.bootstrap import seed_tenant_runtime_profiles

    from sqlalchemy import select

    profiles = await seed_tenant_runtime_profiles(session, tenant_id)
    assistant = (
        await session.execute(
            select(Agent).where(Agent.tenant_id == tenant_id, Agent.role == "assistant").limit(1)
        )
    ).scalars().first()
    if assistant and profiles.get("executor-standard"):
        assistant.default_runtime_profile_id = profiles["executor-standard"].id
    # Built-in receive/send address ({slug}-{token}@in.bokito.ai) so every
    # workspace can get mail before connecting Gmail/Outlook.
    from app.services.bokito_mailbox import ensure_bokito_mailbox

    await ensure_bokito_mailbox(session, tenant_id, commit=False)
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


def default_tenant_settings() -> dict:
    base = {
        "appearance": {
            "main_color": "#00FF99",
            "welcome_title": "Welcome",
            "welcome_subtitle": "How can we help?",
            "chatbot_name": "Assistant",
            "powered_by": True,
        },
        # How the AI handles inbound customer messages per channel:
        # suggest (draft for human approval) | auto (reply directly) | off.
        "channel_ai_modes": {
            "email": "suggest",
            "widget": "auto",
        },
        "widget_capabilities": {
            "anonymous": ["qa"],
            "member": ["qa", "capture", "actions", "handoff"],
        },
    }
    base["autonomy_posture"] = DEFAULT_AUTONOMY_POSTURE
    return base


def serialize_settings(settings: dict) -> str:
    return json.dumps(settings)
