from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from jose import jwt
from passlib.context import CryptContext
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.exceptions import AppError
from app.models.auth import Membership, Session, Tenant, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
settings = get_settings()

ROLES = ("owner", "admin", "member")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    # Passwordless (SSO-only) accounts store an empty hash: never matches.
    if not hashed:
        return False
    try:
        return pwd_context.verify(plain, hashed)
    except ValueError:
        return False


def create_access_token(
    user_id: UUID,
    tenant_id: UUID,
    email: str,
    *,
    staff: bool = False,
) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "tenant_id": str(tenant_id),
        "email": email,
        "staff": staff,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


async def authenticate_user(session: AsyncSession, email: str, password: str) -> User | None:
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        return None
    return user


async def get_user_membership(
    session: AsyncSession, user_id: UUID, tenant_id: UUID | None = None
) -> Membership | None:
    query = select(Membership).where(Membership.user_id == user_id)
    if tenant_id:
        query = query.where(Membership.tenant_id == tenant_id)
    result = await session.execute(query)
    return result.scalars().first()


async def get_tenant_for_user(
    session: AsyncSession,
    user_id: UUID,
    *,
    preferred_tenant_id: UUID | None = None,
) -> tuple[Tenant, Membership] | None:
    """Resolve the tenant to scope a session to.

    Prefers the user's last-used workspace (when they still hold a membership
    there); otherwise falls back to the oldest membership.
    """
    if preferred_tenant_id:
        result = await session.execute(
            select(Tenant, Membership)
            .join(Membership, Membership.tenant_id == Tenant.id)
            .where(Membership.user_id == user_id, Tenant.id == preferred_tenant_id)
        )
        row = result.first()
        if row:
            return row[0], row[1]
    result = await session.execute(
        select(Tenant, Membership)
        .join(Membership, Membership.tenant_id == Tenant.id)
        .where(Membership.user_id == user_id)
        .order_by(Membership.created_at)
    )
    row = result.first()
    if not row:
        return None
    return row[0], row[1]


async def ensure_single_owner(session: AsyncSession, tenant_id: UUID, exclude_membership_id: UUID | None = None) -> None:
    query = select(func.count()).select_from(Membership).where(
        Membership.tenant_id == tenant_id, Membership.role == "owner"
    )
    if exclude_membership_id:
        query = select(func.count()).select_from(Membership).where(
            Membership.tenant_id == tenant_id,
            Membership.role == "owner",
            Membership.id != exclude_membership_id,
        )
    result = await session.execute(query)
    count = result.scalar_one()
    if count > 1:
        raise AppError("Tenant can only have one owner", code="multiple_owners")


def _refresh_token_digest(raw_token: str) -> str:
    import hashlib

    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


async def create_refresh_session(session: AsyncSession, user_id: UUID) -> tuple[str, Session]:
    import secrets

    raw = secrets.token_urlsafe(48)
    db_session = Session(
        user_id=user_id,
        refresh_token_hash=_refresh_token_digest(raw),
        expires_at=datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days),
    )
    session.add(db_session)
    await session.commit()
    await session.refresh(db_session)
    return raw, db_session


async def verify_refresh_token(session: AsyncSession, raw_token: str) -> User | None:
    result = await session.execute(
        select(Session).where(
            Session.refresh_token_hash == _refresh_token_digest(raw_token),
            Session.expires_at > datetime.utcnow(),
        )
    )
    db_session = result.scalars().first()
    if not db_session:
        return None
    user_result = await session.execute(select(User).where(User.id == db_session.user_id))
    return user_result.scalar_one_or_none()


async def create_invite_token() -> str:
    import secrets

    return secrets.token_urlsafe(32)
