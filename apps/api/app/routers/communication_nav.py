from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services.channel_access import visible_channel_account_ids
from app.services.communication_nav import nav

router = APIRouter(prefix="/signals", tags=["signals"])


class NavRow(BaseModel):
    id: str
    name: str
    count: int


class NavOut(BaseModel):
    ticket_tags: list[NavRow]
    tags: list[NavRow]
    projects: list[NavRow]


@router.get("/nav", response_model=NavOut)
async def communication_nav(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Rows for Communication's Tags and categories and Projects sections.

    ``ticket_tags`` are categories shown in the rail, ``tags`` pinned free tags.
    ``count`` is the number of open conversations in the row that All
    communication shows you. Open a row with the list's ``tag`` or
    ``project_id`` filter.
    """
    return await nav(
        session,
        auth.tenant.id,
        auth.user.id,
        visible_account_ids=await visible_channel_account_ids(
            session, auth.tenant.id, user_id=auth.user.id, role=auth.role
        ),
    )
