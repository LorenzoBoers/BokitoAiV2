"""Where work lands in the tree.

A node's point of contact picks up. Without one, its people do (pickup
mode). Without either, the work walks up to the parent, ending at the
organization and its lead.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.channel import ChannelAccount
from app.models.signal import Signal
from app.models.team import Department, is_root_department


@dataclass
class Route:
    node: Department | None
    agent: Agent | None = None
    instruction: str = ""
    people: list[UUID] = field(default_factory=list)
    addressed: Department | None = None

    @property
    def walked_up(self) -> bool:
        return bool(self.node and self.addressed and self.node.id != self.addressed.id)


async def route_to_node(
    session: AsyncSession,
    tenant_id: UUID,
    department: Department,
    *,
    account: ChannelAccount | None = None,
    signal: Signal | None = None,
    skip_user: UUID | None = None,
) -> Route:
    """Point of contact of ``department``, else its people, else the same one level up."""
    from app.services.channel_access import agent_can_handle
    from app.services.teams import get_team, org_root, team_user_ids
    from app.services.thread_dispatch import addressed_agent

    node: Department | None = department
    seen: set[UUID] = set()
    while node is not None and node.id not in seen:
        seen.add(node.id)
        contact, instruction = await addressed_agent(session, tenant_id, node)
        if (
            contact is not None
            and contact.is_active
            and await agent_can_handle(session, account, contact.id, signal=signal)
        ):
            return Route(node=node, agent=contact, instruction=instruction, addressed=department)
        if is_root_department(node):
            break
        people = [uid for uid in await team_user_ids(session, node) if uid != skip_user]
        if people:
            return Route(node=node, people=people, addressed=department)
        parent = await get_team(session, tenant_id, node.parent_id) if node.parent_id else None
        node = parent or await org_root(session, tenant_id)
    return Route(node=None, addressed=department)


async def home_department(session: AsyncSession, signal: Signal) -> Department:
    """The node a conversation lands on: its responsible department, else the channel home, else the root."""
    from app.services.department_domain import department_of_signal
    from app.services.teams import get_team, org_root

    department_id = await department_of_signal(session, signal)
    department = await get_team(session, signal.tenant_id, department_id) if department_id else None
    if department is not None and not is_root_department(department):
        return department
    if signal.channel_account_id:
        account = await session.get(ChannelAccount, signal.channel_account_id)
        if account is not None and account.routing_department_id:
            home = await get_team(session, signal.tenant_id, account.routing_department_id)
            if home is not None:
                return home
    return department or await org_root(session, signal.tenant_id)
