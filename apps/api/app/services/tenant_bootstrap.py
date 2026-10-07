"""Tenant bootstrap defaults on signup."""

import json
import re
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.services.language import platform_default_ui_language
from app.services.personal_assistant import ensure_personal_assistant
from app.services.workspace import upsert_doc
from app.tools.policy import DEFAULT_AUTONOMY_POSTURE

DEFAULT_BRAND_COLOR = "#32BF8E"
_LEGACY_DEFAULT_BRAND_COLORS = frozenset({"#00FF99", "#00D986", "#0D9488"})


_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def normalize_brand_hex(value: object) -> str | None:
    """`#RGB` / `RRGGBB` / `#rrggbb` -> `#RRGGBB`; anything else -> None."""
    if not isinstance(value, str):
        return None
    match = _HEX_RE.match(value.strip())
    if not match:
        return None
    digits = match.group(1)
    if len(digits) == 3:
        digits = "".join(c * 2 for c in digits)
    return f"#{digits.upper()}"


def resolve_brand_color(value: str | None) -> str:
    hex_value = normalize_brand_hex(value)
    if not hex_value or hex_value in _LEGACY_DEFAULT_BRAND_COLORS:
        return DEFAULT_BRAND_COLOR
    return hex_value


ONBOARDING_SYSTEM_PROMPT = """You are the Bokito onboarding assistant. Interview the user about their organization:
what they do, who their customers are, how they operate, and their tone of voice.
Use write_doc to document findings in workspace docs (company.md, memory.md, persona.md).
Use suggest_integration when relevant integrations would help.
Ask clarifying questions before writing docs. Be concise and friendly.

The operator may already have filled a short intake (how they found Bokito, org size,
primary use) during the first-run wizard. Do not re-ask those facts; use them as context
and deepen from there.

You can set the workspace up from this chat. Use your tools instead of sending
people to settings pages unless they ask to click themselves.

When the user asks for help setting up the workspace, guide them through
these steps one at a time:
1. Channel - connect where customers reach them (Bokito address or mailbox
   first). Point them to Email & messages, not the module marketplace.
2. Talk - interview them and document the organization (company.md) in this
   chat.
3. Brief - once company.md says what the business does, draft your own
   working brief from it with update_agent on yourself (use list_agents to
   find your id): a one-line description (who you serve, what you handle,
   what you leave to people) and a system prompt in the company's language
   and tone that names their services, customers and house rules. Do the
   same for any other agent they ask for. The change lands in Govern for
   approval; tell them it is waiting there and do not apply it yourself.
4. One decision - make sure they have seen and approved a decision card
   (the brief from step 3 counts).
5. Check-in / watching - use get_platform_watch and set_platform_watch
   (enabled true) so you watch the workspace. The check-in starts paused;
   turn it on when they want watching. Findings land in your own channel in
   Communication. Keep heartbeat.md as the checklist you work through when
   you wake.
After those, offer later work without numbering it as setup: branding
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
        "# Daily check-in\n\n- Review open conversations needing a reply\n- Check pending decisions\n- If company.md or open threads mention work a business module covers (see list_modules) and that module is off, use recommend_module once; never repeat an open or declined recommendation; otherwise HEARTBEAT_OK\n",
    ),
]


async def ensure_front_desk(
    session: AsyncSession, tenant_id: UUID, *, commit: bool = False
) -> Agent:
    """Ensure the workspace has its Front desk default agent."""
    from sqlalchemy import select

    existing = (
        await session.execute(
            select(Agent)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.kind == "company",
                Agent.acts_for_user.is_(False),
                Agent.slug == "front-desk",
            )
            .limit(1)
        )
    ).scalars().first()
    if existing:
        # Keep the customer-facing mark consistent when older tenants have none.
        from app.services.agent_avatar import avatar_payload

        changed = False
        # The workspace's first agent must be reachable from Communication;
        # one tenant's lead sat on chat_access=nobody and nobody could brief it.
        if existing.is_lead and existing.chat_access == "nobody":
            existing.chat_access = "everyone"
            changed = True
        av = avatar_payload(existing)
        if av.get("avatar_kind") == "initials" and not av.get("avatar_icon"):
            try:
                stored = json.loads(existing.settings_json or "{}")
            except json.JSONDecodeError:
                stored = {}
            if not isinstance(stored, dict):
                stored = {}
            stored.update(
                {
                    "avatar_kind": "icon",
                    "avatar_icon": "headset",
                    "avatar_color": stored.get("avatar_color") or "#7c3aed",
                }
            )
            existing.settings_json = json.dumps(stored)
            changed = True
        if changed:
            session.add(existing)
            if commit:
                await session.commit()
                await session.refresh(existing)
            else:
                await session.flush()
        return existing
    # Only claim the workspace lead when none exists yet. Older tenants may
    # already have a lead (e.g. a project PO); customer routing uses
    # ChannelAccount.default_agent_id → Front desk, not the lead flag.
    has_lead = (
        await session.execute(
            select(Agent.id)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.kind == "company",
                Agent.is_lead.is_(True),
                Agent.is_active.is_(True),
                Agent.acts_for_user.is_(False),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    agent = Agent(
        tenant_id=tenant_id,
        name="Front desk",
        role="assistant",
        slug="front-desk",
        description=(
            "First reply on every channel: answers from the workspace docs, "
            "drafts for the team, and hands over when a person is needed."
        ),
        chat_access="everyone",
        system_prompt=ONBOARDING_SYSTEM_PROMPT,
        is_active=True,
        is_lead=has_lead is None,
        settings_json=json.dumps(
            {
                "avatar_kind": "icon",
                "avatar_icon": "headset",
                "avatar_color": "#7c3aed",
            }
        ),
    )
    session.add(agent)
    if commit:
        await session.commit()
        await session.refresh(agent)
    else:
        await session.flush()
    return agent


async def ensure_widget_default_agent(
    session: AsyncSession, tenant_id: UUID, front_desk: Agent, *, commit: bool = False
) -> ChannelAccount:
    """Bind the website chat to Front desk when unset or pointing at Bokito / inactive."""
    from sqlalchemy import select

    widget = await ensure_widget_channel(session, tenant_id, commit=False)
    current = None
    if widget.default_agent_id:
        current = (
            await session.execute(
                select(Agent).where(
                    Agent.id == widget.default_agent_id,
                    Agent.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
    needs_front_desk = current is None or current.acts_for_user or not current.is_active
    if needs_front_desk and widget.default_agent_id != front_desk.id:
        widget.default_agent_id = front_desk.id
        session.add(widget)
    if commit:
        await session.commit()
        await session.refresh(widget)
    else:
        await session.flush()
    return widget


async def ensure_front_desks(session: AsyncSession) -> int:
    """Startup backfill: Front desk agent + widget default binding per tenant."""
    from sqlalchemy import select

    tenant_ids = list((await session.execute(select(Tenant.id))).scalars().all())
    for tenant_id in tenant_ids:
        front_desk = await ensure_front_desk(session, tenant_id, commit=False)
        await ensure_widget_default_agent(session, tenant_id, front_desk, commit=False)
    # Whatever agent carries the lead flag must be reachable by the team.
    unreachable_leads = (
        await session.execute(
            select(Agent).where(
                Agent.kind == "company",
                Agent.is_lead.is_(True),
                Agent.is_active.is_(True),
                Agent.acts_for_user.is_(False),
                Agent.chat_access == "nobody",
            )
        )
    ).scalars().all()
    for lead in unreachable_leads:
        lead.chat_access = "everyone"
        session.add(lead)
    if tenant_ids:
        await session.commit()
    return len(tenant_ids)


async def bootstrap_tenant(session: AsyncSession, tenant_id: UUID) -> None:
    # Persona lives in the persona.md workspace doc (DEFAULT_DOCS below);
    # inbox policy lives in Tenant.settings_json (services/channel_ai.py).
    front_desk = await ensure_front_desk(session, tenant_id, commit=False)
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
    # a paused hourly check-in (operator or setup turns watching on). The Agent
    # row is the single runtime passport.
    # Email stays empty until someone connects a mailbox or creates a Bokito
    # relay address. The website chat is the one channel that works the moment
    # the widget is embedded, so it gets a row to carry state and an off switch.
    await ensure_widget_default_agent(session, tenant_id, front_desk, commit=False)
    await seed_default_triggers(session, tenant_id)
    from app.services.tickets import ensure_platform_tags

    await ensure_platform_tags(session, tenant_id, commit=False)


async def ensure_widget_channel(
    session: AsyncSession, tenant_id: UUID, *, commit: bool = True
) -> ChannelAccount:
    """The website chat as a real channel row (state, pause, agent binding)."""
    from sqlalchemy import select as sa_select

    existing = (
        await session.execute(
            sa_select(ChannelAccount)
            .where(
                ChannelAccount.tenant_id == tenant_id,
                ChannelAccount.channel == "widget",
            )
            .order_by(ChannelAccount.created_at)
        )
    ).scalars().first()
    tenant = (
        await session.execute(sa_select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one()
    if existing:
        from app.services.widget_channel import merge_widget_settings_from_tenant

        merge_widget_settings_from_tenant(tenant, existing)
        return existing
    from app.services.widget_channel import merge_widget_settings_from_tenant

    account = ChannelAccount(
        tenant_id=tenant_id,
        channel="widget",
        provider="widget",
        address=tenant.slug,
        display_name="Website chat",
        is_enabled=True,
        settings_json=json.dumps({"ai_config": {"ai_handling": {"mode": "autonomous"}}}),
    )
    merge_widget_settings_from_tenant(tenant, account)
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
        # AI handling: workspace default (assisted drafts for approval); the
        # website chat channel is seeded autonomous in ensure_widget_channel.
        "ai_handling": {"default": {"mode": "assisted"}},
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
    # New workspaces must complete the first-run wizard once. Legacy tenants
    # without this key are never force-redirected.
    base["onboarding"] = {"wizard_required": True}
    # Bokito AI: Automatic — Bokito picks Maki / Bokito / Kong per action.
    # Agents on Workspace default inherit this until an admin pins a tier.
    base["models"] = {
        "workspace_chat_mode": "automatic",
        "default_chat": "",
        "default_embedding": "",
        "allowed_chat": [],
        "non_eu_platform_models": "blocked",
    }
    return base


def serialize_settings(settings: dict) -> str:
    return json.dumps(settings)
