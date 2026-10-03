"""One identity system: link a conversation to a person.

A person is a canonical ``Contact`` (``merged_into_id`` is null). Every other
way to reach that person (widget visitor key, email address, WhatsApp number)
is an identity row whose ``merged_into_id`` points at the person. Linking a
conversation never overwrites an identity row: it adds missing identity rows,
merges the visitor row into the person, and points the thread at the person.

``Signal.contact_basis`` records how the link was made:

- ``verified`` — the customer proved control of the address (magic link).
- ``claimed`` — the customer typed an address that matches; no proof.
- ``manual`` — a teammate linked it.

Personal data stays behind ``Signal.assurance_level``; a claimed link never
changes assurance.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.channel import Contact
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.signals import _is_anonymous_contact_identity

LINK_BASES = ("verified", "claimed", "manual")
LINK_OUTCOMES = ("link", "create", "suggest", "none")

_COUNTRY_CODES = {"nl": "31", "de": "49", "fr": "33", "es": "34", "en": "44"}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(value: str | None) -> str:
    email = (value or "").strip().lower()
    return email if _EMAIL_RE.match(email) else ""


def normalize_phone(value: str | None, region: str = "nl") -> str:
    """E.164-ish: ``+`` and digits only. A national number (leading 0) gets
    the workspace country code. Returns "" when too short to be a number."""
    raw = re.sub(r"[\s\-().]", "", (value or "").strip())
    if raw.startswith("00"):
        raw = "+" + raw[2:]
    if raw.startswith("0"):
        raw = "+" + _COUNTRY_CODES.get(region, "31") + raw[1:]
    elif raw and not raw.startswith("+"):
        raw = "+" + raw
    digits = raw[1:]
    if not digits.isdigit() or len(digits) < 8 or len(digits) > 15:
        return ""
    return raw


def phone_region(tenant: Tenant | None) -> str:
    from app.services.language import resolve_workspace_language

    return resolve_workspace_language(tenant)


def is_anonymous(contact: Contact | None) -> bool:
    if contact is None:
        return True
    return _is_anonymous_contact_identity(contact.address, contact.display_name)


async def canonical(session: AsyncSession, contact: Contact | None) -> Contact | None:
    """Follow ``merged_into_id`` to the person (cycle-safe)."""
    seen: set[UUID] = set()
    current = contact
    while current is not None and current.merged_into_id and current.id not in seen:
        seen.add(current.id)
        parent = await session.get(Contact, current.merged_into_id)
        if parent is None:
            break
        current = parent
    return current


def _digits_only(column: Any) -> Any:
    """Stored phone numbers are free-form; strip the usual separators."""
    for sep in (" ", "-", "(", ")", "."):
        column = func.replace(column, sep, "")
    return column


async def find_person(
    session: AsyncSession, tenant_id: UUID, *, email: str = "", phone: str = "", region: str = "nl"
) -> list[Contact]:
    """Distinct persons that own this email or phone. More than one is weak."""
    conditions = []
    if email:
        conditions.append(Contact.address == email)
    tail = re.sub(r"\D", "", phone)[-9:] if phone else ""
    if tail:
        conditions.append(_digits_only(Contact.phone).like(f"%{tail}%"))
        conditions.append(_digits_only(Contact.address).like(f"%{tail}%"))
    if not conditions:
        return []
    rows = (
        await session.execute(
            select(Contact).where(Contact.tenant_id == tenant_id, or_(*conditions))
        )
    ).scalars().all()
    persons: dict[UUID, Contact] = {}
    for row in rows:
        if row.status == "blocked":
            continue
        matched = bool(email) and row.address == email
        if not matched and phone:
            matched = phone in (
                normalize_phone(row.phone, region),
                normalize_phone(row.address, region) if "@" not in row.address else "",
            )
        if not matched:
            continue
        person = await canonical(session, row)
        if person is not None and person.status != "blocked":
            persons[person.id] = person
    return list(persons.values())


@dataclass
class LinkProposal:
    outcome: str  # link | create | suggest | none
    basis: str = "claimed"
    email: str = ""
    phone: str = ""
    name: str = ""
    person: Contact | None = None
    candidates: list[Contact] = field(default_factory=list)
    # Linking would merge two existing persons; owner/admin decide.
    needs_merge: bool = False
    reason: str = ""


async def resolve_link(
    session: AsyncSession,
    tenant: Tenant,
    signal: Signal,
    *,
    email: str = "",
    phone: str = "",
    name: str = "",
    basis: str = "claimed",
) -> LinkProposal:
    region = phone_region(tenant)
    email_n = normalize_email(email)
    phone_n = normalize_phone(phone, region)
    proposal = LinkProposal(
        outcome="none", basis=basis, email=email_n, phone=phone_n, name=(name or "").strip()
    )
    if not email_n and not phone_n:
        proposal.reason = "no_identifier"
        return proposal
    if email_n:
        from app.services.workspace_members import find_member_by_email

        if await find_member_by_email(session, tenant.id, email_n):
            proposal.reason = "member"
            return proposal

    current = None
    if signal.contact_id:
        current = await canonical(session, await session.get(Contact, signal.contact_id))
    persons = await find_person(session, tenant.id, email=email_n, phone=phone_n, region=region)
    if len(persons) > 1:
        proposal.outcome = "suggest"
        proposal.candidates = persons
        proposal.reason = "ambiguous"
        return proposal
    if persons:
        person = persons[0]
        proposal.person = person
        if current is not None and current.id == person.id:
            proposal.outcome = "none" if (signal.contact_basis or "") == basis else "link"
            proposal.reason = "already_linked"
            return proposal
        proposal.outcome = "link"
        proposal.needs_merge = current is not None and not is_anonymous(current)
        return proposal
    proposal.outcome = "create"
    proposal.needs_merge = current is not None and not is_anonymous(current)
    return proposal


async def _system_message(session: AsyncSession, signal: Signal, text: str, meta: dict) -> SignalMessage:
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        kind="system_event",
        direction="internal",
        role="system",
        body_text=text,
        body_preview=text[:160],
        metadata_json=json.dumps(meta),
    )
    session.add(message)
    signal.last_message_at = datetime.utcnow()
    return message


def _label(person: Contact) -> str:
    name = person.display_name.strip()
    address = person.address if "@" in person.address else person.phone or person.address
    if name and address and name != address:
        return f"{name} ({address})"
    return name or address


async def _locale(session: AsyncSession, tenant_id: UUID) -> str:
    from app.services.language import resolve_workspace_language

    return resolve_workspace_language(await session.get(Tenant, tenant_id))


_BASIS_NL = {"verified": "bevestigd", "claimed": "geclaimd", "manual": "handmatig"}
_BASIS_EN = {"verified": "verified", "claimed": "claimed", "manual": "manual"}


async def apply_link(
    session: AsyncSession,
    signal: Signal,
    proposal: LinkProposal,
    *,
    actor_type: str,
    actor_id: str = "",
    publish: bool = True,
) -> Contact:
    """Point the thread at the person; add identity rows; never overwrite one.

    Caller commits. Raises ``ValueError`` for an outcome that cannot be applied.
    """
    if proposal.outcome not in ("link", "create"):
        raise ValueError(f"Cannot apply outcome {proposal.outcome}")
    tenant_id = signal.tenant_id
    now = datetime.utcnow()
    previous_id = signal.contact_id
    previous_basis = signal.contact_basis or ""
    current = await session.get(Contact, previous_id) if previous_id else None
    current_person = await canonical(session, current)
    created_ids: list[str] = []

    person = proposal.person
    if proposal.outcome == "create" or person is None:
        if proposal.email:
            channel, address = "email", proposal.email
        else:
            channel, address = "phone", proposal.phone
        person = Contact(
            tenant_id=tenant_id,
            channel=channel,
            address=address,
            display_name=proposal.name,
            phone=proposal.phone,
            status="approved",
            last_seen_at=now,
        )
        session.add(person)
        await session.flush()
        created_ids.append(str(person.id))
    else:
        if proposal.email and person.address != proposal.email:
            exists = (
                await session.execute(
                    select(Contact.id).where(
                        Contact.tenant_id == tenant_id, Contact.address == proposal.email
                    ).limit(1)
                )
            ).first()
            if exists is None:
                alias = Contact(
                    tenant_id=tenant_id,
                    channel="email",
                    address=proposal.email,
                    display_name=proposal.name or person.display_name,
                    status="approved",
                    merged_into_id=person.id,
                    last_seen_at=now,
                )
                session.add(alias)
                await session.flush()
                created_ids.append(str(alias.id))
        if proposal.phone and not person.phone:
            person.phone = proposal.phone
        if proposal.name and not person.display_name:
            person.display_name = proposal.name
        person.last_seen_at = now
        session.add(person)

    merged_ids: list[str] = []
    moved_signal_ids: list[str] = [str(signal.id)]
    absorbed = current_person if current_person is not None and current_person.id != person.id else None
    if absorbed is not None:
        absorbed.merged_into_id = person.id
        session.add(absorbed)
        merged_ids.append(str(absorbed.id))
        others = (
            await session.execute(
                select(Signal).where(
                    Signal.tenant_id == tenant_id,
                    Signal.contact_id == absorbed.id,
                    Signal.id != signal.id,
                )
            )
        ).scalars().all()
        for other in others:
            other.contact_id = person.id
            session.add(other)
            moved_signal_ids.append(str(other.id))

    signal.contact_id = person.id
    signal.contact_basis = proposal.basis
    if "@" in person.address:
        signal.contact_email = proposal.email or person.address
    elif proposal.email:
        signal.contact_email = proposal.email
    if person.display_name:
        signal.contact_name = person.display_name
    if proposal.phone and not signal.contact_phone:
        signal.contact_phone = proposal.phone
    session.add(signal)

    payload: dict[str, Any] = {
        "previous_contact_id": str(previous_id) if previous_id else None,
        "previous_basis": previous_basis,
        "person_id": str(person.id),
        "basis": proposal.basis,
        "created_ids": created_ids,
        "merged_ids": merged_ids,
        "moved_signal_ids": moved_signal_ids,
        "actor": actor_type,
    }
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="contact_linked",
            actor_type=actor_type,
            actor_id=actor_id,
            payload_json=json.dumps(payload),
        )
    )
    locale = await _locale(session, tenant_id)
    basis_label = (
        _BASIS_NL.get(proposal.basis, proposal.basis)
        if locale == "nl"
        else _BASIS_EN.get(proposal.basis, proposal.basis)
    )
    # New person vs attach to an existing one — aliases in created_ids do not count as "created".
    created_person = proposal.outcome == "create" or str(person.id) in created_ids
    if created_person:
        text = (
            f"Contact aangemaakt: {_label(person)} ({basis_label})."
            if locale == "nl"
            else f"Contact created: {_label(person)} ({basis_label})."
        )
        event_name = "contact_created"
    else:
        text = (
            f"Gekoppeld aan {_label(person)} ({basis_label})."
            if locale == "nl"
            else f"Linked to {_label(person)} ({basis_label})."
        )
        event_name = "contact_linked"
    message = await _system_message(
        session,
        signal,
        text,
        {"event": event_name, "person_id": str(person.id), "created": created_person},
    )
    await session.flush()
    from app.services.companies import link_contact_company

    await link_contact_company(session, person)
    if publish:
        from app.gateway.publish import publish_signal_message, publish_thread_update

        await publish_signal_message(signal, message)
        await publish_thread_update(signal)
    return person


DECISION_ACTIONS = ("contact_link", "contact_create")


async def apply_decided_link(
    session: AsyncSession,
    tenant_id: UUID,
    action_type: str,
    payload: dict[str, Any],
    *,
    user_id: UUID | None,
) -> Contact | None:
    """Run an approved ``contact_link`` / ``contact_create`` decision option.

    Merging two known persons needs owner or admin. Caller commits.
    """
    from app.models.auth import Membership

    raw_signal = str(payload.get("signal_id") or "")
    signal = await session.get(Signal, UUID(raw_signal)) if raw_signal else None
    if signal is None or signal.tenant_id != tenant_id:
        raise ValueError("Conversation not found")
    if payload.get("merge"):
        role = None
        if user_id is not None:
            role = (
                await session.execute(
                    select(Membership.role).where(
                        Membership.tenant_id == tenant_id, Membership.user_id == user_id
                    )
                )
            ).scalar_one_or_none()
        if role not in ("owner", "admin"):
            raise PermissionError("Merging two contacts needs an owner or admin")
    basis = str(payload.get("basis") or "claimed")
    if basis not in LINK_BASES:
        basis = "claimed"
    tenant = await session.get(Tenant, tenant_id)
    raw_contact = str(payload.get("contact_id") or "")
    if action_type == "contact_link" and raw_contact:
        target = await session.get(Contact, UUID(raw_contact))
        person = await canonical(session, target)
        if person is None or person.tenant_id != tenant_id:
            raise ValueError("Contact not found")
        proposal = LinkProposal(
            outcome="link",
            basis=basis,
            email=normalize_email(str(payload.get("email") or "")),
            phone=normalize_phone(str(payload.get("phone") or ""), phone_region(tenant)),
            name=str(payload.get("name") or ""),
            person=person,
        )
    else:
        proposal = await resolve_link(
            session,
            tenant,
            signal,
            email=str(payload.get("email") or ""),
            phone=str(payload.get("phone") or ""),
            name=str(payload.get("name") or ""),
            basis=basis,
        )
        if proposal.outcome == "none":
            return proposal.person
        if proposal.outcome == "suggest":
            raise ValueError("More than one contact matches; link from the contact panel")
    return await apply_link(
        session, signal, proposal, actor_type="user", actor_id=str(user_id or "")
    )


async def last_link_event(session: AsyncSession, signal: Signal) -> SignalEvent | None:
    row = (
        await session.execute(
            select(SignalEvent)
            .where(
                SignalEvent.signal_id == signal.id,
                SignalEvent.event_type.in_(("contact_linked", "contact_unlinked")),
            )
            .order_by(SignalEvent.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return row if row is not None and row.event_type == "contact_linked" else None


async def unlink(
    session: AsyncSession,
    signal: Signal,
    *,
    actor_type: str,
    actor_id: str = "",
    user_id: UUID | None = None,
) -> bool:
    """Undo the latest link on this thread. Caller commits.

    Returns False when there is no link to undo. A wrong AI link is recorded
    as learning feedback.
    """
    event = await last_link_event(session, signal)
    if event is None:
        return False
    try:
        payload = json.loads(event.payload_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    tenant_id = signal.tenant_id
    person_id = payload.get("person_id")
    previous = payload.get("previous_contact_id")
    previous_uuid = UUID(previous) if previous else None

    for merged in payload.get("merged_ids") or []:
        row = await session.get(Contact, UUID(merged))
        if row is not None and person_id and str(row.merged_into_id) == person_id:
            row.merged_into_id = None
            session.add(row)
    moved = [UUID(sid) for sid in payload.get("moved_signal_ids") or []]
    if moved:
        rows = (
            await session.execute(
                select(Signal).where(Signal.tenant_id == tenant_id, Signal.id.in_(moved))
            )
        ).scalars().all()
        merged_ids = payload.get("merged_ids") or []
        for row in rows:
            if row.id == signal.id:
                continue
            # Sibling threads came from the absorbed visitor/person.
            if merged_ids:
                row.contact_id = UUID(merged_ids[0])
                session.add(row)
    signal.contact_id = previous_uuid
    signal.contact_basis = payload.get("previous_basis") or ""
    previous_row = await session.get(Contact, previous_uuid) if previous_uuid else None
    if previous_row is not None:
        signal.contact_name = previous_row.display_name or signal.contact_name
        signal.contact_email = previous_row.address if "@" in previous_row.address else ""
    else:
        signal.contact_email = ""
    session.add(signal)
    await session.flush()

    for created in payload.get("created_ids") or []:
        row = await session.get(Contact, UUID(created))
        if row is None:
            continue
        in_use = (
            await session.execute(
                select(Signal.id).where(Signal.tenant_id == tenant_id, Signal.contact_id == row.id).limit(1)
            )
        ).first()
        aliases = (
            await session.execute(
                select(Contact.id).where(Contact.merged_into_id == row.id).limit(1)
            )
        ).first()
        if in_use is None and aliases is None:
            await session.delete(row)

    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="contact_unlinked",
            actor_type=actor_type,
            actor_id=actor_id,
            payload_json=json.dumps({"link_event_id": str(event.id), "person_id": person_id}),
        )
    )
    if event.actor_type == "agent":
        from app.models.learning import Feedback

        session.add(
            Feedback(
                tenant_id=tenant_id,
                subject_type="signal",
                subject_id=str(signal.id),
                user_id=user_id,
                sentiment="down",
                correction_key="contact_link",
                comment="Operator undid an AI contact link.",
                metadata_json=json.dumps(
                    {"person_id": person_id, "basis": payload.get("basis"), "agent_id": event.actor_id}
                ),
            )
        )
    locale = await _locale(session, tenant_id)
    text = "Koppeling met contact ongedaan gemaakt." if locale == "nl" else "Contact link undone."
    message = await _system_message(session, signal, text, {"event": "contact_unlinked"})
    await session.flush()
    from app.gateway.publish import publish_signal_message, publish_thread_update

    await publish_signal_message(signal, message)
    await publish_thread_update(signal)
    return True
