"""Put Orchestrator back to standby after reclaimed chat run."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.agent import Agent
from app.services.workforce_runtime import mark_agent_activity

ORCH = UUID("cc965b16-aff8-44a2-a0ea-29ebd4e5bccf")


async def main() -> None:
    async with async_session_factory() as s:
        agent = (
            await s.execute(select(Agent).where(Agent.id == ORCH))
        ).scalar_one_or_none()
        if agent is None:
            print("no agent")
            return
        await mark_agent_activity(s, agent, status="standby", summary=None)
        await s.commit()
        print("standby ok", agent.id)


if __name__ == "__main__":
    asyncio.run(main())
