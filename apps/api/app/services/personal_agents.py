"""Company chat targets — who a member may start a direct agent chat with.

Personal assistants (kind=\"personal\") are retired. Members pick a company
agent they are allowed to chat with; if none are available the API returns
an empty list / 409.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentChatUser
from app.models.auth import User, UserPreference

NO_AGENTS_DETAIL = "No agents available for user"


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
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    agent_id: UUID | None,
    *,
    is_admin: bool = False,
) -> Agent:
    """Resolve a company chat target. ``agent_id`` is required.

    Raises 409 when the user has no permitted company agents, 400 when
    ``agent_id`` is missing, 403 when the chosen agent is not permitted.
    """
    company = await allowed_company_agents(
        session, tenant_id, user.id, is_admin=is_admin
    )
    if not company:
        raise HTTPException(status_code=409, detail=NO_AGENTS_DETAIL)

    if agent_id is None:
        raise HTTPException(
            status_code=400,
            detail="Choose which agent to talk to",
        )
    by_id = {a.id: a for a in company}
    agent = by_id.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=403, detail="Agent not available for chat")
    return agent


async def deactivate_personal_agents(session: AsyncSession) -> int:
    """Soft-retire legacy personal assistants. Clears prefs pointing at them."""
    personal_ids = list(
        (
            await session.execute(
                select(Agent.id).where(Agent.kind == "personal", Agent.is_active.is_(True))
            )
        ).scalars().all()
    )
    if not personal_ids:
        return 0
    await session.execute(
        update(Agent)
        .where(Agent.id.in_(personal_ids))
        .values(is_active=False, runtime_status="paused")
    )
    await session.execute(
        update(UserPreference)
        .where(UserPreference.default_chat_agent_id.in_(personal_ids))
        .values(default_chat_agent_id=None)
    )
    await session.commit()
    return len(personal_ids)
