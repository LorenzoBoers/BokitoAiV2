"""Workstream execution environment (V1 mock runner)."""

from abc import ABC, abstractmethod
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


class ExecutionEnvironment(ABC):
    @abstractmethod
    async def run_step(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        step_name: str,
        instructions: str,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        ...


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


def get_execution_environment() -> ExecutionEnvironment:
    return MockExecutionEnvironment()
