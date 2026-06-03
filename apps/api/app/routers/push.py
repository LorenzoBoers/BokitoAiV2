import json
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth

router = APIRouter(prefix="/push", tags=["push"])


class PushSubscriptionBody(BaseModel):
    endpoint: str
    keys: dict


@router.post("/subscribe")
async def subscribe_push(
    body: PushSubscriptionBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    # V1: store subscription in tenant settings later; acknowledge for PWA registration
    _ = session
    return {"ok": True, "user_id": str(auth.user.id), "endpoint": body.endpoint}


@router.get("/vapid-public-key")
async def vapid_public_key():
    from app.config import get_settings

    settings = get_settings()
    return {"public_key": settings.vapid_public_key or "mock-vapid-public-key"}
