"""Tenant bootstrap defaults on signup."""

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.inbox import InboxSettings
from app.services.language import platform_default_ui_language
from app.services.workspace import upsert_doc
from app.tools.policy import DEFAULT_AUTONOMY_POSTURE

DEFAULT_BRAND_COLOR = "#0D9488"
_LEGACY_DEFAULT_BRAND_COLORS = frozenset({"#00FF99", "#00D986"})


def resolve_brand_color(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw or raw.upper() in {item.upper() for item in _LEGACY_DEFAULT_BRAND_COLORS}:
        return DEFAULT_BRAND_COLOR
    return raw


ONBOARDING_SYSTEM_PROMPT = """You are the Bokito onboarding assistant. Interview the user about their organization:
what they do, who their customers are, how they operate, and their tone of voice.
Use write_doc to document findings in workspace docs (company.md, memory.md, persona.md).
Use suggest_integration when relevant integrations would help.
Ask clarifying questions before writing docs. Be concise and friendly.

You can set the workspace up from this chat. Use your tools instead of sending
people to settings pages unless they ask to click themselves.

When the user asks for help setting up the workspace, guide them through the
five setup pillars one at a time, in this order:
1. Communication - connect the channels where customers reach them (email
   mailbox first; the widget and other channels later).
2. Intelligence - learn about the organization and document it (company.md),
   then help shape the right agents for their work (create_agent).
3. Automations / watching - you watch the workspace on a timer. Use
   get_platform_watch to see if the check-in is on. Use set_platform_watch
   (enabled true) to turn it on from this chat. Findings land in the
   Platform check-in conversation in Messages. Keep heartbeat.md as the
   checklist you work through when you wake. Extra recurring work (digests,
   webhooks) can still be added on the Agenda page.
4. Branding and widget - workspace identity and installing the website chat
   widget (Settings > Branding, and the widget install page).
5. KPIs and metrics - which numbers matter to them; use record_metric to
   create those metrics so they appear on the Cockpit, and keep them updated
   when you learn new values.
Ask what they want to tackle first, keep each step small, and confirm before
creating agents or metrics. Prefer turning watching on yourself when they
want the platform to keep an eye on things.

After Communication, if the work touches bookkeeping, invoices, VAT, or
bank balances, call list_modules and recommend_module. Do not push every
module — only the one that matches the work."""

DEFAULT_DOCS: list[tuple[str, str, str]] = [
    (
        "persona.md",
        "persona",
        "# How we sound\n\n## Tone\nProfessional and helpful. Keep replies concise and concrete.\n",
    ),
    (
        "memory.md",
        "memory",
        "# What we remember\n\nDurable facts about this organization, learned over time.\n",
    ),
    (
        "company.md",
        "doc",
        "# About the company\n\nDescribe what the organization does, who its customers are, and how it operates. Filled during onboarding.\n",
    ),
    (
        "heartbeat.md",
        "heartbeat",
        "# Daily check-in\n\n- Review open conversations needing a reply\n- Check pending decisions\n- If company.md or open threads mention invoices, VAT, or outstanding balances and accounting is not connected, use recommend_module; otherwise HEARTBEAT_OK\n",
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
            is_lead=True,
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
    # Only runtime profiles (infra defaults), the assistant, docs, one
    # Platform check-in conversation, and an enabled hourly check-in.
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
    """Operations thread + hourly platform check-in for a new workspace."""
    from app.services.platform_watch import bootstrap_new_tenant

    await bootstrap_new_tenant(session, tenant_id)


def default_tenant_settings() -> dict:
    base = {
        # Welcome copy and widget name are deliberately not seeded: empty means
        # "use the localized defaults" (welcome text in the workspace language,
        # widget name from the assistant/tenant name) until the tenant edits them.
        "appearance": {
            "main_color": DEFAULT_BRAND_COLOR,
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
    base["ai_workspace_language"] = platform_default_ui_language()
    base["security"] = {
        "require_2fa": False,
        "allow_platform_support": True,
    }
    return base


def serialize_settings(settings: dict) -> str:
    return json.dumps(settings)
