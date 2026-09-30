"""Tools API: list what the caller may run, run one. The command palette and MCP use this."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from bokito.api.schemas import ToolOutcomeOut
from bokito.deps import DbSession, Operator
from bokito.tools import execute_tool, registry

router = APIRouter(prefix="/tools", tags=["tools"])


class ToolIn(BaseModel):
    name: str
    args: dict[str, Any] = Field(default_factory=dict)
    conversation_id: uuid.UUID | None = None


@router.get("", summary="Tools available to the operator")
async def list_tools(principal: Operator) -> list[dict[str, Any]]:
    return [t.to_public() for t in registry.list(trust=principal.trust)]


@router.post("/execute", response_model=ToolOutcomeOut, summary="Execute a tool as the operator")
async def execute(body: ToolIn, session: DbSession, principal: Operator) -> ToolOutcomeOut:
    outcome = await execute_tool(
        session, principal, body.name, body.args, conversation_id=body.conversation_id
    )
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())
