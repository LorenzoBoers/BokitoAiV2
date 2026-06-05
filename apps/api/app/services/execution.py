"""Workstream execution environment (AgentLoop-backed)."""

from __future__ import annotations

import json
import os
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun
from app.models.orchestra import AgentProfile
from app.models.usage import UsageLedger
from app.services.agent.loop import AgentLoop


class ExecutionEnvironment:
    async def run_step(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        step_name: str,
        instructions: str,
        config: dict[str, Any],
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
    ) -> dict[str, Any]:
        return {
            "status": "success",
            "output": f"Mock executed step '{step_name}' with instructions: {instructions[:100]}",
            "tokens_in": 100,
            "tokens_out": 50,
        }


class AgentLoopExecutionEnvironment(ExecutionEnvironment):
    async def _resolve_agent(
        self, session: AsyncSession, tenant_id: UUID, config: dict[str, Any]
    ) -> Agent:
        profile_id = config.get("agent_profile_id")
        if profile_id:
            profile = (
                await session.execute(
                    select(AgentProfile).where(
                        AgentProfile.id == UUID(str(profile_id)),
                        AgentProfile.tenant_id == tenant_id,
                    )
                )
            ).scalar_one_or_none()
            if profile:
                return Agent(
                    tenant_id=tenant_id,
                    name=profile.name,
                    role="assistant",
                    model=profile.model,
                    provider=profile.provider,
                    system_prompt=profile.system_prompt or instructions,
                    tools_json=profile.tools_json,
                    max_loops=10,
                )

        agent_id = config.get("agent_id")
        if agent_id:
            agent = (
                await session.execute(
                    select(Agent).where(Agent.id == UUID(str(agent_id)), Agent.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
            if agent:
                return agent

        fallback = (
            await session.execute(
                select(Agent)
                .where(Agent.tenant_id == tenant_id, Agent.is_active.is_(True))
                .order_by(Agent.created_at)
                .limit(1)
            )
        ).scalar_one_or_none()
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
    ) -> dict[str, Any]:
        agent = await self._resolve_agent(session, tenant_id, config)
        if agent.id is None:
            session.add(agent)
            await session.flush()

        run = AgentRun(
            tenant_id=tenant_id,
            agent_id=agent.id,
            status="running",
            trigger_type="workstream",
            subject=step_name,
        )
        session.add(run)
        await session.flush()

        loop = AgentLoop(session, tenant_id, None, agent, run)
        try:
            text, tokens = await loop.run_chat(
                [{"role": "user", "content": instructions or f"Execute workstream step: {step_name}"}]
            )
            from datetime import datetime

            run.status = "completed"
            run.completed_at = datetime.utcnow()
            run.tokens_input = tokens.get("input", 0)
            run.tokens_output = tokens.get("output", 0)
            run.result_json = json.dumps({"text": text[:2000]})
            session.add(
                UsageLedger(
                    tenant_id=tenant_id,
                    scope="workstream",
                    scope_id=str(run.id),
                    provider=agent.provider,
                    model=agent.model,
                    tokens_in=tokens.get("input", 0),
                    tokens_out=tokens.get("output", 0),
                    cost_cents=max(1, (tokens.get("input", 0) + tokens.get("output", 0)) // 100),
                )
            )
            await session.commit()
            return {
                "status": "success",
                "output": text,
                "tokens_in": tokens.get("input", 0),
                "tokens_out": tokens.get("output", 0),
                "run_id": str(run.id),
            }
        except Exception as exc:
            from datetime import datetime

            run.status = "failed"
            run.completed_at = datetime.utcnow()
            await session.commit()
            return {"status": "failed", "output": str(exc), "tokens_in": 0, "tokens_out": 0}


def get_execution_environment() -> ExecutionEnvironment:
    if os.environ.get("BOKITO_MOCK_EXECUTION", "").lower() in ("1", "true", "yes"):
        return MockExecutionEnvironment()
    return AgentLoopExecutionEnvironment()
