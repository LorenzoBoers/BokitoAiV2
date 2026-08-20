"""CRM companies: auto-link contacts to a company by business email domain."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Company, Contact

# Consumer mail providers never form a company; extend as needed.
FREE_EMAIL_DOMAINS = frozenset(
    {
        "gmail.com",
        "googlemail.com",
        "outlook.com",
        "hotmail.com",
        "hotmail.nl",
        "hotmail.co.uk",
        "live.com",
        "live.nl",
        "msn.com",
        "yahoo.com",
        "yahoo.co.uk",
        "ymail.com",
        "icloud.com",
        "me.com",
        "mac.com",
        "proton.me",
        "protonmail.com",
        "aol.com",
        "gmx.com",
        "gmx.net",
        "gmx.de",
        "mail.com",
        "zoho.com",
        "hey.com",
        "ziggo.nl",
        "kpnmail.nl",
        "planet.nl",
        "home.nl",
        "xs4all.nl",
        "telenet.be",
        "skynet.be",
    }
)


def business_domain(address: str) -> str:
    """Lowercase business domain of an email address, or "" when not linkable."""
    address = (address or "").strip().lower()
    if "@" not in address:
        return ""
    domain = address.rsplit("@", 1)[1].strip()
    if not domain or "." not in domain or domain in FREE_EMAIL_DOMAINS:
        return ""
    return domain


def default_company_name(domain: str) -> str:
    """"acme.com" -> "Acme"; keeps multi-label domains readable."""
    label = domain.split(".", 1)[0]
    return label.capitalize() if label else domain


async def get_or_create_company(
    session: AsyncSession, tenant_id: UUID, domain: str
) -> Company:
    result = await session.execute(
        select(Company).where(Company.tenant_id == tenant_id, Company.domain == domain)
    )
    company = result.scalar_one_or_none()
    if company:
        return company
    company = Company(
        tenant_id=tenant_id,
        name=default_company_name(domain),
        domain=domain,
        website=f"https://{domain}",
    )
    session.add(company)
    await session.flush()
    return company


async def link_contact_company(session: AsyncSession, contact: Contact) -> Company | None:
    """Attach the contact to a domain-matched company (no commit; flush only).

    Returns the company when a link was made or already present.
    """
    if contact.company_id:
        return None
    domain = business_domain(contact.address)
    if not domain:
        return None
    company = await get_or_create_company(session, contact.tenant_id, domain)
    contact.company_id = company.id
    if not contact.company:
        # Keep the legacy free-text field in sync for existing UI surfaces.
        contact.company = company.name
    session.add(contact)
    return company


async def backfill_company_links(session: AsyncSession, tenant_id: UUID) -> dict:
    """Link all existing unlinked email contacts; used from the Contacts UI."""
    result = await session.execute(
        select(Contact).where(
            Contact.tenant_id == tenant_id,
            Contact.company_id.is_(None),
            Contact.address.contains("@"),
        )
    )
    linked = 0
    for contact in result.scalars().all():
        if await link_contact_company(session, contact):
            linked += 1
    await session.commit()
    return {"linked": linked}


async def company_contact_counts(session: AsyncSession, tenant_id: UUID) -> dict[UUID, int]:
    result = await session.execute(
        select(Contact.company_id, func.count())
        .where(Contact.tenant_id == tenant_id, Contact.company_id.is_not(None))
        .group_by(Contact.company_id)
    )
    return {row[0]: int(row[1]) for row in result.all()}


def serialize_company(company: Company, *, contact_count: int | None = None) -> dict:
    data = {
        "id": str(company.id),
        "name": company.name,
        "domain": company.domain,
        "website": company.website,
        "notes": company.notes,
        "created_at": company.created_at.isoformat(),
        "updated_at": company.updated_at.isoformat(),
    }
    if contact_count is not None:
        data["contact_count"] = contact_count
    return data


def touch(company: Company) -> None:
    company.updated_at = datetime.utcnow()
