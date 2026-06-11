"""Seed tenant orchestration defaults (runtime profiles, demo workstream)."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.orchestration import RuntimeProfile
from app.models.orchestra import Workstream, WorkstreamStep


async def seed_tenant_runtime_profiles(session: AsyncSession, tenant_id: UUID) -> dict[str, RuntimeProfile]:
    profiles_spec = [
        ("planner-fast", "Planner (Fast)", "planner", "claude-haiku-4-20250514", 15),
        ("executor-standard", "Executor (Standard)", "executor", "claude-sonnet-4-20250514", 25),
        ("judge-careful", "Judge (Careful)", "judge", "claude-sonnet-4-20250514", 10),
    ]
    out: dict[str, RuntimeProfile] = {}
    for slug, name, role_tag, model, max_loops in profiles_spec:
        existing = await session.execute(
            select(RuntimeProfile).where(RuntimeProfile.tenant_id == tenant_id, RuntimeProfile.slug == slug)
        )
        row = existing.scalar_one_or_none()
        if not row:
            row = RuntimeProfile(
                tenant_id=tenant_id,
                name=name,
                slug=slug,
                role_tag=role_tag,
                model=model,
                max_loops=max_loops,
            )
            session.add(row)
            await session.flush()
        out[slug] = row
    return out


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
    profiles = await seed_tenant_runtime_profiles(session, tenant_id)

    if assistant and profiles.get("executor-standard"):
        assistant.default_runtime_profile_id = profiles["executor-standard"].id

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
            runtime_profile_id=profiles.get("planner-fast").id if profiles.get("planner-fast") else None,
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
                runtime_profile_id=profiles.get("executor-standard").id if profiles.get("executor-standard") else None,
                name="Plan action",
                step_kind="agent",
                handoff_template="Based on triage output, propose concrete next actions.\n\nPrior output:\n{{step_outputs}}",
                success_criteria_json=json.dumps({"min_length": 30}),
                eval_kind="rubric",
            )
            session.add(step2)

    return ws
