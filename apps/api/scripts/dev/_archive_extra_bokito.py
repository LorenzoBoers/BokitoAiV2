"""Archive company agents named like the helper that are not acts_for_user.

The real helper is the one row per tenant with acts_for_user=true. A second
row (dev, 2026-10-19: id 8d4dede2-751e-4475-b614-206a8415c577, slug
bokito-assistant) shows up in Agents and Grid. This sets is_active=false.
It does not delete messages.

    cd apps/api && ./.venv/bin/python scripts/dev/_archive_extra_bokito.py
"""

from __future__ import annotations

import asyncio

from sqlalchemy import or_, select

from app.db.session import async_session_factory
from app.models.agent import Agent


async def main() -> None:
    async with async_session_factory() as session:
        rows = (
            await session.execute(
                select(Agent).where(
                    Agent.acts_for_user.is_(False),
                    or_(
                        Agent.name.ilike("bokito assistant"),
                        Agent.slug.ilike("bokito-assistant"),
                    ),
                )
            )
        ).scalars().all()
        for agent in rows:
            agent.is_active = False
            session.add(agent)
            print(f"archived {agent.id} tenant={agent.tenant_id} name={agent.name!r}")
        await session.commit()
        if not rows:
            print("nothing to archive")


if __name__ == "__main__":
    asyncio.run(main())
