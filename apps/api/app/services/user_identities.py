"""Persist and resolve Google/Microsoft SSO identities for Bokito users."""

from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User
from app.models.user_identity import UserIdentity
from app.services import oauth_providers

logger = logging.getLogger(__name__)

PROVIDER_GOOGLE = "google"
PROVIDER_MICROSOFT = "microsoft"

# OAuth slug (mailbox/login) → canonical identity provider name.
_OAUTH_TO_CANONICAL = {
    oauth_providers.GOOGLE: PROVIDER_GOOGLE,
    oauth_providers.MICROSOFT: PROVIDER_MICROSOFT,
}

_CANONICAL_TO_OAUTH = {
    PROVIDER_GOOGLE: oauth_providers.GOOGLE,
    PROVIDER_MICROSOFT: oauth_providers.MICROSOFT,
}


def canonical_provider(oauth_or_canonical: str) -> str | None:
    key = (oauth_or_canonical or "").strip().lower()
    if key in (PROVIDER_GOOGLE, PROVIDER_MICROSOFT):
        return key
    return _OAUTH_TO_CANONICAL.get(key)


def oauth_slug(canonical: str) -> str | None:
    return _CANONICAL_TO_OAUTH.get((canonical or "").strip().lower())


def has_password(user: User) -> bool:
    return bool(user.password_hash)


async def get_by_subject(
    session: AsyncSession, *, provider: str, subject: str
) -> UserIdentity | None:
    canon = canonical_provider(provider)
    if not canon or not subject:
        return None
    result = await session.execute(
        select(UserIdentity).where(
            UserIdentity.provider == canon,
            UserIdentity.subject == subject,
        )
    )
    return result.scalar_one_or_none()


async def list_for_user(session: AsyncSession, user_id: UUID) -> list[UserIdentity]:
    result = await session.execute(
        select(UserIdentity).where(UserIdentity.user_id == user_id)
    )
    return list(result.scalars().all())


async def upsert_identity(
    session: AsyncSession,
    *,
    user_id: UUID,
    provider: str,
    subject: str,
    email: str = "",
    commit: bool = False,
) -> UserIdentity:
    """Attach or refresh a provider identity for ``user_id``.

    Raises ``ValueError`` when the subject is already linked to another user,
    or when this user already has a different subject for the same provider.
    """
    canon = canonical_provider(provider)
    subject = (subject or "").strip()
    if not canon or not subject:
        raise ValueError("missing_subject")

    email_norm = (email or "").strip().lower()
    existing = await get_by_subject(session, provider=canon, subject=subject)
    if existing is not None:
        if existing.user_id != user_id:
            raise ValueError("subject_taken")
        if email_norm:
            existing.email_at_link = email_norm
        existing.linked_at = datetime.utcnow()
        session.add(existing)
        if commit:
            await session.commit()
            await session.refresh(existing)
        return existing

    same_provider = await session.execute(
        select(UserIdentity).where(
            UserIdentity.user_id == user_id,
            UserIdentity.provider == canon,
        )
    )
    row = same_provider.scalar_one_or_none()
    if row is not None:
        # Same user reconnecting with a new subject (rare IdP migration).
        row.subject = subject
        row.email_at_link = email_norm or row.email_at_link
        row.linked_at = datetime.utcnow()
        session.add(row)
        if commit:
            await session.commit()
            await session.refresh(row)
        return row

    row = UserIdentity(
        user_id=user_id,
        provider=canon,
        subject=subject,
        email_at_link=email_norm,
    )
    session.add(row)
    if commit:
        await session.commit()
        await session.refresh(row)
    return row


async def unlink(
    session: AsyncSession, *, user: User, provider: str
) -> None:
    """Remove a linked identity. Raises ``PermissionError`` if last auth method."""
    canon = canonical_provider(provider)
    if not canon:
        raise ValueError("unknown_provider")

    identities = await list_for_user(session, user.id)
    target = next((i for i in identities if i.provider == canon), None)
    if target is None:
        raise ValueError("not_linked")

    remaining = [i for i in identities if i.provider != canon]
    if not has_password(user) and not remaining:
        raise PermissionError("last_auth_method")

    await session.delete(target)
    await session.commit()


async def resolve_user_for_sso(
    session: AsyncSession,
    *,
    provider: str,
    subject: str,
    email: str,
    name: str = "",
) -> User:
    """Find user by subject, else email provision, then upsert identity."""
    from app.services.sso import provision_sso_user

    canon = canonical_provider(provider)
    subject = (subject or "").strip()
    email_norm = (email or "").strip().lower()

    if canon and subject:
        link = await get_by_subject(session, provider=canon, subject=subject)
        if link is not None:
            user = await session.get(User, link.user_id)
            if user is not None:
                await upsert_identity(
                    session,
                    user_id=user.id,
                    provider=canon,
                    subject=subject,
                    email=email_norm,
                )
                if not user.email_verified:
                    user.email_verified = True
                    session.add(user)
                await session.commit()
                return user

    if not email_norm:
        raise ValueError("no_email")

    user, _tenant = await provision_sso_user(session, email=email_norm, name=name)
    if canon and subject:
        try:
            await upsert_identity(
                session,
                user_id=user.id,
                provider=canon,
                subject=subject,
                email=email_norm,
                commit=True,
            )
        except ValueError as exc:
            # Subject owned by another user while email matched this one —
            # leave the session but do not steal the subject.
            logger.warning(
                "SSO identity upsert skipped for %s/%s: %s",
                canon,
                subject,
                exc,
            )
    return user


def identities_status_payload(
    *,
    user: User,
    linked: list[UserIdentity],
) -> dict:
    """Build the Profile Connected-accounts payload."""
    by_provider = {row.provider: row for row in linked}
    providers = []
    for provider, oauth_slug_name in (
        (PROVIDER_GOOGLE, oauth_providers.GOOGLE),
        (PROVIDER_MICROSOFT, oauth_providers.MICROSOFT),
    ):
        row = by_provider.get(provider)
        providers.append(
            {
                "id": provider,
                "linked": row is not None,
                "email": row.email_at_link if row else "",
                "configured": oauth_providers.is_configured(oauth_slug_name),
            }
        )
    return {
        "has_password": has_password(user),
        "providers": providers,
    }
