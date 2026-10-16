"""Force Orchestrator runtime_status standby and clear current signal."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory
from app.models.agent import Agent
from app.services.workforce_runtime import mark_agent_activity

ORCH = UUID("cc965b16-aff8-44a2-a0ea-29ebd4e5bccf")


async def main() -> None:
    async with async_session_factory() as s:
        before = (
            await s.execute(
                text(
                    """
                    SELECT runtime_status, current_activity_summary, current_signal_id
                    FROM agents WHERE id = :aid
                    """
                ),
                {"aid": str(ORCH)},
            )
        ).fetchone()
        print("before", before)
        agent = await s.get(Agent, ORCH)
        if agent is None:
            print("missing")
            return
        await mark_agent_activity(s, agent, status="standby", summary=None)
        await s.execute(
            text(
                """
                UPDATE agents
                SET runtime_status = 'standby',
                    current_activity_summary = NULL,
                    current_signal_id = NULL
                WHERE id = :aid
                """
            ),
            {"aid": str(ORCH)},
        )
        # cancel any non-terminal runs on this agent for the ask thread
        await s.execute(
            text(
                """
                UPDATE agent_runs
                SET status = 'cancelled'
                WHERE agent_id = :aid
                  AND status IN ('running', 'queued', 'in_progress', 'active', 'pending')
                """
            ),
            {"aid": str(ORCH)},
        )
        await s.commit()
        after = (
            await s.execute(
                text(
                    """
                    SELECT runtime_status, current_activity_summary, current_signal_id
                    FROM agents WHERE id = :aid
                    """
                ),
                {"aid": str(ORCH)},
            )
        ).fetchone()
        print("after", after)


if __name__ == "__main__":
    asyncio.run(main())
