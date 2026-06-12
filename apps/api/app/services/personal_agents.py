"""Personal assistants + chat target permissions.

Every user gets one personal Agent (kind="personal", owner_user_id set) per
tenant — their default chat target. Company agents (kind="company") can be
opened for direct chat when their chat_access allows the user.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentChatUser
from app.models.auth import Membership, User, UserPreference

PERSONAL_ASSISTANT_PROMPT = """You are {name}, the personal assistant of {owner}.
Help them with their daily work inside this workspace: answer questions, draft
messages and documents, look things up in workspace knowledge, and coordinate
with company agents when needed. Be concise, concrete, and proactive."""


def _assistant_name(user: User) -> str:
    base = (user.display_name or user.email.split("@")[0]).strip()
    first = base.split(" ")[0] if base else "My"
    return f"{first}'s assistant" if first != "My" else "My assistant"


async def get_personal_agent(
    session: AsyncSession, tenant_id: UUID, user_id: UUID
) -> Agent | None:
    result = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.kind == "personal",
            Agent.owner_user_id == user_id,
        )
    )
    return result.scalars().first()


def build_personal_agent(tenant_id: UUID, user: User) -> Agent:
    name = _assistant_name(user)
    return Agent(
        tenant_id=tenant_id,
        name=name,
        role="assistant",
        kind="personal",
        owner_user_id=user.id,
        chat_access="nobody",
        runtime_status="standby",
        system_prompt=PERSONAL_ASSISTANT_PROMPT.format(
            name=name, owner=user.display_name or user.email
        ),
    )


async def get_or_create_personal_agent(
    session: AsyncSession, tenant_id: UUID, user: User, *, commit: bool = True
) -> Agent:
    agent = await get_personal_agent(session, tenant_id, user.id)
    if agent:
        return agent
    agent = build_personal_agent(tenant_id, user)
    session.add(agent)
    if commit:
        await session.commit()
        await session.refresh(agent)
    else:
        await session.flush()
    return agent


async def allowed_company_agents(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, *, is_admin: bool = False
) -> list[Agent]:
    """Active company agents this user may chat with directly.

    Owners/admins see every active company agent regardless of chat_access,
    since they manage those agents anyway.
    """
    result = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.kind == "company",
            Agent.is_active.is_(True),
        )
    )
    agents = list(result.scalars().all())
    if is_admin:
        agents.sort(key=lambda a: a.name.lower())
        return agents
    selected_ids: set[UUID] = set()
    if any(a.chat_access == "selected" for a in agents):
        rows = await session.execute(
            select(AgentChatUser.agent_id).where(
                AgentChatUser.tenant_id == tenant_id,
                AgentChatUser.user_id == user_id,
            )
        )
        selected_ids = {r for r in rows.scalars().all()}
    allowed = [
        a
        for a in agents
        if a.chat_access == "everyone"
        or (a.chat_access == "selected" and a.id in selected_ids)
    ]
    allowed.sort(key=lambda a: a.name.lower())
    return allowed


async def get_user_preference(
    session: AsyncSession, tenant_id: UUID, user_id: UUID
) -> UserPreference | None:
    result = await session.execute(
        select(UserPreference).where(
            UserPreference.tenant_id == tenant_id,
            UserPreference.user_id == user_id,
        )
    )
    return result.scalars().first()


async def resolve_chat_target(
    session: AsyncSession, tenant_id: UUID, user: User, agent_id: UUID | None, *, is_admin: bool = False
) -> Agent:
    """Validate an explicit target, or fall back to preference -> personal agent."""
    personal = await get_or_create_personal_agent(session, tenant_id, user, commit=False)
    if agent_id is None:
        pref = await get_user_preference(session, tenant_id, user.id)
        agent_id = pref.default_chat_agent_id if pref else None
        if agent_id is None or agent_id == personal.id:
            return personal
    if agent_id == personal.id:
        return personal
    for agent in await allowed_company_agents(session, tenant_id, user.id, is_admin=is_admin):
        if agent.id == agent_id:
            return agent
    return personal


async def provision_missing_personal_agents(session: AsyncSession) -> int:
    """Backfill: one personal assistant per membership. Returns count created."""
    memberships = (await session.execute(select(Membership))).scalars().all()
    existing = (
        await session.execute(
            select(Agent.tenant_id, Agent.owner_user_id).where(Agent.kind == "personal")
        )
    ).all()
    have = {(t, u) for t, u in existing}
    users = {u.id: u for u in (await session.execute(select(User))).scalars().all()}
    created = 0
    for m in memberships:
        if (m.tenant_id, m.user_id) in have:
            continue
        user = users.get(m.user_id)
        if not user or not user.is_active:
            continue
        session.add(build_personal_agent(m.tenant_id, user))
        have.add((m.tenant_id, m.user_id))
        created += 1
    if created:
        await session.commit()
    return created
