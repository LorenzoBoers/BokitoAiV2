"""Staff-only platform ops directory (tenants, users, support access logs)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.auth import Membership, Tenant, User
from app.models.staff import StaffAccessLog
from app.services.workspaces_portal import allows_platform_support

router = APIRouter(prefix="/staff", tags=["staff-ops"])


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
                "member_count": member_counts.get(tenant.id, 0),
                "created_at": _iso(tenant.created_at),
            }
        )

    users_raw = (await session.execute(select(User).order_by(User.email))).scalars().all()
    users = []
    for user in users_raw:
        hay = f"{user.email} {user.display_name or ''}".lower()
        if needle and needle not in hay:
            continue
        users.append(
            {
                "id": str(user.id),
                "email": user.email,
                "display_name": user.display_name or "",
                "is_staff": bool(user.is_staff),
                "is_active": bool(user.is_active),
                "membership_count": membership_counts.get(user.id, 0),
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
