import json
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.auth import Membership, Tenant, User
from app.services.auth import decode_access_token


class AuthContext:
    def __init__(self, user: User, tenant: Tenant, membership: Membership, token: str):
        self.user = user
        self.tenant = tenant
        self.membership = membership
        self.token = token


async def get_current_auth(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AuthContext:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = auth_header.removeprefix("Bearer ").strip()
    try:
        payload = decode_access_token(token)
        user_id = UUID(payload["sub"])
        tenant_id = UUID(payload["tenant_id"])
    except (JWTError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    user_result = await session.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    membership_result = await session.execute(
        select(Membership).where(Membership.user_id == user_id, Membership.tenant_id == tenant_id)
    )
    membership = membership_result.scalar_one_or_none()
    if not user or not tenant or not membership:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return AuthContext(user=user, tenant=tenant, membership=membership, token=token)
