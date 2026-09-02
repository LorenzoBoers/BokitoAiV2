"""Privacy / DSAR / retention settings API."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import privacy as privacy_svc

router = APIRouter(prefix="/privacy", tags=["privacy"])


class PrivacySettingsBody(BaseModel):
    retention_messages_days: int | None = Field(default=None, ge=30, le=3650)
    retention_calendar_days: int | None = Field(default=None, ge=30, le=3650)
    retention_audit_days: int | None = Field(default=None, ge=30, le=3650)
    llm_may_use_message_bodies: bool | None = None


class SubjectBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)


@router.get("/settings")
async def get_privacy_settings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    auth.require_role("owner", "admin")
    return {"settings": privacy_svc.privacy_settings_from_tenant(auth.tenant)}


@router.patch("/settings")
async def patch_privacy_settings(
    body: PrivacySettingsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    updates = body.model_dump(exclude_none=True)
    settings = privacy_svc.merge_privacy_settings(auth.tenant, updates)
    session.add(auth.tenant)
    await session.commit()
    return {"settings": settings}


@router.post("/export")
async def export_personal_data(
    body: SubjectBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    auth.require_role("owner", "admin")
    try:
        package = await privacy_svc.export_subject(
            session,
            auth.tenant.id,
            email=body.email,
            actor_user_id=auth.user.id if auth.user else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"package": package}


@router.post("/erase-subject")
async def erase_personal_data(
    body: SubjectBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    auth.require_role("owner", "admin")
    try:
        result = await privacy_svc.erase_subject(
            session,
            auth.tenant.id,
            email=body.email,
            actor_user_id=auth.user.id if auth.user else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result
