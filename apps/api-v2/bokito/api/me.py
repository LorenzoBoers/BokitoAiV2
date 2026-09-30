"""The current operator and their workspace."""

from __future__ import annotations

import uuid

from fastapi import APIRouter
from pydantic import BaseModel, Field

from bokito.deps import DbSession, Operator, tenant_of
from bokito.domain.identity import User

router = APIRouter(prefix="/me", tags=["me"])


class MeOut(BaseModel):
    user_id: uuid.UUID
    email: str
    name: str
    language: str
    is_staff: bool
    role: str | None
    workspace: dict


class MePatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    language: str | None = Field(default=None, pattern="^(en|nl)$")


@router.get("", response_model=MeOut, summary="Current user and workspace")
async def me(session: DbSession, principal: Operator) -> MeOut:
    user = await session.get(User, principal.user_id)
    tenant = await tenant_of(session, principal)
    assert user is not None
    return MeOut(
        user_id=user.id,
        email=user.email,
        name=user.name,
        language=user.language,
        is_staff=user.is_staff,
        role=principal.role.value if principal.role else None,
        workspace={
            "id": str(tenant.id),
            "slug": tenant.slug,
            "name": tenant.name,
            "posture": tenant.posture.value,
            "region": tenant.region,
            "language": tenant.language,
        },
    )


@router.patch("", response_model=MeOut, summary="Update profile")
async def patch_me(body: MePatch, session: DbSession, principal: Operator) -> MeOut:
    user = await session.get(User, principal.user_id)
    assert user is not None
    if body.name is not None:
        user.name = body.name
    if body.language is not None:
        user.language = body.language
    await session.commit()
    return await me(session, principal)
