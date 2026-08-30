"""SSO user provisioning: find-or-create a user (and workspace) from a
verified identity-provider email.

Used by the Microsoft "Sign in with Microsoft" login flow. New users get a
passwordless account (`password_hash=""`) plus a bootstrapped workspace, the
same as the password signup path.
"""

from __future__ import annotations

import logging
import re
import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership, Tenant, User
from app.services.auth import get_tenant_for_user
from app.services.tenant_bootstrap import (
    bootstrap_tenant,
    default_tenant_settings,
    serialize_settings,
)

logger = logging.getLogger(__name__)


def _slug_base(email: str) -> str:
    local = email.split("@", 1)[0].lower()
    slug = re.sub(r"[^a-z0-9-]+", "-", local).strip("-")
    return slug or "workspace"


async def _unique_slug(session: AsyncSession, base: str) -> str:
    candidate = base
    for _ in range(20):
        existing = await session.execute(select(Tenant).where(Tenant.slug == candidate))
        if existing.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base}-{secrets.token_hex(2)}"
    return f"{base}-{secrets.token_hex(4)}"


async def _create_workspace_for(session: AsyncSession, user: User) -> Tenant:
    slug = await _unique_slug(session, _slug_base(user.email))
    tenant = Tenant(
        slug=slug,
        name=user.display_name or slug,
        settings_json=serialize_settings(default_tenant_settings()),
    )
    session.add(tenant)
    await session.flush()
    session.add(Membership(tenant_id=tenant.id, user_id=user.id, role="owner"))
    user.last_tenant_id = tenant.id
    session.add(user)
    await bootstrap_tenant(session, tenant.id)
    return tenant


async def provision_sso_user(
    session: AsyncSession, *, email: str, name: str = ""
) -> tuple[User, Tenant]:
    """Find or create the user for a verified SSO email; returns (user, tenant).

    The identity provider verified the address, so an existing account with the
    same email is linked (and marked verified). Users without any workspace get
    a fresh bootstrapped tenant, mirroring signup.
    """
    email = email.strip().lower()
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            email=email,
            password_hash="",
            display_name=name.strip() or email.split("@")[0],
            email_verified=True,
        )
        session.add(user)
        await session.flush()
        tenant = await _create_workspace_for(session, user)
        await session.commit()
        logger.info("SSO signup: created user %s with workspace %s", email, tenant.slug)
        return user, tenant

    if not user.email_verified:
        user.email_verified = True
        session.add(user)

    tenant_ctx = await get_tenant_for_user(
        session, user.id, preferred_tenant_id=user.last_tenant_id
    )
    if tenant_ctx:
        tenant, _membership = tenant_ctx
        if user.last_tenant_id != tenant.id:
            user.last_tenant_id = tenant.id
            session.add(user)
        await session.commit()
        return user, tenant

    tenant = await _create_workspace_for(session, user)
    await session.commit()
    return user, tenant
