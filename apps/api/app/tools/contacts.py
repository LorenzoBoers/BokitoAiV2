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
            "what you learned."
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
