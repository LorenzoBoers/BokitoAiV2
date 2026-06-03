from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.auth import User
from app.services.auth import (
    authenticate_user,
    create_access_token,
    create_refresh_session,
    get_tenant_for_user,
    verify_refresh_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict
    tenant: dict


class MeResponse(BaseModel):
    user: dict
    tenant: dict


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user = await authenticate_user(session, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    tenant_ctx = await get_tenant_for_user(session, user.id)
    if not tenant_ctx:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant membership")
    tenant, membership = tenant_ctx
    access_token = create_access_token(user.id, tenant.id, user.email)
    refresh_token, _ = await create_refresh_session(session, user.id)
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
    )
    return LoginResponse(
        access_token=access_token,
        user={
            "id": str(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "tenant": {"id": str(tenant.id), "slug": tenant.slug, "name": tenant.name},
        },
        tenant={"id": str(tenant.id), "slug": tenant.slug, "name": tenant.name, "logo": tenant.logo_url},
    )


@router.post("/refresh", response_model=LoginResponse)
async def refresh(
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    raw = request.cookies.get(settings.refresh_cookie_name)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
    user = await verify_refresh_token(session, raw)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    tenant_ctx = await get_tenant_for_user(session, user.id)
    if not tenant_ctx:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant membership")
    tenant, _ = tenant_ctx
    access_token = create_access_token(user.id, tenant.id, user.email)
    return LoginResponse(
        access_token=access_token,
        user={
            "id": str(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "tenant": {"id": str(tenant.id), "slug": tenant.slug, "name": tenant.name},
        },
        tenant={"id": str(tenant.id), "slug": tenant.slug, "name": tenant.name, "logo": tenant.logo_url},
    )


@router.get("/me", response_model=MeResponse)
async def me(auth: Annotated[AuthContext, Depends(get_current_auth)]):
    return MeResponse(
        user={
            "id": str(auth.user.id),
            "email": auth.user.email,
            "display_name": auth.user.display_name,
            "tenant": {
                "id": str(auth.tenant.id),
                "slug": auth.tenant.slug,
                "name": auth.tenant.name,
            },
        },
        tenant={
            "id": str(auth.tenant.id),
            "slug": auth.tenant.slug,
            "name": auth.tenant.name,
            "logo": auth.tenant.logo_url,
        },
    )


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(settings.refresh_cookie_name)
    return {"ok": True}
