"""Organization canvas: a picture computed on the server."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services.org_graph import build_org_graph

router = APIRouter(prefix="/org", tags=["org"])


@router.get("/graph")
async def org_graph(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await build_org_graph(session, auth.tenant.id)
