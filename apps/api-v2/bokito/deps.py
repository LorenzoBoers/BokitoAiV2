"""Request dependencies: database session and the calling principal.

A `Principal` is who is acting: an operator (JWT), an API client (bok2 token,
MCP or public API), an external visitor (widget session) or an agent (internal).
The trust level drives the policy engine.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Annotated, Literal

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.db import get_session
from bokito.domain.identity import Membership, Role, Tenant, User
from bokito.errors import Forbidden, Unauthorized
from bokito.services import identity

Trust = Literal["operator", "api", "external", "agent", "system"]

ROLE_RANK = {Role.member: 1, Role.admin: 2, Role.owner: 3}


@dataclass
class Principal:
    trust: Trust
    tenant_id: uuid.UUID
    user_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    role: Role | None = None
    scopes: list[str] = field(default_factory=list)
    is_staff: bool = False

    def require_role(self, minimum: Role) -> None:
        if self.is_staff:
            return
        if self.role is None or ROLE_RANK[self.role] < ROLE_RANK[minimum]:
            raise Forbidden("insufficient role", code="insufficient_role")

    @property
    def actor(self) -> str:
        if self.user_id:
            return f"user:{self.user_id}"
        if self.agent_id:
            return f"agent:{self.agent_id}"
        if self.contact_id:
            return f"contact:{self.contact_id}"
        return f"{self.trust}"


DbSession = Annotated[AsyncSession, Depends(get_session)]


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized("missing bearer token")
    return authorization.split(" ", 1)[1].strip()


async def current_operator(
    session: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    """Operator principal from a dashboard JWT."""
    payload = identity.decode_access_token(_bearer(authorization))
    user = await session.get(User, uuid.UUID(payload["sub"]))
    if not user:
        raise Unauthorized("user not found")
    if not payload.get("tid"):
        raise Unauthorized("no workspace selected", code="no_workspace")
    tenant_id = uuid.UUID(payload["tid"])
    membership: Membership | None = await identity.membership_for(session, user.id, tenant_id)
    if not membership and not user.is_staff:
        raise Forbidden("not a member of this workspace", code="not_member")
    return Principal(
        trust="operator",
        tenant_id=tenant_id,
        user_id=user.id,
        role=membership.role if membership else Role.owner,
        is_staff=user.is_staff,
    )


async def current_user_any_tenant(
    session: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """A logged-in user, with or without a selected workspace."""
    payload = identity.decode_access_token(_bearer(authorization))
    user = await session.get(User, uuid.UUID(payload["sub"]))
    if not user:
        raise Unauthorized("user not found")
    return user


async def current_api_client(
    session: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    """API principal from a `bok2_` token (MCP clients, public API)."""
    token = await identity.resolve_api_token(session, _bearer(authorization))
    return Principal(
        trust="api",
        tenant_id=token.tenant_id,
        user_id=token.created_by_user_id,
        scopes=list(token.scopes or []),
        role=Role.admin,
    )


Operator = Annotated[Principal, Depends(current_operator)]
ApiClient = Annotated[Principal, Depends(current_api_client)]


async def tenant_of(session: AsyncSession, principal: Principal) -> Tenant:
    tenant = await session.get(Tenant, principal.tenant_id)
    if not tenant:
        raise Unauthorized("workspace not found")
    return tenant
