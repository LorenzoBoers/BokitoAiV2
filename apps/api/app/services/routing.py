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
    """Pick the channel account's default, then the customer-facing front desk."""
    del channel, contact_id  # selection no longer varies by channel/contact hierarchy
    if channel_account_id:
        account = (
            await session.execute(
                select(ChannelAccount).where(
                    ChannelAccount.id == channel_account_id,
                    ChannelAccount.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if account and account.default_agent_id:
            selected = await _agent_by_id(session, tenant_id, account.default_agent_id)
            if selected:
                return selected

    result = await session.execute(
        select(Agent)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.kind == "company",
            Agent.is_active.is_(True),
            Agent.audience == "customers",
        )
        .order_by(Agent.created_at)
        .limit(1)
    )
    return result.scalars().first()


async def resolve_agent_for_signal(session: AsyncSession, signal: Signal) -> Agent | None:
    """Agent for this thread: a thread-level pin wins, else channel default.

    ``Signal.agent_id`` is the handling agent of that one conversation (set
    when an agent takes it over, or when it raised the thread). Honouring it
    keeps a conversation with the agent that has been in it.
    """
    if signal.agent_id:
        pinned = await _agent_by_id(session, signal.tenant_id, signal.agent_id)
        if pinned and pinned.kind == "company":
            return pinned

    return await resolve_agent_for_channel(
        session,
        signal.tenant_id,
        signal.channel,
        channel_account_id=signal.channel_account_id,
        contact_id=signal.contact_id,
    )
