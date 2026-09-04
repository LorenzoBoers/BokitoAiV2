"""Silent customer match + magic-link thread assurance.

The model always sees the same JSON whether a match existed. A link is mailed
only when a Contact or accounting party matches the given email.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Contact
from app.models.customer_verify import CustomerVerifyToken
from app.models.module_install import ModuleInstall
from app.models.signal import Signal

ASSURANCE_NONE = "none"
ASSURANCE_VERIFIED = "verified"
VERIFY_TOKEN_TTL_MINUTES = 20
ASSURANCE_TTL_MINUTES = 45

# Always returned to the model. Never vary this by match/no-match.
VERIFY_MODEL_RESPONSE: dict[str, str] = {
    "status": "check_email",
    "copy": (
        "If we have an account for that email, we sent a short confirmation "
        "link. Ask the visitor to check their inbox and continue here."
    ),
}

NEEDS_VERIFICATION: dict[str, str] = {
    "status": "needs_verification",
    "copy": (
        "This conversation is not confirmed yet. Call request_customer_verify "
        "with the visitor's email, then continue after they confirm."
    ),
}


def normalize_email(raw: str | None) -> str:
    return str(raw or "").strip().lower()


def hash_verify_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.utcnow()


def thread_assurance_valid(signal: Signal | None) -> bool:
    if signal is None:
        return False
    if (signal.assurance_level or "") != ASSURANCE_VERIFIED:
        return False
    expires = signal.assurance_expires_at
    if expires is None:
        return False
    return expires > _now()


def parse_customer_tools(raw: str | None) -> dict[str, bool]:
    try:
        data = json.loads(raw or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): bool(v) for k, v in data.items()}


async def enabled_customer_tool_names(
    session: AsyncSession, tenant_id: UUID
) -> set[str]:
    """Full registry names (``{module}_{verb}``) the tenant opted into."""
    rows = (
        await session.execute(
            select(ModuleInstall).where(ModuleInstall.tenant_id == tenant_id)
        )
    ).scalars().all()
    names: set[str] = set()
    for row in rows:
        for verb, on in parse_customer_tools(row.customer_tools_json).items():
            if on:
                names.add(f"{row.module_slug}_{verb}")
    return names


async def customer_tool_enabled(
    session: AsyncSession, tenant_id: UUID, tool_name: str
) -> bool:
    enabled = await enabled_customer_tool_names(session, tenant_id)
    return tool_name in enabled


async def find_contact_by_email(
    session: AsyncSession, tenant_id: UUID, email: str
) -> Contact | None:
    email = normalize_email(email)
    if not email or "@" not in email:
        return None
    result = await session.execute(
        select(Contact).where(
            Contact.tenant_id == tenant_id,
            Contact.address == email,
        )
    )
    return result.scalar_one_or_none()


async def _accounting_party_exists(
    session: AsyncSession, tenant_id: UUID, email: str
) -> bool:
    """Existence-only check. Never return party payloads to the caller."""
    try:
        from app.modules.dispatch import call_module_verb

        outcome = await call_module_verb(
            session,
            tenant_id,
            "accounting",
            "search_parties",
            {"query": email, "role": "customer"},
            agent_id=None,
        )
    except Exception:
        return False
    if not isinstance(outcome, dict) or outcome.get("error"):
        return False
    parties = outcome.get("parties") or outcome.get("items") or []
    if not isinstance(parties, list):
        return False
    for party in parties:
        if not isinstance(party, dict):
            continue
        party_email = normalize_email(
            str(party.get("email") or party.get("address") or "")
        )
        if party_email and party_email == email:
            return True
    return False


async def find_or_create_contact_on_match(
    session: AsyncSession, tenant_id: UUID, email: str
) -> Contact | None:
    email = normalize_email(email)
    if not email or "@" not in email:
        return None
    contact = await find_contact_by_email(session, tenant_id, email)
    if contact is not None:
        return contact
    if not await _accounting_party_exists(session, tenant_id, email):
        return None
    contact = Contact(
        tenant_id=tenant_id,
        channel="email",
        address=email,
        display_name=email.split("@")[0],
        status="approved",
    )
    session.add(contact)
    await session.flush()
    return contact


async def request_customer_verify(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_id: UUID | None,
    email: str,
) -> dict[str, Any]:
    """Always return ``VERIFY_MODEL_RESPONSE``. Mail the link only on match."""
    email = normalize_email(email)
    signal: Signal | None = None
    if signal_id is not None:
        signal = (
            await session.execute(
                select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
    contact = await find_or_create_contact_on_match(session, tenant_id, email)
    if contact is None or signal is None:
        await session.commit()
        return dict(VERIFY_MODEL_RESPONSE)

    raw = secrets.token_urlsafe(32)
    token = CustomerVerifyToken(
        tenant_id=tenant_id,
        signal_id=signal.id,
        email=email,
        contact_id=contact.id,
        token_hash=hash_verify_token(raw),
        expires_at=_now() + timedelta(minutes=VERIFY_TOKEN_TTL_MINUTES),
    )
    session.add(token)
    await session.commit()

    from app.config import get_settings
    from app.services.transactional_mail import send_customer_verify_mail

    base = get_settings().public_api_url.rstrip("/")
    link = f"{base}/api/customer-verify/{raw}"
    await send_customer_verify_mail(email, verify_link=link)
    return dict(VERIFY_MODEL_RESPONSE)


async def consume_verify_token(
    session: AsyncSession, raw_token: str
) -> Signal | None:
    digest = hash_verify_token(raw_token.strip())
    token = (
        await session.execute(
            select(CustomerVerifyToken).where(CustomerVerifyToken.token_hash == digest)
        )
    ).scalar_one_or_none()
    if token is None or token.used_at is not None:
        return None
    if token.expires_at <= _now():
        return None
    signal = (
        await session.execute(
            select(Signal).where(
                Signal.id == token.signal_id, Signal.tenant_id == token.tenant_id
            )
        )
    ).scalar_one_or_none()
    if signal is None:
        return None
    now = _now()
    token.used_at = now
    signal.assurance_level = ASSURANCE_VERIFIED
    signal.assurance_contact_id = token.contact_id
    signal.assurance_email = token.email
    signal.assurance_verified_at = now
    signal.assurance_expires_at = now + timedelta(minutes=ASSURANCE_TTL_MINUTES)
    if token.contact_id and not signal.contact_id:
        signal.contact_id = token.contact_id
    if token.email and not signal.contact_email:
        signal.contact_email = token.email
    session.add(token)
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal
