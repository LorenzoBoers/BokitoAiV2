"""Built-in Bokito email address per tenant.

Every tenant gets a zero-setup mailbox at `{slug}-{token}@in.bokito.ai`
(provider `bokito` on ChannelAccount). Inbound mail arrives via the Resend
`email.received` webhook (`/api/inbound/resend`); outbound replies go out
through the Resend Send API. No OAuth credentials are involved.
"""

from __future__ import annotations

import re
import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Tenant
from app.models.channel import ChannelAccount

BOKITO_PROVIDER = "bokito"


def inbound_domain() -> str:
    return get_settings().bokito_inbound_domain


def _address_slug(raw: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (raw or "").lower()).strip("-")
    return slug[:24] or "workspace"


def generate_bokito_address(tenant_slug: str) -> str:
    # Short random token prevents guessing another tenant's inbound address.
    token = secrets.token_hex(3)
    return f"{_address_slug(tenant_slug)}-{token}@{inbound_domain()}"


async def get_bokito_account(
    session: AsyncSession, tenant_id: UUID
) -> ChannelAccount | None:
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.channel == "email",
            ChannelAccount.provider == BOKITO_PROVIDER,
        )
    )
    return result.scalars().first()


async def ensure_bokito_mailbox(
    session: AsyncSession, tenant_id: UUID, *, commit: bool = True
) -> ChannelAccount:
    """Return the tenant's built-in mailbox, creating it on first use."""
    existing = await get_bokito_account(session, tenant_id)
    if existing:
        return existing
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one()
    account = ChannelAccount(
        tenant_id=tenant_id,
        channel="email",
        address=generate_bokito_address(tenant.slug),
        provider=BOKITO_PROVIDER,
        display_name=f"{tenant.name} (Bokito)",
        is_enabled=True,
    )
    session.add(account)
    if commit:
        await session.commit()
        await session.refresh(account)
    else:
        await session.flush()
    return account


async def find_bokito_account_by_address(
    session: AsyncSession, address: str
) -> ChannelAccount | None:
    """Resolve an inbound recipient address to its tenant mailbox (global)."""
    normalized = (address or "").strip().lower()
    if not normalized:
        return None
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.channel == "email",
            ChannelAccount.provider == BOKITO_PROVIDER,
            ChannelAccount.address == normalized,
            ChannelAccount.is_enabled.is_(True),
        )
    )
    return result.scalars().first()
