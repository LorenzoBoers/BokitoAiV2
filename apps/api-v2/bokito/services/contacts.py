"""Contacts and organizations: who is writing."""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.base import utcnow
from bokito.domain.orient import Contact, Organization
from bokito.errors import NotFound


def normalize_email(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip().lower()
    return v or None


def normalize_phone(value: str | None) -> str | None:
    if not value:
        return None
    digits = "".join(ch for ch in value if ch.isdigit() or ch == "+")
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    return digits or None


async def find_by_handle(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    email: str | None = None,
    phone: str | None = None,
    handle: tuple[str, str] | None = None,
) -> Contact | None:
    conditions = []
    email = normalize_email(email)
    phone = normalize_phone(phone)
    if email:
        conditions.append(Contact.email == email)
    if phone:
        conditions.append(Contact.phone == phone)
    if handle:
        conditions.append(Contact.handles[handle[0]].astext == handle[1])
    if not conditions:
        return None
    return await session.scalar(
        select(Contact).where(Contact.tenant_id == tenant_id, or_(*conditions)).limit(1)
    )


async def resolve_or_create(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    email: str | None = None,
    phone: str | None = None,
    name: str = "",
    handle: tuple[str, str] | None = None,
    kind: str = "customer",
) -> Contact:
    contact = await find_by_handle(session, tenant_id, email=email, phone=phone, handle=handle)
    if contact is None:
        contact = Contact(
            tenant_id=tenant_id,
            name=name.strip()[:300],
            email=normalize_email(email),
            phone=normalize_phone(phone),
            handles={handle[0]: handle[1]} if handle else {},
            kind=kind,
        )
        session.add(contact)
        org = await match_organization(session, tenant_id, contact.email)
        if org:
            contact.organization_id = org.id
    else:
        if name and not contact.name:
            contact.name = name.strip()[:300]
        if email and not contact.email:
            contact.email = normalize_email(email)
        if phone and not contact.phone:
            contact.phone = normalize_phone(phone)
        if handle and handle[0] not in (contact.handles or {}):
            contact.handles = {**(contact.handles or {}), handle[0]: handle[1]}
    contact.last_seen_at = utcnow()
    await session.flush()
    return contact


async def match_organization(
    session: AsyncSession, tenant_id: uuid.UUID, email: str | None
) -> Organization | None:
    if not email or "@" not in email:
        return None
    domain = email.rsplit("@", 1)[1].lower()
    if domain in {"gmail.com", "hotmail.com", "outlook.com", "live.nl", "icloud.com", "yahoo.com"}:
        return None
    return await session.scalar(
        select(Organization).where(
            Organization.tenant_id == tenant_id, Organization.domain == domain
        )
    )


async def get(session: AsyncSession, tenant_id: uuid.UUID, contact_id: uuid.UUID) -> Contact:
    c = await session.get(Contact, contact_id)
    if not c or c.tenant_id != tenant_id:
        raise NotFound("contact not found", code="contact_not_found")
    return c


async def search(
    session: AsyncSession, tenant_id: uuid.UUID, q: str | None, *, limit: int = 50, offset: int = 0
) -> list[Contact]:
    stmt = select(Contact).where(Contact.tenant_id == tenant_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Contact.name.ilike(like), Contact.email.ilike(like), Contact.phone.ilike(like))
        )
    stmt = (
        stmt.order_by(Contact.last_seen_at.desc().nullslast(), Contact.name)
        .limit(limit)
        .offset(offset)
    )
    return list((await session.scalars(stmt)).all())


async def get_organization(
    session: AsyncSession, tenant_id: uuid.UUID, org_id: uuid.UUID
) -> Organization:
    o = await session.get(Organization, org_id)
    if not o or o.tenant_id != tenant_id:
        raise NotFound("organization not found", code="organization_not_found")
    return o
