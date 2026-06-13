from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services.cockpit import activity_timeline, cockpit_summary, usage_breakdown

router = APIRouter(prefix="/cockpit", tags=["cockpit"])


@router.get("/summary")
async def summary(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await cockpit_summary(session, auth.tenant.id)


@router.get("/activity")
async def activity(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(50, le=200),
):
    return await activity_timeline(session, auth.tenant.id, limit=limit)


@router.get("/usage")
async def usage(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    days: int = Query(30, ge=1, le=365),
):
    return await usage_breakdown(session, auth.tenant.id, days=days)
