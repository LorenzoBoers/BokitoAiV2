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
    tag_id: str | None = None
    group_id: str | None = None


class FolderNavRow(NavRow):
    """A folder row. Virtual rows are group children without a pinned row:
    ``id`` is ``{project_id}:{tag_id}``; open them with ``project_id`` plus
    ``path=tag_id``."""

    parent_id: str | None = None
    project_id: str | None = None
    virtual: bool = False
    children: list["FolderNavRow"] = []


class NavOut(BaseModel):
    ticket_tags: list[NavRow]
    tags: list[NavRow]
    projects: list[FolderNavRow]


@router.get("/nav", response_model=NavOut)
async def communication_nav(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Rows for the Communication rail: tags and folders.

    ``ticket_tags`` are action tags with ``show_in_nav``, ``tags`` free tags
    with ``show_in_nav``; a tag that is a folder is listed under ``projects``
    only. ``count`` is the number of open conversations in the row that All
    communication shows you. Open a row with the list's ``tag`` filter, or
    ``project_id`` (plus ``path`` for a virtual child).
    """
    return await nav(
        session,
        auth.tenant.id,
        auth.user.id,
        visible_account_ids=await visible_channel_account_ids(
            session, auth.tenant.id, user_id=auth.user.id, role=auth.role
        ),
    )
