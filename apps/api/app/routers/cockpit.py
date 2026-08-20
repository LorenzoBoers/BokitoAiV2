from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services.cockpit import activity_timeline, cockpit_summary, usage_breakdown
from app.services.spend_guard import get_spend_config, get_spend_status, update_spend_config

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
    before: datetime | None = Query(None),
):
    return await activity_timeline(session, auth.tenant.id, limit=limit, before=before)


@router.get("/usage")
async def usage(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    days: int = Query(30, ge=1, le=365),
):
    return await usage_breakdown(session, auth.tenant.id, days=days)


class BudgetBody(BaseModel):
    # None/0 = uncapped; positive int = cap.
    daily_token_cap: int | None = None
    monthly_customer_micros_cap: int | None = None


@router.get("/budget")
async def get_budget(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return {
        "config": get_spend_config(auth.tenant),
        "status": await get_spend_status(session, auth.tenant.id),
    }


@router.patch("/budget")
async def patch_budget(
    body: BudgetBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    config = await update_spend_config(
        session, auth.tenant, body.model_dump(exclude_unset=True)
    )
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="billing:budget_updated",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="tenant",
        resource_id=auth.tenant.id,
        after=body.model_dump(exclude_unset=True),
    )
    return {
        "config": config,
        "status": await get_spend_status(session, auth.tenant.id),
    }
