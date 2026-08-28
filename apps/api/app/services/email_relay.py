"""Bokito relay addresses: explicit, prefix-based inbound mail per tenant.

A relay is an address on the platform receive domain that a tenant creates on
purpose, for example `support-acme@in.bokito.ai`. Nothing is provisioned
automatically: a workspace starts with zero email channels and stays that way
until someone creates a relay or connects Gmail/Outlook.

The address is always `{prefix}-{workspace-slug}@{domain}`. The slug suffix
keeps prefixes free per tenant (every workspace can have `support`) while the
full address stays globally unique on one receive domain, which is what the
Resend `email.received` webhook needs to resolve a recipient to a tenant.

A relay is a `ChannelAccount` with `provider="bokito"`, so it flows through the
same inbound/outbound paths as any other mailbox. Inbound arrives via
`/api/inbound/resend`; outbound goes out over the Resend Send API.
"""

from __future__ import annotations

import re
import secrets
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Tenant
from app.models.channel import ChannelAccount

BOKITO_PROVIDER = "bokito"

# Three is enough for the common forwarding setups (info, support, sales) and
# keeps the receive domain from turning into free address hosting.
MAX_RELAYS = 3

PREFIX_MIN_LENGTH = 3
PREFIX_MAX_LENGTH = 24

# Addresses mail servers and humans expect to mean something else.
RESERVED_PREFIXES = frozenset(
    {
        "postmaster",
        "abuse",
        "admin",
        "administrator",
        "hostmaster",
        "webmaster",
        "noreply",
        "no-reply",
        "mailer-daemon",
        "bounce",
        "bounces",
        "root",
        "security",
    }
)


class RelayError(Exception):
    """Relay creation refused; carries the HTTP status the router should use."""

    def __init__(self, detail: str, *, status_code: int = 400, suggestion: str = ""):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.suggestion = suggestion


def inbound_domain() -> str:
    return get_settings().bokito_inbound_domain


def _slugify(raw: str, *, max_length: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (raw or "").lower()).strip("-")
    return slug[:max_length].strip("-")


def workspace_slug(tenant_slug: str) -> str:
    return _slugify(tenant_slug, max_length=PREFIX_MAX_LENGTH) or "workspace"


def normalize_prefix(raw: str) -> str:
    """Clean a user-typed prefix, or raise with why it will not do."""
    prefix = _slugify(raw, max_length=PREFIX_MAX_LENGTH)
    if len(prefix) < PREFIX_MIN_LENGTH:
        raise RelayError(
            f"Use at least {PREFIX_MIN_LENGTH} letters or numbers for the prefix."
        )
    if prefix in RESERVED_PREFIXES:
        raise RelayError(f"'{prefix}' is reserved. Pick another prefix.")
    return prefix


def build_relay_address(prefix: str, tenant_slug: str) -> str:
    """`{prefix}-{workspace-slug}@{domain}`, always lowercase."""
    return f"{normalize_prefix(prefix)}-{workspace_slug(tenant_slug)}@{inbound_domain()}"


def relay_prefix(address: str, tenant_slug: str) -> str:
    """The prefix part of an existing relay address (best effort)."""
    local = str(address or "").split("@", 1)[0]
    suffix = f"-{workspace_slug(tenant_slug)}"
    return local[: -len(suffix)] if local.endswith(suffix) else local


async def list_relays(session: AsyncSession, tenant_id: UUID) -> list[ChannelAccount]:
    result = await session.execute(
        select(ChannelAccount)
        .where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.channel == "email",
            ChannelAccount.provider == BOKITO_PROVIDER,
        )
        .order_by(ChannelAccount.created_at)
    )
    return list(result.scalars().all())


async def _address_taken(session: AsyncSession, address: str) -> bool:
    result = await session.execute(
        select(func.count())
        .select_from(ChannelAccount)
        .where(func.lower(ChannelAccount.address) == address)
    )
    return bool(result.scalar_one() or 0)


async def create_relay(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    prefix: str,
    label: str = "",
    commit: bool = True,
) -> ChannelAccount:
    """Create one relay address for a tenant (max `MAX_RELAYS`)."""
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one()
    existing = await list_relays(session, tenant_id)
    if len(existing) >= MAX_RELAYS:
        raise RelayError(
            f"A workspace can have at most {MAX_RELAYS} Bokito addresses.",
            status_code=409,
        )
    address = build_relay_address(prefix, tenant.slug)
    if await _address_taken(session, address):
        clean = normalize_prefix(prefix)
        raise RelayError(
            f"{address} is already in use.",
            status_code=409,
            suggestion=build_relay_address(f"{clean}-{secrets.token_hex(2)}", tenant.slug),
        )
    account = ChannelAccount(
        tenant_id=tenant_id,
        channel="email",
        address=address,
        provider=BOKITO_PROVIDER,
        display_name=label.strip() or normalize_prefix(prefix),
        is_enabled=True,
    )
    session.add(account)
    if commit:
        await session.commit()
        await session.refresh(account)
    else:
        await session.flush()
    return account


async def find_relay_by_address(
    session: AsyncSession, address: str
) -> ChannelAccount | None:
    """Resolve an inbound recipient address to its tenant relay (global)."""
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
