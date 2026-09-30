"""Identity service: passwords, JWTs, refresh sessions, workspaces, API tokens."""

from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from datetime import timedelta
from typing import Any

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.config import get_settings
from bokito.domain.base import utcnow
from bokito.domain.identity import ApiToken, Membership, Role, Session, Tenant, User
from bokito.errors import Conflict, Unauthorized

_SLUG_RE = re.compile(r"[^a-z0-9-]+")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def _digest(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def create_access_token(user_id: uuid.UUID, tenant_id: uuid.UUID | None) -> str:
    s = get_settings()
    now = utcnow()
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "tid": str(tenant_id) if tenant_id else None,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=s.access_token_minutes)).timestamp()),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    s = get_settings()
    try:
        return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except JWTError as exc:
        raise Unauthorized("invalid token") from exc


def slugify(name: str) -> str:
    slug = _SLUG_RE.sub("-", name.strip().lower()).strip("-")
    return slug[:48] or "workspace"


async def unique_slug(session: AsyncSession, base: str) -> str:
    slug = base
    n = 1
    while (await session.execute(select(Tenant.id).where(Tenant.slug == slug))).scalar():
        n += 1
        slug = f"{base}-{n}"
    return slug


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    return (await session.execute(select(User).where(User.email == email.lower()))).scalar()


async def create_user(session: AsyncSession, *, email: str, password: str, name: str = "") -> User:
    if await get_user_by_email(session, email):
        raise Conflict("email already registered", code="email_taken")
    user = User(email=email.lower(), name=name, password_hash=hash_password(password))
    session.add(user)
    await session.flush()
    return user


async def create_workspace(
    session: AsyncSession, *, owner: User, name: str, language: str = "en"
) -> Tenant:
    tenant = Tenant(
        slug=await unique_slug(session, slugify(name)), name=name.strip(), language=language
    )
    session.add(tenant)
    await session.flush()
    session.add(Membership(tenant_id=tenant.id, user_id=owner.id, role=Role.owner))
    owner.last_tenant_id = tenant.id
    await session.flush()
    return tenant


async def authenticate(session: AsyncSession, email: str, password: str) -> User:
    user = await get_user_by_email(session, email)
    if not user or not verify_password(password, user.password_hash):
        raise Unauthorized("invalid credentials", code="invalid_credentials")
    return user


async def membership_for(
    session: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID
) -> Membership | None:
    stmt = select(Membership).where(
        Membership.user_id == user_id, Membership.tenant_id == tenant_id
    )
    return (await session.execute(stmt)).scalar()


async def memberships_for(
    session: AsyncSession, user_id: uuid.UUID
) -> list[tuple[Membership, Tenant]]:
    stmt = (
        select(Membership, Tenant)
        .join(Tenant, Tenant.id == Membership.tenant_id)
        .where(Membership.user_id == user_id)
        .order_by(Tenant.name)
    )
    return [(m, t) for m, t in (await session.execute(stmt)).all()]


async def resolve_tenant(session: AsyncSession, user: User) -> Tenant | None:
    """The tenant a fresh login lands in: last used, else the first membership."""
    if user.last_tenant_id:
        m = await membership_for(session, user.id, user.last_tenant_id)
        if m:
            return await session.get(Tenant, user.last_tenant_id)
    rows = await memberships_for(session, user.id)
    return rows[0][1] if rows else None


# Refresh sessions


async def create_refresh_session(session: AsyncSession, user_id: uuid.UUID) -> str:
    raw = secrets.token_urlsafe(48)
    s = get_settings()
    session.add(
        Session(
            user_id=user_id,
            token_digest=_digest(raw),
            expires_at=utcnow() + timedelta(days=s.refresh_token_days),
            created_at=utcnow(),
        )
    )
    await session.flush()
    return raw


async def verify_refresh_session(session: AsyncSession, raw: str) -> User:
    stmt = select(Session).where(Session.token_digest == _digest(raw))
    row = (await session.execute(stmt)).scalar()
    if not row or row.revoked_at or row.expires_at < utcnow():
        raise Unauthorized("refresh token invalid", code="refresh_invalid")
    user = await session.get(User, row.user_id)
    if not user:
        raise Unauthorized("refresh token invalid", code="refresh_invalid")
    return user


async def revoke_refresh_session(session: AsyncSession, raw: str) -> None:
    stmt = select(Session).where(Session.token_digest == _digest(raw))
    row = (await session.execute(stmt)).scalar()
    if row and not row.revoked_at:
        row.revoked_at = utcnow()
        await session.flush()


# API tokens


async def create_api_token(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID | None,
    name: str,
    scopes: list[str],
) -> tuple[str, ApiToken]:
    raw = "bok2_" + secrets.token_urlsafe(32)
    token = ApiToken(
        tenant_id=tenant_id,
        name=name,
        token_digest=_digest(raw),
        prefix=raw[:12],
        scopes=scopes,
        created_by_user_id=user_id,
        created_at=utcnow(),
    )
    session.add(token)
    await session.flush()
    return raw, token


async def resolve_api_token(session: AsyncSession, raw: str) -> ApiToken:
    stmt = select(ApiToken).where(ApiToken.token_digest == _digest(raw))
    token = (await session.execute(stmt)).scalar()
    if not token or token.revoked_at:
        raise Unauthorized("api token invalid", code="token_invalid")
    token.last_used_at = utcnow()
    return token
