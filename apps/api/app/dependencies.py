import json
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.exceptions import TenantMismatchError
from app.models.auth import Membership, Tenant, User
from app.services.auth import decode_access_token


class AuthContext:
    def __init__(
        self,
        user: User,
        tenant: Tenant,
        membership: Membership | None,
        token: str,
        is_staff: bool = False,
    ):
        self.user = user
        self.tenant = tenant
        self.membership = membership
        self.token = token
        self.is_staff = is_staff

    @property
    def role(self) -> str:
        if self.is_staff:
            return "admin"
        return self.membership.role if self.membership else "member"

    def require_role(self, *roles: str) -> None:
        if self.role not in roles and not self.is_staff:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")


async def get_current_auth(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AuthContext:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.removeprefix("Bearer ").strip()
    else:
        # EventSource (SSE) cannot set custom headers, so allow a query token fallback.
        token = request.query_params.get("access_token", "").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    try:
        payload = decode_access_token(token)
        user_id = UUID(payload["sub"])
        tenant_id = UUID(payload["tenant_id"])
        is_staff = bool(payload.get("staff", False))
    except (JWTError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    host_tenant_id = getattr(request.state, "resolved_tenant_id", None)
    if host_tenant_id and host_tenant_id != tenant_id and not is_staff:
        raise TenantMismatchError("Token tenant does not match host subdomain")

    user_result = await session.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not user or not tenant:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    membership = None
    if not is_staff:
        membership_result = await session.execute(
            select(Membership).where(Membership.user_id == user_id, Membership.tenant_id == tenant_id)
        )
        membership = membership_result.scalar_one_or_none()
        if not membership:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    return AuthContext(user=user, tenant=tenant, membership=membership, token=token, is_staff=is_staff)


async def require_verified_email(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
) -> AuthContext:
    """Soft verification gate for outbound actions (sending mail, connecting
    email channels). Invite-accepted and SSO users are always verified, so
    only self-serve signups that ignored the verification mail hit this."""
    if not auth.user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify your email address to send messages. Check your inbox for the verification link.",
        )
    return auth


def tenant_settings(tenant: Tenant) -> dict:
    try:
        return json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        return {}
