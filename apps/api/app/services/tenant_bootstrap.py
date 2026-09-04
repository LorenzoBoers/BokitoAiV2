"""Tenant bootstrap defaults on signup."""

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.services.language import platform_default_ui_language
from app.services.personal_assistant import ensure_personal_assistant
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

When the user asks for help setting up the workspace, guide them through
these four steps one at a time, in this order:
1. Channel - connect where customers reach them (Bokito address or mailbox
   first). Point them to Email & messages, not the module marketplace.
2. Talk - interview them and document the organization (company.md) in this
   chat.
3. One decision - make sure they have seen and approved a decision card.
4. Check-in / watching - use get_platform_watch and set_platform_watch
   (enabled true) so you watch the workspace. Findings land in your own
   channel in Communication, the conversation the operator already uses to
   talk to you. Keep heartbeat.md as the checklist you work through when
   you wake.
After those four, offer later work without numbering it as setup: branding
and widget, inviting the team, a business module when the work fits,
projects, and Govern.
Ask what they want to tackle first, keep each step small, and confirm before
creating agents. Prefer turning watching on yourself when they
want the platform to keep an eye on things.

After Communication, if the work touches bookkeeping, invoices, VAT, or
bank balances, call list_modules and recommend_module so the operator can
turn that module on. Do not push every module — only the one that matches
the work. Connecting a package is a second step after the module is on."""

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
        "# Daily check-in\n\n- Review open conversations needing a reply\n- Check pending decisions\n- If company.md or open threads mention work a business module covers (see list_modules) and that module is off, use recommend_module; otherwise HEARTBEAT_OK\n",
    ),
]


async def bootstrap_tenant(session: AsyncSession, tenant_id: UUID) -> None:
    # Persona lives in the persona.md workspace doc (DEFAULT_DOCS below);
    # inbox policy lives in Tenant.settings_json (services/channel_ai.py).
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
    # Platform furniture, not a tenant agent: every member's own Bokito helper.
    await ensure_personal_assistant(session, tenant_id, commit=False)
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
    # Only the assistant, docs, the assistant's own channel conversation, and
    # an enabled hourly check-in. The Agent row is the single runtime passport.
    # Email stays empty until someone connects a mailbox or creates a Bokito
    # relay address. The website chat is the one channel that works the moment
    # the widget is embedded, so it gets a row to carry state and an off switch.
    await ensure_widget_channel(session, tenant_id, commit=False)
    await seed_default_triggers(session, tenant_id)
    from app.services.cases import ensure_platform_case_types

    await ensure_platform_case_types(session, tenant_id, commit=False)


async def ensure_widget_channel(
    session: AsyncSession, tenant_id: UUID, *, commit: bool = True
) -> ChannelAccount:
    """The website chat as a real channel row (state, pause, agent binding)."""
    from sqlalchemy import select as sa_select

    existing = (
        await session.execute(
            sa_select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant_id,
                ChannelAccount.channel == "widget",
            )
        )
    ).scalars().first()
    if existing:
        return existing
    tenant = (
        await session.execute(sa_select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one()
    account = ChannelAccount(
        tenant_id=tenant_id,
        channel="widget",
        provider="widget",
        address=tenant.slug,
        display_name="Website chat",
        is_enabled=True,
    )
    session.add(account)
    if commit:
        await session.commit()
        await session.refresh(account)
    else:
        await session.flush()
    return account


async def seed_default_triggers(session: AsyncSession, tenant_id: UUID) -> None:
    """Assistant channel thread + hourly platform check-in for a new workspace."""
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
    base["privacy"] = {
        "retention_messages_days": 365,
        "retention_calendar_days": 365,
        "retention_audit_days": 730,
        "llm_may_use_message_bodies": True,
    }
    return base


def serialize_settings(settings: dict) -> str:
    return json.dumps(settings)
