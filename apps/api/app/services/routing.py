"""Deterministic inbound routing: conversation pin, then the tree (``org_routing``)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.channel import ChannelAccount
from app.models.signal import Signal


async def _agent_by_id(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> Agent | None:
    result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if agent and agent.is_active:
        return agent
    return None


async def _account(
    session: AsyncSession, tenant_id: UUID, *, channel_account_id: UUID | None, channel: str
) -> ChannelAccount | None:
    if channel_account_id:
        return (
            await session.execute(
                select(ChannelAccount).where(
                    ChannelAccount.id == channel_account_id,
                    ChannelAccount.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
    if not channel:
        return None
    return (
        await session.execute(
            select(ChannelAccount)
            .where(ChannelAccount.tenant_id == tenant_id, ChannelAccount.channel == channel)
            .order_by(ChannelAccount.created_at)
            .limit(1)
        )
    ).scalars().first()


async def channel_home_agent(
    session: AsyncSession, tenant_id: UUID, account: ChannelAccount | None
) -> Agent | None:
    """The agent that picks up at the channel's home node (the organization when unset)."""
    from app.services.org_routing import route_to_node
    from app.services.teams import get_team, org_root

    home = None
    if account is not None and account.routing_department_id:
        home = await get_team(session, tenant_id, account.routing_department_id)
    route = await route_to_node(session, tenant_id, home or await org_root(session, tenant_id), account=account)
    return route.agent


async def resolve_agent_for_channel(
    session: AsyncSession,
    tenant_id: UUID,
    channel: str,
    *,
    channel_account_id: UUID | None = None,
    contact_id: UUID | None = None,
) -> Agent | None:
    """The channel home's point of contact, then lead / any company agent that may handle it."""
    del contact_id  # contact-level routing was retired with legacy bindings
    account = await _account(session, tenant_id, channel_account_id=channel_account_id, channel=channel)
    from app.services.channel_access import agents_that_can_handle

    home = await channel_home_agent(session, tenant_id, account)
    if home is not None:
        return home

    from app.services.lead_agent import lead_agent_id

    result = await session.execute(
        select(Agent)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.kind == "company",
            Agent.is_active.is_(True),
            Agent.acts_for_user.is_(False),
        )
        .order_by(Agent.created_at)
    )
    lead_id = await lead_agent_id(session, tenant_id)
    candidates = sorted(result.scalars().all(), key=lambda a: a.id != lead_id)
    allowed = await agents_that_can_handle(
        session, account, [c.id for c in candidates]
    )
    for candidate in candidates:
        if candidate.id in allowed:
            return candidate
    return None


async def _pinned_company_agent(session: AsyncSession, signal: Signal) -> Agent | None:
    """Thread-level company pin when the agent may handle this channel."""
    if not signal.agent_id:
        return None
    from app.services.channel_access import agent_can_handle

    pinned = await _agent_by_id(session, signal.tenant_id, signal.agent_id)
    if not pinned or pinned.kind != "company":
        return None
    account = (
        await session.get(ChannelAccount, signal.channel_account_id)
        if signal.channel_account_id
        else None
    )
    if await agent_can_handle(session, account, pinned.id, signal=signal):
        return pinned
    return None


async def _workspace_default_agent(
    session: AsyncSession, tenant_id: UUID, account: ChannelAccount | None
) -> Agent | None:
    """The workspace lead, when that agent may handle this channel."""
    from app.services.channel_access import agent_can_handle
    from app.services.lead_agent import get_lead_agent

    lead = await get_lead_agent(session, tenant_id)
    if lead is None:
        return None
    if await agent_can_handle(session, account, lead.id):
        return lead
    return None


async def resolve_inbound_agent_for_signal(
    session: AsyncSession, signal: Signal
) -> Agent | None:
    """Agent for automatic inbound AI.

    Thread pin, then the point of contact of the conversation's node: its
    responsible department, else the channel home, else the organization.
    A node without a usable contact hands the work to its people, or walks
    up. While org rules are off, the lead still answers when the tree gives
    no agent.
    """
    pinned = await _pinned_company_agent(session, signal)
    if pinned is not None:
        return pinned
    from app.services.org_routing import home_department, route_to_node
    from app.services.org_rules import org_rules_on

    account = (
        await session.get(ChannelAccount, signal.channel_account_id)
        if signal.channel_account_id
        else None
    )
    node = await home_department(session, signal)
    route = await route_to_node(session, signal.tenant_id, node, account=account, signal=signal)
    if route.agent is not None:
        return route.agent
    if await org_rules_on(session, signal.tenant_id):
        return None
    return await _workspace_default_agent(session, signal.tenant_id, account)


async def resolve_agent_for_signal(session: AsyncSession, signal: Signal) -> Agent | None:
    """Agent for this thread: a thread-level pin wins, else the channel home (+ fallback).

    ``Signal.agent_id`` is the handling agent of that one conversation (set
    when an agent takes it over, or when it raised the thread). Honouring it
    keeps a conversation with the agent that has been in it. Prefer
    ``resolve_inbound_agent_for_signal`` for the inbound worker.
    """
    pinned = await _pinned_company_agent(session, signal)
    if pinned is not None:
        return pinned

    return await resolve_agent_for_channel(
        session,
        signal.tenant_id,
        signal.channel,
        channel_account_id=signal.channel_account_id,
        contact_id=signal.contact_id,
    )
