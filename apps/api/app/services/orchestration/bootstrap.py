"""Seed tenant orchestration defaults (demo workstream)."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.orchestra import Workstream, WorkstreamStep


async def seed_demo_workstream(session: AsyncSession, tenant_id: UUID) -> Workstream | None:
    existing = await session.execute(
        select(Workstream).where(Workstream.tenant_id == tenant_id, Workstream.name == "Ops Triage Pipeline")
    )
    if existing.scalar_one_or_none():
        return None

    assistant = (
        await session.execute(
            select(Agent).where(Agent.tenant_id == tenant_id, Agent.role == "assistant").limit(1)
        )
    ).scalar_one_or_none()
    orchestrator = (
        await session.execute(
            select(Agent).where(Agent.tenant_id == tenant_id, Agent.role == "orchestrator").limit(1)
        )
    ).scalar_one_or_none()

    ws = Workstream(
        tenant_id=tenant_id,
        name="Ops Triage Pipeline",
        description="Triage then action: assistant classifies, orchestrator plans follow-up.",
        enabled=True,
    )
    session.add(ws)
    await session.flush()

    if assistant:
        step1 = WorkstreamStep(
            tenant_id=tenant_id,
            workstream_id=ws.id,
            order=0,
            agent_id=assistant.id,
            name="Triage",
            step_kind="agent",
            handoff_template="Classify and summarize the operational task.\n\n{{task_description}}",
            success_criteria_json=json.dumps({"min_length": 20}),
            eval_kind="rubric",
        )
        session.add(step1)
        await session.flush()

        if orchestrator:
            step2 = WorkstreamStep(
                tenant_id=tenant_id,
                workstream_id=ws.id,
                order=1,
                agent_id=orchestrator.id,
                name="Plan action",
                step_kind="agent",
                handoff_template="Based on triage output, propose concrete next actions.\n\nPrior output:\n{{step_outputs}}",
                success_criteria_json=json.dumps({"min_length": 30}),
                eval_kind="rubric",
            )
            session.add(step2)

    return ws
