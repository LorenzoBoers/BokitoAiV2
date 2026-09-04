"""The personal Bokito assistant: every user's helper inside the platform.

One agent row per tenant, seeded and owned by the platform rather than the
tenant. It is not a company agent, so it never shows up as a chat target or
as a folder in the Messages Agents section — members reach it through the
widget launcher and its own rail section.

Division of labour with tenant agents:

* Tenant agents do the work — reply to customers, keep the books, run
  workstreams, move projects forward.
* The personal assistant helps a person *operate Bokito* — explain a screen,
  find a feature, cite the product help, set something up within that
  person's own permissions, and hand real execution to a tenant agent.

``kind`` is ``personal_assistant``, deliberately distinct from the retired
``personal`` kind that :mod:`app.services.personal_agents` keeps deactivating.
"""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent

PERSONAL_ASSISTANT_KIND = "personal_assistant"
PERSONAL_ASSISTANT_SLUG = "bokito"
PERSONAL_ASSISTANT_NAME = "Bokito"
PERSONAL_ASSISTANT_ROLE = "personal_assistant"

# Thread marker: private per-user helper conversations. Distinct from "chat"
# (operator DM with a company agent) and "widget" (site visitor).
PERSONAL_THREAD_SOURCE = "personal"

SYSTEM_PROMPT = """You are Bokito, the personal assistant of the person you are talking to.

You help them operate this platform. You are not the agent that does their
company's work: the tenant's own agents answer customers, keep the books and
run workstreams. Your job is to make the person effective inside Bokito.

What you do:
- Explain what they are looking at. Every turn carries the page they are on;
  ground your answer in that screen and its real labels.
- Answer how-to questions from the product help. Call search_product_help
  before you guess, and link to /docs/{section}/{slug} when it helps.
- Help them find things: which page, which setting, which agent, which run.
- Set things up with them when they ask, using their own permissions. If a
  change needs a role they do not have, say so plainly and offer to prepare
  it for an owner or admin instead.
- Hand real work to the tenant's agents. Use delegate_to_agent or create_task
  rather than doing operational work yourself, and tell the person which
  agent picked it up.
- Remember the person. Use remember_about_me for durable facts about how they
  work: their role, what they are learning, how they like answers. Never put
  company or customer data in there, because that memory follows them into
  every workspace they belong to.

What you do not do:
- You never reply to a customer, take over a conversation or close a thread.
  That is the tenant agents' work; offer to delegate instead.
- You never pretend a change happened. When a change needs approval it
  becomes a decision the person can see and approve.

Style: short, concrete, calm. Say what you did and what happens next. No
emoji. Answer in the language the person writes in."""

# Deliberate passport. Reading and understanding the workspace, proposing and
# setting up, delegating execution. Customer-facing execution and the module
# domain tools (accounting, banking, documents, calendar) are absent on
# purpose: those belong to the tenant's own agents.
TOOL_ALLOWLIST: tuple[str, ...] = (
    # Understand the platform and this workspace.
    "search_product_help",
    "search_index",
    "search_repo",
    "list_docs",
    "read_doc",
    "list_metrics",
    "list_threads",
    "list_tasks",
    "list_projects",
    "list_project_docs",
    "list_project_resources",
    "list_queue_items",
    "get_tenant_overview",
    "list_recent_activity",
    "get_usage_summary",
    "get_platform_watch",
    "list_modules",
    "list_module_connections",
    "list_module_sources",
    "search_module_sources",
    # Propose and set up, within the user's own role.
    "write_doc",
    "set_doc_section_status",
    "record_metric",
    "add_graph_node",
    "connect_graph_nodes",
    "create_agent",
    "update_agent",
    "create_workstream",
    "update_workstream",
    "set_platform_watch",
    "schedule_wake",
    "suggest_integration",
    "propose_integration",
    "recommend_module",
    "propose_module_source",
    "suggest_inbox_rule",
    "create_decision_request",
    "create_queue_item",
    "update_queue_item_status",
    "link_queue_item_to_doc",
    "propose_project_resource",
    # Hand work to the tenant's agents.
    "delegate_to_agent",
    "create_task",
    "schedule_task",
    # Personal memory that follows the user across workspaces.
    "remember_about_me",
)

_AVATAR_SETTINGS = {"avatar_kind": "icon", "avatar_icon": "sparkles", "avatar_color": "#0d9488"}


def _settings_json() -> str:
    return json.dumps({**_AVATAR_SETTINGS, "platform_owned": True})


async def get_personal_assistant(session: AsyncSession, tenant_id: UUID) -> Agent | None:
    """The tenant's Bokito helper row, or None when it has not been seeded."""
    result = await session.execute(
        select(Agent)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.kind == PERSONAL_ASSISTANT_KIND,
        )
        .order_by(Agent.created_at)
        .limit(1)
    )
    return result.scalars().first()


async def ensure_personal_assistant(
    session: AsyncSession, tenant_id: UUID, *, commit: bool = False
) -> Agent:
    """Idempotently seed the tenant's Bokito helper and keep it in sync.

    The prompt and passport are platform-owned, so they are refreshed on every
    call: a tenant cannot drift them, and shipping a better prompt reaches
    every workspace on the next boot.
    """
    agent = await get_personal_assistant(session, tenant_id)
    allowlist = json.dumps(list(TOOL_ALLOWLIST))
    if agent is None:
        agent = Agent(
            tenant_id=tenant_id,
            name=PERSONAL_ASSISTANT_NAME,
            role=PERSONAL_ASSISTANT_ROLE,
            kind=PERSONAL_ASSISTANT_KIND,
            slug=PERSONAL_ASSISTANT_SLUG,
            chat_access="everyone",
            runtime_status="standby",
            system_prompt=SYSTEM_PROMPT,
            tools_json=allowlist,
            autonomy_level="approval",
            settings_json=_settings_json(),
            is_lead=False,
        )
        session.add(agent)
    else:
        changed = False
        if agent.system_prompt != SYSTEM_PROMPT:
            agent.system_prompt = SYSTEM_PROMPT
            changed = True
        if agent.tools_json != allowlist:
            agent.tools_json = allowlist
            changed = True
        if not agent.is_active:
            agent.is_active = True
            changed = True
        if changed:
            agent.updated_at = datetime.utcnow()
            session.add(agent)
    if commit:
        await session.commit()
        await session.refresh(agent)
    else:
        await session.flush()
    return agent


async def list_user_assistant_threads(
    session: AsyncSession, user_id: UUID, *, limit: int = 50
) -> list[dict[str, object]]:
    """This person's Bokito threads across every workspace they belong to.

    Threads stay tenant-scoped (audit, tools and knowledge never cross a
    workspace boundary); only the *reading* fans out, and only over the
    memberships this user actually has.
    """
    from app.models.auth import Membership, Tenant
    from app.models.signal import Signal

    rows = (
        await session.execute(
            select(Signal, Tenant.slug, Tenant.name)
            .join(Tenant, Tenant.id == Signal.tenant_id)
            .join(
                Membership,
                (Membership.tenant_id == Signal.tenant_id)
                & (Membership.user_id == user_id),
            )
            .where(
                Signal.owner_user_id == user_id,
                Signal.source == PERSONAL_THREAD_SOURCE,
            )
            .order_by(Signal.updated_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": str(signal.id),
            "title": signal.subject,
            "workspace_id": str(signal.tenant_id),
            "workspace_slug": slug,
            "workspace_name": name,
            "updated_at": signal.updated_at.isoformat() if signal.updated_at else None,
        }
        for signal, slug, name in rows
    ]


async def ensure_personal_assistants(session: AsyncSession) -> int:
    """Startup backfill: every tenant gets exactly one Bokito helper."""
    from app.models.auth import Tenant

    tenant_ids = list((await session.execute(select(Tenant.id))).scalars().all())
    for tenant_id in tenant_ids:
        await ensure_personal_assistant(session, tenant_id, commit=False)
    if tenant_ids:
        await session.commit()
    return len(tenant_ids)
