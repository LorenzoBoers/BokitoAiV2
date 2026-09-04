"""Phase 1: silent verify, thread assurance, and customer tool exposure."""

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.channel import Contact
from app.models.customer_verify import CustomerVerifyToken
from app.models.module_install import ModuleInstall
from app.models.signal import Signal
from app.services.customer_verify import (
    VERIFY_MODEL_RESPONSE,
    request_customer_verify,
)
from app.tools.executor import execute_tool
from app.tools.registry import filter_tools_for_audience, get_tool_definitions, get_tool_spec


@pytest.mark.asyncio
async def test_verify_match_and_nomatch_same_json(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    contact = Contact(
        tenant_id=tenant.id,
        channel="email",
        address="billing@example.com",
        display_name="Billing",
    )
    signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        source="widget",
        subject="Invoice question",
    )
    session_override.add(contact)
    session_override.add(signal)
    await session_override.commit()

    matched = await request_customer_verify(
        session_override,
        tenant.id,
        signal_id=signal.id,
        email="Billing@Example.com",
    )
    missing = await request_customer_verify(
        session_override,
        tenant.id,
        signal_id=signal.id,
        email="nobody@example.com",
    )
    assert matched == VERIFY_MODEL_RESPONSE
    assert missing == VERIFY_MODEL_RESPONSE
    assert matched == missing

    tokens = (
        await session_override.execute(
            select(CustomerVerifyToken).where(CustomerVerifyToken.signal_id == signal.id)
        )
    ).scalars().all()
    assert len(tokens) == 1
    assert tokens[0].email == "billing@example.com"


@pytest.mark.asyncio
async def test_verify_token_single_use_and_ttl(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    contact = Contact(
        tenant_id=tenant.id,
        channel="email",
        address="owner@example.com",
        display_name="Owner",
    )
    signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        source="widget",
        subject="Verify me",
    )
    session_override.add(contact)
    session_override.add(signal)
    await session_override.commit()

    from app.services.customer_verify import hash_verify_token

    await request_customer_verify(
        session_override, tenant.id, signal_id=signal.id, email="owner@example.com"
    )
    token_row = (
        await session_override.execute(
            select(CustomerVerifyToken).where(CustomerVerifyToken.signal_id == signal.id)
        )
    ).scalar_one()

    # Recover the raw token by writing a known one for the consume path.
    raw = "test-verify-token-raw"
    token_row.token_hash = hash_verify_token(raw)
    session_override.add(token_row)
    await session_override.commit()

    first = await client.post(
        f"/api/customer-verify/{raw}",
        headers={"Accept": "application/json"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["ok"] is True

    second = await client.post(
        f"/api/customer-verify/{raw}",
        headers={"Accept": "application/json"},
    )
    assert second.status_code == 400

    raw_expired = "expired-verify-token"
    expired = CustomerVerifyToken(
        tenant_id=tenant.id,
        signal_id=signal.id,
        email="owner@example.com",
        contact_id=contact.id,
        token_hash=hash_verify_token(raw_expired),
        expires_at=datetime.utcnow() - timedelta(minutes=1),
    )
    session_override.add(expired)
    await session_override.commit()
    stale = await client.post(
        f"/api/customer-verify/{raw_expired}",
        headers={"Accept": "application/json"},
    )
    assert stale.status_code == 400


@pytest.mark.asyncio
async def test_expired_assurance_denies_customer_invoice_read(
    client: AsyncClient, session_override
):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        source="widget",
        subject="Invoices",
        assurance_level="verified",
        assurance_email="billing@example.com",
        assurance_expires_at=datetime.utcnow() - timedelta(minutes=1),
    )
    session_override.add(signal)
    session_override.add(
        ModuleInstall(
            tenant_id=tenant.id,
            module_slug="accounting",
            install_state="installed",
            customer_tools_json='{"list_my_invoices": true}',
        )
    )
    await session_override.commit()

    denied = await execute_tool(
        session_override,
        tenant.id,
        None,
        "accounting_list_my_invoices",
        {},
        signal_id=signal.id,
        trust="external",
    )
    assert denied.get("status") == "needs_verification"

    missing = await execute_tool(
        session_override,
        tenant.id,
        None,
        "accounting_list_my_invoices",
        {},
        signal_id=signal.id,
        trust="external",
    )
    # still expired
    assert missing.get("status") == "needs_verification"


@pytest.mark.asyncio
async def test_internal_module_reads_hidden_from_external():
    spec = get_tool_spec("accounting_list_documents")
    assert spec is not None
    assert spec.audience == "operator"
    assert spec.gated is False

    hidden = filter_tools_for_audience(
        get_tool_definitions(),
        "customer",
        enabled_customer_tools=set(),
    )
    names = {t["name"] for t in hidden}
    assert "accounting_list_documents" not in names
    assert "accounting_search_parties" not in names
    assert "accounting_list_my_invoices" not in names


@pytest.mark.asyncio
async def test_customer_verb_hidden_until_toggle(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        source="widget",
        subject="Invoices",
        assurance_level="verified",
        assurance_email="billing@example.com",
        assurance_expires_at=datetime.utcnow() + timedelta(minutes=30),
    )
    session_override.add(signal)
    await session_override.commit()

    off = await execute_tool(
        session_override,
        tenant.id,
        None,
        "accounting_list_my_invoices",
        {},
        signal_id=signal.id,
        trust="external",
    )
    assert off.get("status") == "denied"
    assert off.get("reason") == "customer_tools_off"

    install = ModuleInstall(
        tenant_id=tenant.id,
        module_slug="accounting",
        install_state="installed",
        customer_tools_json='{"list_my_invoices": true}',
    )
    session_override.add(install)
    await session_override.commit()

    shown = filter_tools_for_audience(
        get_tool_definitions(),
        "customer",
        enabled_customer_tools={"accounting_list_my_invoices"},
    )
    names = {t["name"] for t in shown}
    assert "accounting_list_my_invoices" in names
    assert "accounting_list_documents" not in names

    # Toggle on + valid assurance: hard audience/assurance gates pass.
    allowed = await execute_tool(
        session_override,
        tenant.id,
        None,
        "accounting_list_my_invoices",
        {},
        signal_id=signal.id,
        trust="external",
    )
    assert allowed.get("status") != "denied"
    assert allowed.get("status") != "needs_verification"


@pytest.mark.asyncio
async def test_external_cannot_call_internal_accounting_read(
    client: AsyncClient, session_override
):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    denied = await execute_tool(
        session_override,
        tenant.id,
        None,
        "accounting_list_documents",
        {},
        trust="external",
    )
    assert denied.get("status") == "denied"
    assert denied.get("reason") == "audience"
