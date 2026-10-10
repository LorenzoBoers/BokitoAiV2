"""Staff-only platform ops directory (tenants, users, support access logs)."""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.auth import Membership, Tenant, User, canonical_workspace_role
from app.models.staff import StaffAccessLog
from app.services.auth import create_access_token
from app.services.workspaces_portal import allows_platform_support, delete_workspace
from app.services import tenant_features

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/staff", tags=["staff-ops"])


class StaffDeleteTenantBody(BaseModel):
    """Confirm by typing the workspace slug (case-insensitive)."""

    confirm_slug: str = Field(min_length=1, max_length=80)


class StaffTenantFeaturesBody(BaseModel):
    custom_models: bool | None = None


class StaffImpersonateBody(BaseModel):
    """Optional workspace to open as the target user (must be a membership)."""

    tenant_id: UUID | None = None


def _require_staff(auth: AuthContext) -> None:
    if not auth.is_staff:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff only")


def _iso(value) -> str | None:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


@router.get("/ops")
async def staff_ops_directory(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    q: Annotated[str | None, Query(description="Filter tenants and users by name, slug, or email")] = None,
    log_limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    """Cross-tenant directory for Bokito operators on this API environment."""
    _require_staff(auth)
    settings = get_settings()
    needle = (q or "").strip().lower()

    member_counts = {
        row.tenant_id: int(row.n)
        for row in (
            await session.execute(
                select(Membership.tenant_id, func.count().label("n")).group_by(Membership.tenant_id)
            )
        ).all()
    }
    membership_counts = {
        row.user_id: int(row.n)
        for row in (
            await session.execute(
                select(Membership.user_id, func.count().label("n")).group_by(Membership.user_id)
            )
        ).all()
    }

    tenants_raw = (await session.execute(select(Tenant).order_by(Tenant.name))).scalars().all()
    tenants = []
    for tenant in tenants_raw:
        if needle and needle not in tenant.name.lower() and needle not in tenant.slug.lower():
            continue
        tenants.append(
            {
                "id": str(tenant.id),
                "slug": tenant.slug,
                "name": tenant.name,
                "support_allowed": allows_platform_support(tenant),
                "custom_models": tenant_features.custom_models_entitled(tenant),
                "member_count": member_counts.get(tenant.id, 0),
                "created_at": _iso(tenant.created_at),
            }
        )

    membership_rows = (
        await session.execute(
            select(Membership, Tenant)
            .join(Tenant, Tenant.id == Membership.tenant_id)
            .where(Membership.is_active.is_(True))
            .order_by(Tenant.name)
        )
    ).all()
    memberships_by_user: dict[UUID, list[dict]] = defaultdict(list)
    for membership, tenant in membership_rows:
        memberships_by_user[membership.user_id].append(
            {
                "tenant_id": str(tenant.id),
                "slug": tenant.slug,
                "name": tenant.name,
                "role": canonical_workspace_role(membership.role),
                "support_allowed": allows_platform_support(tenant),
            }
        )

    users_raw = (await session.execute(select(User).order_by(User.email))).scalars().all()
    users = []
    for user in users_raw:
        hay = f"{user.email} {user.display_name or ''}".lower()
        if needle and needle not in hay:
            continue
        user_memberships = memberships_by_user.get(user.id, [])
        users.append(
            {
                "id": str(user.id),
                "email": user.email,
                "display_name": user.display_name or "",
                "is_staff": bool(user.is_staff),
                "is_active": bool(user.is_active),
                "membership_count": membership_counts.get(user.id, 0),
                "memberships": user_memberships,
                "created_at": _iso(user.created_at),
            }
        )

    logs_raw = (
        await session.execute(
            select(StaffAccessLog).order_by(StaffAccessLog.created_at.desc()).limit(log_limit)
        )
    ).scalars().all()
    staff_ids = {row.staff_user_id for row in logs_raw}
    tenant_ids = {row.tenant_id for row in logs_raw}
    staff_by_id = {}
    if staff_ids:
        staff_by_id = {
            u.id: u
            for u in (
                await session.execute(select(User).where(User.id.in_(staff_ids)))
            ).scalars().all()
        }
    tenant_by_id = {}
    if tenant_ids:
        tenant_by_id = {
            t.id: t
            for t in (
                await session.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))
            ).scalars().all()
        }

    access_logs = []
    for row in logs_raw:
        staff = staff_by_id.get(row.staff_user_id)
        tenant = tenant_by_id.get(row.tenant_id)
        access_logs.append(
            {
                "id": str(row.id),
                "action": row.action,
                "created_at": _iso(row.created_at),
                "staff_user_id": str(row.staff_user_id),
                "staff_email": staff.email if staff else None,
                "tenant_id": str(row.tenant_id),
                "tenant_slug": tenant.slug if tenant else None,
                "tenant_name": tenant.name if tenant else None,
            }
        )

    return {
        "environment": settings.environment,
        "api_url": settings.public_api_url,
        "tenant_count": len(tenants_raw),
        "user_count": len(users_raw),
        "tenants": tenants,
        "users": users,
        "access_logs": access_logs,
    }


@router.post("/ops/users/{user_id}/impersonate")
async def staff_impersonate_user(
    user_id: str,
    body: StaffImpersonateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Issue a member JWT as the target user for 1:1 support debugging.

    The token carries `impersonator_id` (staff) and never a staff claim. Exit via
    `POST /auth/stop-impersonation`. Refresh cookies stay on the staff account.
    """
    _require_staff(auth)
    try:
        target_id = UUID(user_id.strip())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user id") from exc

    target = (
        await session.execute(select(User).where(User.id == target_id))
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.is_staff:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot impersonate staff accounts.",
        )
    if not target.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive.")

    membership_rows = (
        await session.execute(
            select(Membership, Tenant)
            .join(Tenant, Tenant.id == Membership.tenant_id)
            .where(
                Membership.user_id == target.id,
                Membership.is_active.is_(True),
            )
            .order_by(Tenant.name)
        )
    ).all()
    eligible = [
        (membership, tenant)
        for membership, tenant in membership_rows
        if allows_platform_support(tenant)
    ]
    if not eligible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User has no active membership in a workspace that allows platform support.",
        )

    chosen: tuple[Membership, Tenant] | None = None
    if body.tenant_id is not None:
        for membership, tenant in eligible:
            if tenant.id == body.tenant_id:
                chosen = (membership, tenant)
                break
        if chosen is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User is not an active member of that workspace, or support is off.",
            )
    else:
        chosen = eligible[0]

    membership, tenant = chosen
    session.add(
        StaffAccessLog(
            staff_user_id=auth.user.id,
            tenant_id=tenant.id,
            action="impersonate",
        )
    )
    await session.commit()

    access_token = create_access_token(
        target.id,
        tenant.id,
        target.email,
        staff=False,
        impersonator_id=auth.user.id,
    )
    from app.routers.auth import _tenant_dict, _user_dict

    logger.info(
        "staff_impersonate staff=%s target=%s tenant=%s",
        auth.user.email,
        target.email,
        tenant.slug,
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": _user_dict(
            target, tenant, membership.role, is_staff=False, impersonator=auth.user
        ),
        "tenant": _tenant_dict(tenant),
    }


@router.delete("/ops/tenants/{tenant_id}")
async def staff_delete_tenant(
    tenant_id: str,
    body: StaffDeleteTenantBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Hard-purge a tenant. Staff must type the slug to confirm."""
    _require_staff(auth)
    try:
        tid = UUID(tenant_id.strip())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tenant id") from exc
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tid))
    ).scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    if body.confirm_slug.strip().lower() != tenant.slug.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation slug does not match this workspace.",
        )
    slug = tenant.slug
    name = tenant.name
    # Access logs for this tenant are purged with the workspace (tenant_id FK).
    await delete_workspace(session, tenant)
    logger.info(
        "staff_tenant_deleted staff=%s tenant_id=%s slug=%s name=%s",
        auth.user.email,
        tid,
        slug,
        name,
    )
    return {"ok": True, "id": str(tid), "slug": slug, "name": name}


@router.patch("/ops/tenants/{tenant_id}/features")
async def staff_patch_tenant_features(
    tenant_id: str,
    body: StaffTenantFeaturesBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Entitle a workspace for custom (BYOK) models. Requires FEATURE_CUSTOM_MODELS."""
    _require_staff(auth)
    try:
        tid = UUID(tenant_id.strip())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tenant id") from exc
    if body.custom_models is None:
        raise HTTPException(status_code=400, detail="custom_models is required")
    try:
        features = await tenant_features.set_custom_models_entitlement(
            session, tid, entitled=body.custom_models
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "tenant_id": str(tid), "custom_models": features}


class StaffTimeSavedWeightsBody(BaseModel):
    """Minutes credited per action key (0–120). Unknown keys are ignored."""

    minutes: dict[str, int] = Field(default_factory=dict)


@router.get("/ops/time-saved-weights")
async def staff_get_time_saved_weights(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Platform action-credit matrix used for Overview time saved and the mix pie."""
    _require_staff(auth)
    from app.services.time_saved import action_weight_catalog, load_action_minutes

    minutes = await load_action_minutes(session)
    return {"actions": action_weight_catalog(minutes)}


@router.put("/ops/time-saved-weights")
async def staff_put_time_saved_weights(
    body: StaffTimeSavedWeightsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Update platform action weights (persisted in platform_settings)."""
    _require_staff(auth)
    from app.services.time_saved import (
        DEFAULT_ACTION_MINUTES,
        action_weight_catalog,
        clamp_action_minutes,
        save_action_minutes,
    )

    if not body.minutes:
        raise HTTPException(status_code=400, detail="minutes is required")
    for key, value in body.minutes.items():
        if key not in DEFAULT_ACTION_MINUTES:
            continue
        if clamp_action_minutes(value) is None:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid minutes for {key} (0–120)",
            )
    minutes = await save_action_minutes(session, body.minutes)
    logger.info(
        "staff_time_saved_weights_updated staff=%s keys=%s",
        auth.user.email,
        sorted(body.minutes.keys()),
    )
    return {"ok": True, "actions": action_weight_catalog(minutes)}
