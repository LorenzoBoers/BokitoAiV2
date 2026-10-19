"""Tenant bootstrap defaults on signup."""

import json
import re
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.services.language import platform_default_ui_language
from app.services.onboarding_setup import SETUP_SOP as ONBOARDING_SYSTEM_PROMPT
from app.services.personal_assistant import ensure_personal_assistant
from app.services.workspace import upsert_doc
from app.tools.policy import DEFAULT_AUTONOMY_POSTURE

__all__ = ["ONBOARDING_SYSTEM_PROMPT"]

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


async def purge_front_desk_agents(session: AsyncSession, *, commit: bool = False) -> int:
    """Force-archive every Front desk agent (slug ``front-desk``) in all tenants.

    Clears channel defaults that pointed at them and drops the lead flag.
    History stays; they disappear from the working roster.
    """
    from datetime import datetime

    from sqlalchemy import select, update

    rows = list(
        (
            await session.execute(
                select(Agent).where(
                    Agent.slug == "front-desk",
                    Agent.acts_for_user.is_(False),
                )
            )
        ).scalars().all()
    )
    if not rows:
        return 0
    now = datetime.utcnow()
    for agent in rows:
        await session.execute(
            update(ChannelAccount)
            .where(
                ChannelAccount.tenant_id == agent.tenant_id,
                ChannelAccount.default_agent_id == agent.id,
            )
            .values(default_agent_id=None)
        )
        agent.kind = "archived"
        agent.is_active = False
        agent.runtime_status = "standby"
        agent.is_lead = False
        agent.updated_at = now
        session.add(agent)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return len(rows)


async def ensure_front_desk(
    session: AsyncSession, tenant_id: UUID, *, commit: bool = False
) -> Agent | None:
    """Deprecated: Front desk agents are no longer seeded.

    Kept as a no-op so older call sites compile; returns None.
    """
    del session, tenant_id, commit
    return None


async def ensure_widget_default_agent(
    session: AsyncSession, tenant_id: UUID, front_desk: Agent | None = None, *, commit: bool = False
) -> ChannelAccount | None:
    """Clear a website chat whose pinned agent can no longer handle it.

    An empty ``default_agent_id`` means Standaard: the workspace lead. This
    does not write an agent id onto that empty chat, and it does not create a
    widget channel.
    """
    from sqlalchemy import select

    from app.services.widget_channel import get_widget_account

    del front_desk
    widget = await get_widget_account(session, tenant_id, None)
    if widget is None:
        return None
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
    # Null stays null so the channel keeps following the workspace lead.
    if current is None:
        return widget
    if (
        current.acts_for_user
        or not current.is_active
        or current.kind == "archived"
        or (current.slug or "").strip().lower() == "front-desk"
    ):
        widget.default_agent_id = None
        session.add(widget)
    if commit:
        await session.commit()
        await session.refresh(widget)
    else:
        await session.flush()
    return widget


async def disable_unused_seeded_widgets(session: AsyncSession) -> int:
    """Turn off auto-seeded website chats that never received a conversation.

    Seeded rows use ``address == tenant.slug``; operator-created ones use
    ``{slug}:{hex}``. Hides them from Communication → Channels until someone
    adds website chat explicitly.
    """
    from sqlalchemy import func, select

    from app.models.signal import Signal

    widgets = list(
        (
            await session.execute(
                select(ChannelAccount).where(
                    ChannelAccount.channel == "widget",
                    ChannelAccount.is_enabled.is_(True),
                    ChannelAccount.archived_at.is_(None),
                )
            )
        ).scalars().all()
    )
    if not widgets:
        return 0
    tenant_ids = {w.tenant_id for w in widgets}
    tenants = {
        t.id: t
        for t in (
            await session.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))
        ).scalars().all()
    }
    disabled = 0
    for widget in widgets:
        tenant = tenants.get(widget.tenant_id)
        if tenant is None or (widget.address or "") != tenant.slug:
            continue
        n = int(
            (
                await session.execute(
                    select(func.count())
                    .select_from(Signal)
                    .where(Signal.channel_account_id == widget.id)
                )
            ).scalar_one()
            or 0
        )
        if n > 0:
            continue
        widget.is_enabled = False
        session.add(widget)
        disabled += 1
    return disabled


async def ensure_front_desks(session: AsyncSession) -> int:
    """Startup: purge Front desk agents, tidy widgets, keep leads reachable."""
    from sqlalchemy import select

    purged = await purge_front_desk_agents(session, commit=False)
    await disable_unused_seeded_widgets(session)
    tenant_ids = list((await session.execute(select(Tenant.id))).scalars().all())
    for tenant_id in tenant_ids:
        await ensure_widget_default_agent(session, tenant_id, commit=False)
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
    await session.commit()
    return purged


async def bootstrap_tenant(session: AsyncSession, tenant_id: UUID) -> None:
    # Persona lives in the persona.md workspace doc (DEFAULT_DOCS below);
    # inbox policy lives in Tenant.settings_json (services/channel_ai.py).
    # No Front desk seed — operators create company agents as needed; routing
    # falls back to the lead agent (ensure_lead_agents on startup).
    # Platform furniture, not a tenant agent: every member's own Bokito helper.
    from app.services.teams import ensure_all_department

    await ensure_all_department(session, tenant_id)
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
    # Fresh tenants stay empty: no demo project, orchestrator, workstream, or
    # check-in. The personal Bokito helper and workspace docs are platform
    # furniture. The first company agent comes from the wizard. A daily
    # check-in appears only after an explicit yes (set_platform_watch).
    # Email and website chat stay empty until someone connects/creates them
    # under Settings → Channels (website chat via "Add channel").
    # No seeded check-in: see platform_watch.set_platform_watch.
    from app.services.tickets import ensure_platform_tags

    await ensure_platform_tags(session, tenant_id, commit=False)
    from app.services.bokito_model_nodes import ensure_default_model_nodes

    await ensure_default_model_nodes(session, tenant_id)


async def ensure_widget_channel(
    session: AsyncSession, tenant_id: UUID, *, commit: bool = True
) -> ChannelAccount:
    """Return the tenant's website chat, creating one only when explicitly needed.

    Prefer ``create_extra_widget_channel`` from Settings → Add channel for new
    installs. Callers that only want an existing row should use
    ``get_widget_account`` instead of this helper.
    """
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
    """Kept so older callers stay valid. New workspaces do not get a check-in."""
    del session, tenant_id


def default_tenant_settings() -> dict:
    base = {
        # Welcome copy and widget name are deliberately not seeded: empty means
        # "use the localized defaults" (welcome text in the workspace language,
        # widget name from the assistant/tenant name) until the tenant edits them.
        "appearance": {
            "main_color": DEFAULT_BRAND_COLOR,
            "powered_by": True,
        },
        # AI handling: workspace default (assisted drafts for approval).
        # Operator-created website chat defaults to autonomous on that channel.
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
