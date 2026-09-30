"""Request dependencies: database session and the calling principal.

A `Principal` is who is acting: an operator (JWT), an API client (bok2 token,
MCP or public API), an external visitor (widget session) or an agent (internal).
The trust level drives the policy engine.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Annotated, Literal

from fastapi import Depends, Header, Request
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


API_TOKEN_PREFIX = "bok2_"
OAUTH_TOKEN_PREFIX = "bok2o_"


def _required_scope(request: Request) -> str:
    """Map a REST call to the scope it needs: read (GET), tools (execute/MCP), write (rest)."""
    path = request.url.path
    if path.endswith("/tools/execute") or path.rstrip("/").endswith("/mcp"):
        return "tools"
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return "read"
    return "write"


def check_scope(scopes: list[str], request: Request) -> None:
    if not scopes:
        return
    needed = _required_scope(request)
    if needed not in scopes:
        raise Forbidden(
            f"token lacks the {needed} scope",
            code="insufficient_scope",
            headers={"WWW-Authenticate": f'Bearer error="insufficient_scope", scope="{needed}"'},
        )


async def _principal_for_token_owner(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID | None,
    scopes: list[str],
) -> Principal:
    """API principals inherit the role of the user who created the token (admin fallback)."""
    role = Role.admin
    if user_id:
        membership = await identity.membership_for(session, user_id, tenant_id)
        if membership:
            role = membership.role
    return Principal(trust="api", tenant_id=tenant_id, user_id=user_id, role=role, scopes=scopes)


async def current_operator(
    session: DbSession,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    """The calling principal on REST routes.

    Accepts a dashboard JWT (trust operator), a `bok2_` API token or a `bok2o_`
    OAuth access token (both trust api). This is what makes the REST surface the
    public API: the same routes, one principal shape, policy by trust.
    """
    raw = _bearer(authorization)
    if raw.startswith(OAUTH_TOKEN_PREFIX):
        from bokito.services import oauth

        token = await oauth.resolve_access_token(session, raw)
        scopes = token.scope.split()
        check_scope(scopes, request)
        return await _principal_for_token_owner(
            session, tenant_id=token.tenant_id, user_id=token.user_id, scopes=scopes
        )
    if raw.startswith(API_TOKEN_PREFIX):
        api_token = await identity.resolve_api_token(session, raw)
        scopes = list(api_token.scopes or [])
        check_scope(scopes, request)
        return await _principal_for_token_owner(
            session,
            tenant_id=api_token.tenant_id,
            user_id=api_token.created_by_user_id,
            scopes=scopes,
        )
    payload = identity.decode_access_token(raw)
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
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    """Token-only principal (MCP): `bok2_` or `bok2o_`, never a dashboard JWT.

    Trust is always `api`, and a missing or bad token answers with the RFC 9728
    `WWW-Authenticate` challenge so MCP clients can discover the authorization server.
    """
    from bokito.services import oauth

    try:
        raw = _bearer(authorization)
    except Unauthorized as exc:
        exc.headers = {"WWW-Authenticate": oauth.www_authenticate()}
        raise
    if not raw.startswith((API_TOKEN_PREFIX, OAUTH_TOKEN_PREFIX)):
        raise Unauthorized(
            "a bok2 API token or OAuth access token is required",
            code="token_invalid",
            headers={"WWW-Authenticate": oauth.www_authenticate("invalid_token")},
        )
    try:
        return await current_operator(session, request, authorization)
    except Unauthorized as exc:
        exc.headers.setdefault("WWW-Authenticate", oauth.www_authenticate("invalid_token"))
        raise


Operator = Annotated[Principal, Depends(current_operator)]
ApiClient = Annotated[Principal, Depends(current_api_client)]


async def tenant_of(session: AsyncSession, principal: Principal) -> Tenant:
    tenant = await session.get(Tenant, principal.tenant_id)
    if not tenant:
        raise Unauthorized("workspace not found")
    return tenant
