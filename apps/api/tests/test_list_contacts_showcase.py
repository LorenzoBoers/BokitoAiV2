"""list_contacts / get_contact auto-showcase contact cards."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.channel import Contact
from app.models.signal import Signal
from app.services.proposal_items import take_attach_items
from app.tools import execute_tool


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


@pytest.mark.asyncio
async def test_list_contacts_auto_showcases(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    contact = Contact(
        tenant_id=tenant.id,
        channel="email",
        address="harold@example.com",
        display_name="Harold Example",
        company="Example BV",
        status="approved",
    )
    chat = Signal(tenant_id=tenant.id, channel="assistant", subject="Which people?")
    session_override.add(contact)
    session_override.add(chat)
    await session_override.commit()

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "list_contacts",
        {"query": "Harold"},
        signal_id=chat.id,
    )
    assert "error" not in result, result
    assert result["count"] >= 1
    row = next(c for c in result["contacts"] if c["id"] == str(contact.id))
    assert row["path"] == f"/contacts/{contact.id}"
    assert any(i.get("type") == "contact" and i.get("id") == str(contact.id) for i in result.get("items") or [])

    pending = take_attach_items(chat.id)
    assert any(i.get("type") == "contact" and i.get("id") == str(contact.id) for i in pending)


@pytest.mark.asyncio
async def test_get_contact_auto_showcases(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    contact = Contact(
        tenant_id=tenant.id,
        channel="email",
        address="sanne@klant.nl",
        display_name="Sanne de Vries",
        status="approved",
    )
    chat = Signal(tenant_id=tenant.id, channel="assistant", subject="Who is Sanne?")
    session_override.add(contact)
    session_override.add(chat)
    await session_override.commit()

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "get_contact",
        {"contact_id": str(contact.id)},
        signal_id=chat.id,
    )
    assert "error" not in result, result
    assert result["id"] == str(contact.id)
    assert any(i.get("type") == "contact" and i.get("id") == str(contact.id) for i in result.get("items") or [])
    pending = take_attach_items(chat.id)
    assert len(pending) == 1
    assert pending[0]["type"] == "contact"
