"""Deterministic inbound routing: channel/contact/account -> agent.

ChannelBinding rows map inbound threads to agents (OpenClaw agents.mapping
style). Most specific match wins: contact > channel account > channel-wide.
Falls back to the tenant's lead agent.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.channel import ChannelBinding
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
    """Pick the agent bound to this channel/account/contact, else the assistant."""
    result = await session.execute(
        select(ChannelBinding)
        .where(
            ChannelBinding.tenant_id == tenant_id,
            ChannelBinding.enabled.is_(True),
            ChannelBinding.channel == channel,
        )
        .order_by(ChannelBinding.priority.desc())
    )
    bindings = list(result.scalars().all())

    contact_matches = [b for b in bindings if b.contact_id and b.contact_id == contact_id]
    account_matches = [
        b
        for b in bindings
        if not b.contact_id
        and b.channel_account_id
        and b.channel_account_id == channel_account_id
    ]
    channel_matches = [b for b in bindings if not b.contact_id and not b.channel_account_id]

    for binding in (*contact_matches, *account_matches, *channel_matches):
        agent = await _agent_by_id(session, tenant_id, binding.agent_id)
        if agent:
            return agent

    # No binding: the tenant's lead agent handles it (company agents only;
    # personal assistants belong to one user).
    from app.services.lead_agent import get_lead_agent

    return await get_lead_agent(session, tenant_id)


async def resolve_agent_for_signal(session: AsyncSession, signal: Signal) -> Agent | None:
    """Agent for this thread: a thread-level pin wins, else channel bindings.

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
