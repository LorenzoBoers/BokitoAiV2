"""Deterministic inbound routing: conversation pin -> channel default."""

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


async def resolve_agent_for_channel(
    session: AsyncSession,
    tenant_id: UUID,
    channel: str,
    *,
    channel_account_id: UUID | None = None,
    contact_id: UUID | None = None,
) -> Agent | None:
    """Pick the channel account's default, then lead / Front desk / any company agent."""
    del contact_id  # contact-level routing was retired with legacy bindings
    account: ChannelAccount | None = None
    if channel_account_id:
        account = (
            await session.execute(
                select(ChannelAccount).where(
                    ChannelAccount.id == channel_account_id,
                    ChannelAccount.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
    elif channel:
        account = (
            await session.execute(
                select(ChannelAccount)
                .where(
                    ChannelAccount.tenant_id == tenant_id,
                    ChannelAccount.channel == channel,
                )
                .order_by(ChannelAccount.created_at)
                .limit(1)
            )
        ).scalars().first()
    from app.services.channel_access import agent_can_handle, agents_that_can_handle

    if account and account.default_agent_id:
        selected = await _agent_by_id(session, tenant_id, account.default_agent_id)
        if selected and await agent_can_handle(session, account, selected.id):
            return selected

    result = await session.execute(
        select(Agent)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.kind == "company",
            Agent.is_active.is_(True),
            Agent.acts_for_user.is_(False),
        )
        .order_by(Agent.is_lead.desc(), Agent.created_at)
    )
    candidates = list(result.scalars().all())
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
    if await agent_can_handle(session, account, pinned.id):
        return pinned
    return None


async def resolve_channel_default_agent(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    channel_account_id: UUID | None = None,
    channel: str = "",
) -> Agent | None:
    """Only the channel account's explicit default agent (no lead / Front desk fallback)."""
    account: ChannelAccount | None = None
    if channel_account_id:
        account = (
            await session.execute(
                select(ChannelAccount).where(
                    ChannelAccount.id == channel_account_id,
                    ChannelAccount.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
    elif channel:
        account = (
            await session.execute(
                select(ChannelAccount)
                .where(
                    ChannelAccount.tenant_id == tenant_id,
                    ChannelAccount.channel == channel,
                )
                .order_by(ChannelAccount.created_at)
                .limit(1)
            )
        ).scalars().first()
    if not account or not account.default_agent_id:
        return None
    from app.services.channel_access import agent_can_handle

    selected = await _agent_by_id(session, tenant_id, account.default_agent_id)
    if selected and await agent_can_handle(session, account, selected.id):
        return selected
    return None


async def _workspace_default_agent(
    session: AsyncSession, tenant_id: UUID, account: ChannelAccount | None
) -> Agent | None:
    """The workspace lead, when that agent may handle this channel.

    A channel with no explicit agent follows this lead. ``Standaard`` on the
    channel page is the same agent.
    """
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

    Thread pin, then the channel's own agent, then the workspace lead. Each
    step only counts when that agent may handle the channel. A channel left on
    Standaard therefore uses the workspace lead.
    """
    pinned = await _pinned_company_agent(session, signal)
    if pinned is not None:
        return pinned
    explicit = await resolve_channel_default_agent(
        session,
        signal.tenant_id,
        channel_account_id=signal.channel_account_id,
        channel=signal.channel or "",
    )
    if explicit is not None:
        return explicit
    account = (
        await session.get(ChannelAccount, signal.channel_account_id)
        if signal.channel_account_id
        else None
    )
    return await _workspace_default_agent(session, signal.tenant_id, account)


async def resolve_agent_for_signal(session: AsyncSession, signal: Signal) -> Agent | None:
    """Agent for this thread: a thread-level pin wins, else channel default (+ fallback).

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
