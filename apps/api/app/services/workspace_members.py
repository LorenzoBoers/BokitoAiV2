"""Resolve workspace members for identity and inbound contact checks."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership, User


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


async def find_member_by_email(
    session: AsyncSession,
    tenant_id: UUID,
    email: str | None,
) -> tuple[User, Membership] | None:
    """Return the tenant membership for this email, if any.

    Used so inbound mail from a teammate is not treated as a CRM customer,
    and so the UI can show a teammate context card instead of Block / approve.
    """
    address = normalize_email(email)
    if not address or "@" not in address:
        return None
    result = await session.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.tenant_id == tenant_id,
            func.lower(User.email) == address,
            User.is_active.is_(True),
        )
        .limit(1)
    )
    row = result.first()
    if not row:
        return None
    return row[0], row[1]


async def member_emails_for_tenant(session: AsyncSession, tenant_id: UUID) -> set[str]:
    result = await session.execute(
        select(User.email)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.tenant_id == tenant_id, User.is_active.is_(True))
    )
    return {normalize_email(email) for email in result.scalars().all() if email}
