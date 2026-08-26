"""Workstream execution environment (AgentLoop-backed with runtime profiles)."""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun
from app.models.orchestra import WorkstreamStep
from app.services.agent.loop import AgentLoop
from app.services.orchestration.profiles import apply_snapshot_to_agent, resolve_runtime_snapshot


class ExecutionEnvironment:
    async def run_step(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        step_name: str,
        instructions: str,
        config: dict[str, Any],
        *,
        step: WorkstreamStep | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError


class MockExecutionEnvironment(ExecutionEnvironment):
    async def run_step(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        step_name: str,
        instructions: str,
        config: dict[str, Any],
        *,
        step: WorkstreamStep | None = None,
    ) -> dict[str, Any]:
        return {
            "status": "success",
            "output": f"Mock executed step '{step_name}' with instructions: {instructions[:100]}",
            "tokens_in": 100,
            "tokens_out": 50,
        }


class AgentLoopExecutionEnvironment(ExecutionEnvironment):
    async def _resolve_agent(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        config: dict[str, Any],
        step: WorkstreamStep | None,
        instructions: str = "",
    ) -> Agent:
        if step and step.agent_id:
            agent = (
                await session.execute(
                    select(Agent).where(Agent.id == step.agent_id, Agent.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
            if agent:
                return agent

        agent_id = config.get("agent_id")
        if agent_id:
            agent = (
                await session.execute(
                    select(Agent).where(Agent.id == UUID(str(agent_id)), Agent.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
            if agent:
                return agent

        from app.services.lead_agent import get_lead_agent

        fallback = await get_lead_agent(session, tenant_id)
        if fallback:
            return fallback
        return Agent(
            tenant_id=tenant_id,
            name="Workstream runner",
            role="assistant",
            system_prompt=instructions,
        )

    async def run_step(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        step_name: str,
        instructions: str,
        config: dict[str, Any],
        *,
        step: WorkstreamStep | None = None,
    ) -> dict[str, Any]:
        agent = await self._resolve_agent(session, tenant_id, config, step, instructions)
        snapshot = await resolve_runtime_snapshot(
            session,
            tenant_id,
            agent=agent,
            step_runtime_profile_id=step.runtime_profile_id if step else None,
        )
        runtime_agent = apply_snapshot_to_agent(agent, snapshot)

        if runtime_agent.id is None:
            session.add(runtime_agent)
            await session.flush()

        run = AgentRun(
            tenant_id=tenant_id,
            agent_id=runtime_agent.id,
            status="running",
            trigger_type="workstream",
            subject=step_name,
            step_id=step.id if step else None,
            runtime_snapshot_json=json.dumps(snapshot),
        )
        session.add(run)
        await session.flush()

        prompt = step.prompt_template or step.handoff_template if step else None
        prompt = prompt or instructions or f"Execute workstream step: {step_name}"

        loop = AgentLoop(session, tenant_id, None, runtime_agent, run)
        loop.usage_scope = "workstream"
        loop.usage_call_type = "workstream"
        try:
            text, tokens = await loop.run_chat([{"role": "user", "content": prompt}])
            run.status = "completed"
            run.completed_at = datetime.utcnow()
            run.tokens_input = tokens.get("input_tokens", 0)
            run.tokens_output = tokens.get("output_tokens", 0)
            run.result_json = json.dumps({"text": text[:2000]})
            await session.commit()
            return {
                "status": "success",
                "output": text,
                "tokens_in": tokens.get("input_tokens", 0),
                "tokens_out": tokens.get("output_tokens", 0),
                "run_id": str(run.id),
                "model": snapshot.get("model"),
            }
        except Exception as exc:
            run.status = "failed"
            run.completed_at = datetime.utcnow()
            await session.commit()
            return {"status": "failed", "output": str(exc), "tokens_in": 0, "tokens_out": 0}


def get_execution_environment() -> ExecutionEnvironment:
    if os.environ.get("BOKITO_MOCK_EXECUTION", "").lower() in ("1", "true", "yes"):
        return MockExecutionEnvironment()
    return AgentLoopExecutionEnvironment()
