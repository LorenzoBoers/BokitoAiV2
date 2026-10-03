"""Contact (CRM) tools: the people behind conversations.

Same records the contact panel and the Contacts page read, exposed as
governed tools so agents and MCP clients work off one source of truth.
Reads are ungated; the upsert goes through the allowance policy.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import String, cast, func, or_, select

from app.models.channel import Contact
from app.models.signal import Signal
from app.tools.registry import ToolContext, ToolSpec, register_tool


def _serialize(row: Contact, *, thread_count: int | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": str(row.id),
        "channel": row.channel,
        "address": row.address,
        "display_name": row.display_name,
        "status": row.status,
        "company": row.company,
        "company_id": str(row.company_id) if row.company_id else None,
        "title": row.title,
        "phone": row.phone,
        "notes": row.notes,
        "merged_into_id": str(row.merged_into_id) if row.merged_into_id else None,
        "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
    if thread_count is not None:
        data["thread_count"] = thread_count
    return data


async def _find_contact(ctx: ToolContext, raw_id: str) -> Contact | None:
    """Look a contact up by id, tolerating hyphen-less UUID text on SQLite."""
    try:
        contact_id = UUID(raw_id)
    except ValueError:
        return None
    hyphenated = str(contact_id)
    result = await ctx.session.execute(
        select(Contact).where(
            Contact.tenant_id == ctx.tenant_id,
            or_(
                Contact.id == contact_id,
                cast(Contact.id, String) == hyphenated,
                cast(Contact.id, String) == hyphenated.replace("-", ""),
            ),
        )
    )
    return result.scalar_one_or_none()


async def _thread_count(ctx: ToolContext, contact: Contact) -> int:
    count = (
        await ctx.session.execute(
            select(func.count(Signal.id)).where(
                Signal.tenant_id == ctx.tenant_id, Signal.contact_id == contact.id
            )
        )
    ).scalar_one()
    return int(count or 0)


async def _list_contacts(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    limit = max(1, min(int(tool_input.get("limit") or 25), 100))
    stmt = select(Contact).where(
        Contact.tenant_id == ctx.tenant_id, Contact.merged_into_id.is_(None)
    )
    query = str(tool_input.get("query") or "").strip()
    if query:
        like = f"%{query}%"
        stmt = stmt.where(
            Contact.display_name.ilike(like)
            | Contact.address.ilike(like)
            | Contact.company.ilike(like)
        )
    channel = str(tool_input.get("channel") or "").strip()
    if channel:
        stmt = stmt.where(Contact.channel == channel)
    stmt = stmt.order_by(Contact.last_seen_at.desc().nullslast()).limit(limit)
    rows = list((await ctx.session.execute(stmt)).scalars().all())

    counts: dict[UUID, int] = {}
    if rows:
        count_rows = await ctx.session.execute(
            select(Signal.contact_id, func.count(Signal.id))
            .where(
                Signal.tenant_id == ctx.tenant_id,
                Signal.contact_id.in_([c.id for c in rows]),
            )
            .group_by(Signal.contact_id)
        )
        counts = {row[0]: int(row[1]) for row in count_rows.all()}
    return {
        "contacts": [_serialize(c, thread_count=counts.get(c.id, 0)) for c in rows],
        "count": len(rows),
    }


async def _get_contact(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    raw = str(tool_input.get("contact_id") or "").strip()
    if not raw:
        return {"error": "contact_id is required"}
    contact = await _find_contact(ctx, raw)
    if contact is None:
        return {"error": "Contact not found"}
    return _serialize(contact, thread_count=await _thread_count(ctx, contact))


async def _upsert_contact(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Create or update the email contact for one address (CRM profile fields)."""
    from app.services.companies import link_contact_company
    from app.services.signals import get_or_create_contact

    email = str(tool_input.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return {"error": "email must be a valid email address"}
    name = str(tool_input.get("name") or "").strip()

    existed = (
        await ctx.session.execute(
            select(Contact.id).where(
                Contact.tenant_id == ctx.tenant_id,
                Contact.channel == "email",
                Contact.address == email,
            )
        )
    ).first() is not None

    contact = await get_or_create_contact(
        ctx.session, ctx.tenant_id, channel="email", address=email, display_name=name
    )
    if contact is None:
        return {"error": "Could not create contact"}

    # Explicit values win over what inbound traffic filled in earlier.
    if name:
        contact.display_name = name
    for field in ("company", "title", "phone", "notes"):
        value = tool_input.get(field)
        if isinstance(value, str) and value.strip():
            setattr(contact, field, value.strip())
    ctx.session.add(contact)
    await ctx.session.flush()
    await link_contact_company(ctx.session, contact)
    await ctx.session.commit()
    await ctx.session.refresh(contact)
    return {"created": not existed, **_serialize(contact)}


# The customer-facing agent always gets this, so it cannot learn whether a
# contact exists or what happened next.
LINK_CUSTOMER_RESPONSE: dict[str, str] = {
    "status": "noted",
    "copy": "Thanks. Continue the conversation; do not mention accounts or records.",
}


def _link_copy(locale: str, key: str, **values: str) -> str:
    nl = {
        "link_title": "Gesprek koppelen aan {name}?",
        "link_summary": "De bezoeker gaf {identifier} op. Dat hoort bij {name}. Niet bevestigd.",
        "create_title": "Nieuw contact maken voor {identifier}?",
        "create_summary": "De bezoeker gaf {identifier} op. Er is nog geen contact met dit adres.",
        "choose_title": "Welk contact is dit?",
        "choose_summary": "{identifier} hoort bij meer dan een contact.",
        "merge_summary": " Dit gesprek hoort al bij een ander contact; koppelen voegt ze samen (owner of admin).",
        "link": "Koppelen",
        "create": "Contact maken",
        "reject": "Niet koppelen",
    }
    en = {
        "link_title": "Link conversation to {name}?",
        "link_summary": "The visitor gave {identifier}. That belongs to {name}. Not verified.",
        "create_title": "Create a contact for {identifier}?",
        "create_summary": "The visitor gave {identifier}. No contact has this address yet.",
        "choose_title": "Which contact is this?",
        "choose_summary": "{identifier} belongs to more than one contact.",
        "merge_summary": " This conversation already belongs to another contact; linking merges them (owner or admin).",
        "link": "Link",
        "create": "Create contact",
        "reject": "Don't link",
    }
    return (nl if locale == "nl" else en)[key].format(**values)


async def _link_decision(
    ctx: ToolContext,
    signal: Signal,
    proposal: Any,
    locale: str,
) -> None:
    from app.services.signal_decisions import create_decision

    identifier = proposal.email or proposal.phone
    base = {
        "signal_id": str(signal.id),
        "email": proposal.email,
        "phone": proposal.phone,
        "name": proposal.name,
        "basis": proposal.basis,
        "merge": proposal.needs_merge,
    }
    reject = {"id": "reject", "label": _link_copy(locale, "reject"), "action_type": "reject"}
    if proposal.outcome == "suggest":
        title = _link_copy(locale, "choose_title")
        summary = _link_copy(locale, "choose_summary", identifier=identifier)
        options = [
            {
                "id": f"link_{c.id}",
                "label": f"{_link_copy(locale, 'link')}: {c.display_name or c.address}",
                "action_type": "contact_link",
                "payload": {**base, "contact_id": str(c.id)},
            }
            for c in proposal.candidates[:4]
        ]
    elif proposal.outcome == "create":
        title = _link_copy(locale, "create_title", identifier=identifier)
        summary = _link_copy(locale, "create_summary", identifier=identifier)
        options = [
            {
                "id": "create",
                "label": _link_copy(locale, "create"),
                "action_type": "contact_create",
                "payload": base,
            }
        ]
    else:
        name = proposal.person.display_name or proposal.person.address
        title = _link_copy(locale, "link_title", name=name)
        summary = _link_copy(locale, "link_summary", identifier=identifier, name=name)
        options = [
            {
                "id": "link",
                "label": _link_copy(locale, "link"),
                "action_type": "contact_link",
                "payload": {**base, "contact_id": str(proposal.person.id)},
            }
        ]
    if proposal.needs_merge:
        summary += _link_copy(locale, "merge_summary")
    await create_decision(
        ctx.session,
        ctx.tenant_id,
        title=title,
        summary=summary,
        options=[*options, reject],
        agent_id=ctx.agent.id if ctx.agent else None,
        signal_id=signal.id,
        run_id=ctx.run_id,
        source_type="agent" if ctx.agent else "system",
        source_id="link_conversation_contact",
    )


async def _link_conversation_contact(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Link the conversation to a person from an email or phone the visitor gave.

    AI handling decides: manual does nothing; assisted links only verified
    addresses and asks for the rest; autonomous also links claimed addresses
    and creates a contact when none exists. Ambiguous matches and merging two
    known persons always ask.
    """
    from app.models.auth import Tenant
    from app.services import contact_identity as identity
    from app.services.ai_handling import resolve_for_signal
    from app.services.customer_verify import thread_assurance_valid
    from app.services.language import resolve_workspace_language

    customer = ctx.audience == "customer"
    raw_signal = str(tool_input.get("signal_id") or "") or (str(ctx.signal_id) if ctx.signal_id else "")
    try:
        signal = await ctx.session.get(Signal, UUID(raw_signal)) if raw_signal else None
    except ValueError:
        signal = None
    if signal is None or signal.tenant_id != ctx.tenant_id:
        return dict(LINK_CUSTOMER_RESPONSE) if customer else {"error": "Conversation not found"}

    tenant = await ctx.session.get(Tenant, ctx.tenant_id)
    email = identity.normalize_email(str(tool_input.get("email") or ""))
    basis = "claimed"
    if email and thread_assurance_valid(signal) and (signal.assurance_email or "").lower() == email:
        basis = "verified"
    if not customer and ctx.user_id is not None:
        basis = "manual"
    proposal = await identity.resolve_link(
        ctx.session,
        tenant,
        signal,
        email=email,
        phone=str(tool_input.get("phone") or ""),
        name=str(tool_input.get("name") or ""),
        basis=basis,
    )

    def done(result: dict[str, Any]) -> dict[str, Any]:
        return dict(LINK_CUSTOMER_RESPONSE) if customer else result

    if proposal.outcome == "none":
        return done({"status": "unchanged", "reason": proposal.reason})

    mode = (await resolve_for_signal(ctx.session, tenant, signal)).effective
    if customer and mode == "manual":
        return done({"status": "skipped", "reason": "manual"})

    if basis == "manual":
        may_apply = proposal.outcome in ("link", "create") and not (
            proposal.needs_merge and ctx.user_role not in ("owner", "admin")
        )
    elif proposal.outcome == "suggest" or proposal.needs_merge or ctx.mode == "ask":
        may_apply = False
    elif basis == "verified":
        may_apply = mode in ("assisted", "autonomous")
    else:
        may_apply = mode == "autonomous"

    if not may_apply:
        await _link_decision(ctx, signal, proposal, resolve_workspace_language(tenant))
        await ctx.session.commit()
        return done({"status": "asked", "outcome": proposal.outcome})

    created = proposal.outcome == "create"
    person = await identity.apply_link(
        ctx.session,
        signal,
        proposal,
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id) if ctx.agent else str(ctx.user_id or ""),
    )
    await ctx.session.commit()
    return done(
        {
            "status": "created" if created else "linked",
            "contact_id": str(person.id),
            "basis": proposal.basis,
        }
    )


register_tool(
    ToolSpec(
        name="link_conversation_contact",
        description=(
            "When the visitor gives an email address or phone number, call this "
            "once to link the conversation to the right contact. AI handling "
            "decides whether it links now or asks the team. The answer never "
            "says whether a contact exists; do not tell the visitor about "
            "accounts. Linking does not verify the visitor; personal data "
            "still needs request_customer_verify."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "name": {"type": "string", "description": "Name the visitor gave, if any."},
                "signal_id": {"type": "string"},
            },
        },
        handler=_link_conversation_contact,
        mutating=True,
        gated=False,
        handles_ask=True,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="list_contacts",
        description=(
            "List CRM contacts (name, email, company, thread count). Optional "
            "query matches name, email, or company. Aliases merged into another "
            "contact are left out."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "channel": {"type": "string", "description": "email, widget, slack, …"},
                "limit": {"type": "integer"},
            },
        },
        handler=_list_contacts,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="get_contact",
        description="Read one contact: CRM profile fields plus how many threads it has.",
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {"contact_id": {"type": "string"}},
            "required": ["contact_id"],
        },
        handler=_get_contact,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="upsert_contact",
        description=(
            "Create or update the email contact for one address. Existing CRM "
            "fields are only overwritten by the values you pass, so send just "
            "what you learned. To say who a conversation is with, use "
            "link_conversation_contact instead."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "email": {"type": "string"},
                "name": {"type": "string"},
                "company": {"type": "string"},
                "title": {"type": "string"},
                "phone": {"type": "string"},
                "notes": {"type": "string"},
            },
            "required": ["email"],
        },
        handler=_upsert_contact,
        mutating=True,
        gated=True,
    )
)
