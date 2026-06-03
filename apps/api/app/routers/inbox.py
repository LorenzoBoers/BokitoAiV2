from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services.inbox import list_inbox_items

router = APIRouter(prefix="/inbox", tags=["inbox"])


@router.get("")
async def get_inbox(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    channel: str | None = Query(None),
    limit: int = Query(50, le=100),
):
    return await list_inbox_items(session, auth.tenant.id, channel=channel, limit=limit)
