"""One identity system: link a conversation to a person."""

import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Membership, Tenant
from app.models.channel import Contact
from app.models.customer_verify import CustomerVerifyToken
from app.models.learning import Feedback
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services import contact_identity as identity
from app.services.customer_verify import consume_verify_token, hash_verify_token
from app.services.notifications import resolve_decision
from app.tools.contacts import LINK_CUSTOMER_RESPONSE
from app.tools.executor import execute_tool
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _headers(client: AsyncClient) -> dict[str, str]:
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _tenant(session, mode: str | None = None) -> Tenant:
    tenant = (await session.execute(select(Tenant))).scalar_one()
    if mode:
        tenant.settings_json = json.dumps({"ai_handling": {"default": {"mode": mode}}})
        session.add(tenant)
        await session.commit()
    return tenant


async def _visitor_thread(session, tenant: Tenant) -> tuple[Signal, Contact]:
    visitor = Contact(
        tenant_id=tenant.id,
        channel="widget",
        address="cust_abc123",
        display_name="Website visitor",
        status="pending",
    )
    session.add(visitor)
    await session.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        source="widget",
        subject="Question",
        contact_id=visitor.id,
        contact_name="Website visitor",
    )
    session.add(signal)
    await session.commit()
    return signal, visitor


async def _person(session, tenant: Tenant, address: str, name: str = "Anna", phone: str = "") -> Contact:
    person = Contact(
        tenant_id=tenant.id, channel="email", address=address, display_name=name, phone=phone
    )
    session.add(person)
    await session.commit()
    return person


def test_normalize_phone():
    assert identity.normalize_phone("06 1234 5678", "nl") == "+31612345678"
    assert identity.normalize_phone("0031-6-12345678", "nl") == "+31612345678"
    assert identity.normalize_phone("+31 (6) 12345678") == "+31612345678"
    assert identity.normalize_phone("030 123 4567", "de") == "+49301234567"
    assert identity.normalize_phone("12") == ""
    assert identity.normalize_email(" Anna@Example.COM ") == "anna@example.com"
    assert identity.normalize_email("not-an-email") == ""


@pytest.mark.asyncio
async def test_link_merges_visitor_and_unlink_restores(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    signal, visitor = await _visitor_thread(session_override, tenant)
    person = await _person(session_override, tenant, "anna@example.com")

    proposal = await identity.resolve_link(
        session_override, tenant, signal, email="Anna@Example.com", basis="claimed"
    )
    assert proposal.outcome == "link"
    assert proposal.person.id == person.id
    assert proposal.needs_merge is False
    await identity.apply_link(session_override, signal, proposal, actor_type="agent", actor_id="a1")
    await session_override.commit()

    await session_override.refresh(visitor)
    assert signal.contact_id == person.id
    assert signal.contact_basis == "claimed"
    assert signal.contact_email == "anna@example.com"
    assert visitor.merged_into_id == person.id
    # The visitor key is an identity; it is never overwritten.
    assert visitor.address == "cust_abc123"
    note = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id, SignalMessage.kind == "system_event"
            )
        )
    ).scalars().all()
    assert len(note) == 1

    assert await identity.unlink(session_override, signal, actor_type="user") is True
    await session_override.commit()
    await session_override.refresh(visitor)
    assert signal.contact_id == visitor.id
    assert signal.contact_basis == ""
    assert visitor.merged_into_id is None
    feedback = (
        await session_override.execute(
            select(Feedback).where(Feedback.correction_key == "contact_link")
        )
    ).scalars().all()
    assert len(feedback) == 1
    assert await identity.unlink(session_override, signal, actor_type="user") is False


@pytest.mark.asyncio
async def test_phone_match_and_ambiguous(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    signal, _ = await _visitor_thread(session_override, tenant)
    await _person(session_override, tenant, "piet@example.com", "Piet", phone="06-12345678")

    proposal = await identity.resolve_link(session_override, tenant, signal, phone="+31612345678")
    assert proposal.outcome == "link"
    assert proposal.person.display_name == "Piet"

    await _person(session_override, tenant, "piet2@example.com", "Piet twee", phone="0612345678")
    ambiguous = await identity.resolve_link(session_override, tenant, signal, phone="0612345678")
    assert ambiguous.outcome == "suggest"
    assert len(ambiguous.candidates) == 2

    missing = await identity.resolve_link(session_override, tenant, signal, email="new@example.com")
    assert missing.outcome == "create"


@pytest.mark.asyncio
async def test_tool_autonomous_links_claimed_and_hides_result(client: AsyncClient, session_override):
    tenant = await _tenant(session_override, "autonomous")
    signal, _ = await _visitor_thread(session_override, tenant)
    person = await _person(session_override, tenant, "anna@example.com")

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "link_conversation_contact",
        {"email": "anna@example.com"},
        signal_id=signal.id,
        trust="external",
    )
    assert result == LINK_CUSTOMER_RESPONSE
    await session_override.refresh(signal)
    assert signal.contact_id == person.id
    assert signal.contact_basis == "claimed"
    # A claimed link never grants assurance.
    assert (signal.assurance_level or "") == ""


@pytest.mark.asyncio
async def test_tool_autonomous_creates_when_no_match(client: AsyncClient, session_override):
    tenant = await _tenant(session_override, "autonomous")
    signal, visitor = await _visitor_thread(session_override, tenant)

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "link_conversation_contact",
        {"email": "fresh@example.com", "name": "Fresh"},
        signal_id=signal.id,
        trust="external",
    )
    assert result == LINK_CUSTOMER_RESPONSE
    await session_override.refresh(signal)
    created = await session_override.get(Contact, signal.contact_id)
    assert created.address == "fresh@example.com"
    assert created.display_name == "Fresh"
    await session_override.refresh(visitor)
    assert visitor.merged_into_id == created.id


@pytest.mark.asyncio
async def test_tool_assisted_asks_then_decision_links(client: AsyncClient, session_override):
    tenant = await _tenant(session_override, "assisted")
    signal, visitor = await _visitor_thread(session_override, tenant)
    person = await _person(session_override, tenant, "anna@example.com")

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "link_conversation_contact",
        {"email": "anna@example.com"},
        signal_id=signal.id,
        trust="external",
    )
    assert result == LINK_CUSTOMER_RESPONSE
    await session_override.refresh(signal)
    assert signal.contact_id == visitor.id
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == signal.id)
        )
    ).scalar_one()
    options = json.loads(decision.options_json)
    assert options[0]["action_type"] == "contact_link"

    owner = (await session_override.execute(select(Membership))).scalars().first()
    await resolve_decision(
        session_override, tenant.id, decision.id, options[0]["id"], "approved", user_id=owner.user_id
    )
    await session_override.refresh(signal)
    assert signal.contact_id == person.id
    assert signal.contact_basis == "claimed"


@pytest.mark.asyncio
async def test_tool_manual_does_nothing(client: AsyncClient, session_override):
    tenant = await _tenant(session_override, "manual")
    signal, visitor = await _visitor_thread(session_override, tenant)
    await _person(session_override, tenant, "anna@example.com")

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "link_conversation_contact",
        {"email": "anna@example.com"},
        signal_id=signal.id,
        trust="external",
    )
    assert result == LINK_CUSTOMER_RESPONSE
    await session_override.refresh(signal)
    assert signal.contact_id == visitor.id
    decisions = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == signal.id)
        )
    ).scalars().all()
    assert decisions == []


@pytest.mark.asyncio
async def test_tool_never_merges_two_known_persons(client: AsyncClient, session_override):
    tenant = await _tenant(session_override, "autonomous")
    known = await _person(session_override, tenant, "bob@example.com", "Bob")
    signal = Signal(tenant_id=tenant.id, channel="email", subject="Hi", contact_id=known.id)
    session_override.add(signal)
    await session_override.commit()
    await _person(session_override, tenant, "anna@example.com")

    await execute_tool(
        session_override,
        tenant.id,
        None,
        "link_conversation_contact",
        {"email": "anna@example.com"},
        signal_id=signal.id,
        trust="external",
    )
    await session_override.refresh(signal)
    assert signal.contact_id == known.id
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == signal.id)
        )
    ).scalar_one()
    assert json.loads(decision.options_json)[0]["payload"]["merge"] is True


@pytest.mark.asyncio
async def test_verify_links_visitor_as_verified(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    signal, visitor = await _visitor_thread(session_override, tenant)
    person = await _person(session_override, tenant, "anna@example.com")
    raw = "identity-verify-raw"
    session_override.add(
        CustomerVerifyToken(
            tenant_id=tenant.id,
            signal_id=signal.id,
            email="anna@example.com",
            contact_id=person.id,
            token_hash=hash_verify_token(raw),
            expires_at=datetime.utcnow() + timedelta(minutes=10),
        )
    )
    await session_override.commit()

    verified = await consume_verify_token(session_override, raw)
    assert verified is not None
    assert verified.contact_id == person.id
    assert verified.contact_basis == "verified"
    assert verified.assurance_level == "verified"
    await session_override.refresh(visitor)
    assert visitor.merged_into_id == person.id


@pytest.mark.asyncio
async def test_contact_link_api_and_identities(client: AsyncClient, session_override):
    headers = await _headers(client)
    tenant = await _tenant(session_override)
    signal, visitor = await _visitor_thread(session_override, tenant)

    patch = await client.patch(
        f"/api/channels/contacts/{visitor.id}", headers=headers, json={"address": "x@example.com"}
    )
    assert patch.status_code == 400

    linked = await client.post(
        f"/api/signals/{signal.id}/contact-link",
        headers=headers,
        json={"email": "new@example.com", "name": "New Person"},
    )
    assert linked.status_code == 200, linked.text
    body = linked.json()
    assert body["status"] == "created"
    assert body["basis"] == "manual"

    detail = await client.get(f"/api/channels/contacts/{body['contact_id']}", headers=headers)
    assert detail.status_code == 200
    assert [i["address"] for i in detail.json()["identities"]] == ["cust_abc123"]
    assert detail.json()["thread_count"] == 1

    events = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == signal.id, SignalEvent.event_type == "contact_linked"
            )
        )
    ).scalars().all()
    assert len(events) == 1

    undone = await client.delete(f"/api/signals/{signal.id}/contact-link", headers=headers)
    assert undone.status_code == 200, undone.text
    assert undone.json()["contact_id"] == str(visitor.id)
    # The created person had no other threads, so it is removed again.
    assert await session_override.get(Contact, __import__("uuid").UUID(body["contact_id"])) is None

    again = await client.delete(f"/api/signals/{signal.id}/contact-link", headers=headers)
    assert again.status_code == 404


@pytest.mark.asyncio
async def test_detach_identity_moves_threads_back(client: AsyncClient, session_override):
    headers = await _headers(client)
    tenant = await _tenant(session_override)
    signal, visitor = await _visitor_thread(session_override, tenant)
    person = await _person(session_override, tenant, "anna@example.com")
    linked = await client.post(
        f"/api/signals/{signal.id}/contact-link", headers=headers, json={"contact_id": str(person.id)}
    )
    assert linked.status_code == 200, linked.text

    detached = await client.post(
        f"/api/channels/contacts/{person.id}/identities/{visitor.id}/detach", headers=headers
    )
    assert detached.status_code == 200, detached.text
    await session_override.refresh(visitor)
    await session_override.refresh(signal)
    assert visitor.merged_into_id is None
    assert signal.contact_id == visitor.id


@pytest.mark.asyncio
async def test_inbound_identity_resolves_to_person(client: AsyncClient, session_override):
    from app.channels.base import InboundMessage, _resolve_contact

    tenant = await _tenant(session_override)
    person = await _person(session_override, tenant, "anna@example.com", phone="0612345678")
    alias = Contact(
        tenant_id=tenant.id, channel="email", address="anna.work@example.com", merged_into_id=person.id
    )
    session_override.add(alias)
    await session_override.commit()

    inbound = InboundMessage(channel="email", source="test", sender_address="anna.work@example.com")
    resolved = await _resolve_contact(session_override, tenant.id, inbound, require_pairing=False)
    assert resolved.id == person.id

    whatsapp = InboundMessage(channel="whatsapp", source="test", sender_address="31612345678")
    resolved_wa = await _resolve_contact(session_override, tenant.id, whatsapp, require_pairing=False)
    assert resolved_wa.id == person.id


@pytest.mark.asyncio
async def test_anonymous_widget_visitor_is_not_a_contact(client: AsyncClient, session_override):
    from app.services.signals import create_inbound_signal, get_or_create_contact

    tenant = await _tenant(session_override)
    created = await get_or_create_contact(
        session_override,
        tenant.id,
        channel="widget",
        address="cust_new_visitor",
        display_name="Website visitor",
    )
    assert created is None

    signal = await create_inbound_signal(
        session_override,
        tenant.id,
        channel="widget",
        source="widget",
        subject="Help",
        body_text="Hallo",
        contact_email="cust_new_visitor",
        contact_name="Website visitor",
    )
    assert signal.contact_id is None

    visitor = Contact(
        tenant_id=tenant.id,
        channel="widget",
        address="cust_listed",
        display_name="Website visitor",
        status="pending",
    )
    person = await _person(session_override, tenant, "real@example.com")
    session_override.add(visitor)
    await session_override.commit()

    headers = await _headers(client)
    listed = await client.get("/api/channels/contacts", headers=headers)
    assert listed.status_code == 200
    addresses = {row["address"] for row in listed.json()["contacts"]}
    assert "cust_listed" not in addresses
    assert "real@example.com" in addresses

    named = Contact(
        tenant_id=tenant.id,
        channel="widget",
        address="cust_named",
        display_name="Vera Visitor",
        status="approved",
    )
    session_override.add(named)
    await session_override.commit()
    listed2 = await client.get("/api/channels/contacts", headers=headers)
    addresses2 = {row["address"] for row in listed2.json()["contacts"]}
    assert "cust_named" in addresses2
