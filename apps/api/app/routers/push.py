import json
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.usage import PushSubscription

router = APIRouter(prefix="/push", tags=["push"])
settings = get_settings()


class PushSubscriptionBody(BaseModel):
    endpoint: str
    keys: dict


@router.post("/subscribe")
async def subscribe_push(
    body: PushSubscriptionBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    existing = await session.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == auth.user.id,
            PushSubscription.endpoint == body.endpoint,
        )
    )
    sub = existing.scalar_one_or_none()
    if not sub:
        sub = PushSubscription(
            tenant_id=auth.tenant.id,
            user_id=auth.user.id,
            endpoint=body.endpoint,
            keys_json=json.dumps(body.keys),
        )
        session.add(sub)
        await session.commit()
    return {"ok": True, "user_id": str(auth.user.id)}


@router.get("/vapid-public-key")
async def vapid_public_key():
    return {"public_key": settings.vapid_public_key or "mock-vapid-public-key"}
