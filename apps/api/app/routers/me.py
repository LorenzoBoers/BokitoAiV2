"""Per-user settings: the personal assistant and chat preferences."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.auth import UserPreference
from app.services.personal_agents import (
    allowed_company_agents,
    get_or_create_personal_agent,
    get_user_preference,
)

router = APIRouter(prefix="/me", tags=["me"])


class AssistantPatch(BaseModel):
    name: str | None = None
    instructions: str | None = None
    default_chat_agent_id: UUID | None = None


async def _assistant_payload(session: AsyncSession, auth: AuthContext) -> dict:
    agent = await get_or_create_personal_agent(session, auth.tenant.id, auth.user)
    pref = await get_user_preference(session, auth.tenant.id, auth.user.id)
    default_id = agent.id
    if pref and pref.default_chat_agent_id:
        default_id = pref.default_chat_agent_id
    return {
        "agent": {
            "id": str(agent.id),
            "name": agent.name,
            "instructions": agent.system_prompt,
            "model": agent.model,
            "kind": agent.kind,
        },
        "default_chat_agent_id": str(default_id),
    }


@router.get("/assistant")
async def get_my_assistant(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await _assistant_payload(session, auth)


@router.patch("/assistant")
async def patch_my_assistant(
    body: AssistantPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    agent = await get_or_create_personal_agent(session, auth.tenant.id, auth.user)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Assistant name cannot be empty")
        agent.name = name
    if body.instructions is not None:
        agent.system_prompt = body.instructions
    agent.updated_at = datetime.utcnow()

    if body.default_chat_agent_id is not None:
        valid_ids = {agent.id} | {
            a.id
            for a in await allowed_company_agents(
                session, auth.tenant.id, auth.user.id, is_admin=auth.role in ("owner", "admin")
            )
        }
        if body.default_chat_agent_id not in valid_ids:
            raise HTTPException(status_code=400, detail="Not a permitted chat target")
        pref = await get_user_preference(session, auth.tenant.id, auth.user.id)
        if not pref:
            pref = UserPreference(tenant_id=auth.tenant.id, user_id=auth.user.id)
            session.add(pref)
        pref.default_chat_agent_id = body.default_chat_agent_id
        pref.updated_at = datetime.utcnow()

    await session.commit()
    return await _assistant_payload(session, auth)
