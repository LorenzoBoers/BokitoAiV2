"""Supersede U10c duplicates, reveal one card, clear stuck working bubble."""
from __future__ import annotations

import asyncio
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, text

from app.db.session import async_session_factory
from app.models.agent import Agent
from app.models.notification import DecisionRequest
from app.services.signal_decisions import reveal_decision
from app.services.workforce_runtime import mark_agent_activity

ASK = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")
ORCH = UUID("cc965b16-aff8-44a2-a0ea-29ebd4e5bccf")
KEEP = UUID("aa2fed87-d4a2-4d3e-bc44-513794770542")


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                select(DecisionRequest).where(
                    DecisionRequest.signal_id == ASK,
                    DecisionRequest.title == "U10c klaar?",
                    DecisionRequest.status == "awaiting_human",
                    DecisionRequest.message_id.is_(None),
                )
            )
        ).scalars().all()
        for d in rows:
            if d.id == KEEP:
                continue
            d.status = "deferred"
            d.chosen_option_id = "superseded"
            d.resolved_at = datetime.utcnow()
            s.add(d)
        keep = await s.get(DecisionRequest, KEEP)
        if keep is None:
            print("missing keep")
            return
        msg = await reveal_decision(s, keep.tenant_id, keep)
        await s.execute(
            text(
                """
                DELETE FROM signal_messages
                WHERE signal_id = :sid
                  AND body_text = 'Working on this.'
                  AND kind = 'agent_message'
                  AND created_at > now() - interval '20 minutes'
                """
            ),
            {"sid": str(ASK)},
        )
        agent = await s.get(Agent, ORCH)
        if agent is not None:
            await mark_agent_activity(s, agent, status="standby", summary="")
        await s.execute(
            text(
                """
                UPDATE agent_runs
                SET status = 'cancelled'
                WHERE agent_id = :aid
                  AND signal_id = :sid
                  AND status IN ('running', 'queued', 'in_progress', 'active', 'pending')
                """
            ),
            {"aid": str(ORCH), "sid": str(ASK)},
        )
        await s.commit()
        print("revealed", keep.id, "msg", msg.id if msg else None)


if __name__ == "__main__":
    asyncio.run(main())
