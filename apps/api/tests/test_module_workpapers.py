"""Workpapers for Accounting, Banking, Documents, and Investing."""

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.modules.accounting.router import call_verb as accounting_call
from app.modules.accounting.workpapers import invoice_check, payment_terms, vat_rates
from app.modules.banking.router import call_verb as banking_call
from app.modules.banking.workpapers import iban_check, liquidity
from app.modules.catalog import active_module_skill_prompt, set_module_enabled
from app.modules.documents.router import call_verb as documents_call
from app.modules.documents.workpapers import classify, retention
from app.modules.investing.router import call_verb as investing_call
from app.modules.investing.workpapers import advice_boundary, concentration, order_ticket


def test_vat_is_computed_only_when_the_rate_is_named():
    open_table = vat_rates({})
    assert open_table["computed"] is None
    assert "does not choose" in open_table["note"].lower() or "does not choose the table" in open_table["note"]

    row = vat_rates({"rate": "21", "net_amount": "100"})
    assert row["computed"]["vat_amount"] == "21.00"
    assert row["computed"]["gross_amount"] == "121.00"

    exempt = vat_rates({"rate": "exempt", "net_amount": "50"})
    assert exempt["computed"]["vat_amount"] == "0.00"
    assert "not deductible" in exempt["note"]


def test_simplified_invoice_stops_at_100_and_special_supplies():
    simple = invoice_check({"amount_incl": "80", "present": ["issue_date"]})
    assert simple["regime"] == "simplified"
    assert "seller_name_address" in simple["missing"]
    assert simple["complete"] is False

    blocked = invoice_check({"amount_incl": "80", "intra_community": True, "present": ["issue_date"]})
    assert blocked["regime"] == "full"
    assert "seller_vat_id" in blocked["missing"]


def test_payment_term_depends_on_who_pays():
    business = payment_terms({"party": "business", "agreed_days": 90})
    assert business["default_days"] == 30
    assert business["maximum_days"] == 60
    assert business["agreed_allowed"] is False
    assert business["compensation_eur"] == "40"

    large = payment_terms({"party": "large_to_sme", "agreed_days": 45})
    assert large["maximum_days"] == 30
    assert large["agreed_allowed"] is False

    consumer = payment_terms({"party": "consumer", "agreed_days": 14})
    assert consumer["default_days"] is None
    assert consumer["compensation_eur"] is None


def test_iban_check_accepts_the_standard_dutch_example():
    row = iban_check({"iban": "NL91 ABNA 0417 1643 00"})
    assert row["valid"] is True
    assert row["country"] == "NL"
    assert row["bank_name"] is None

    bad = iban_check({"iban": "NL00ABNA0417164300"})
    assert bad["valid"] is False


def test_liquidity_does_not_convert_currencies():
    row = liquidity({"balances": [{"amount": "10", "currency": "EUR"}, {"amount": "5", "currency": "USD"}]})
    assert row["totals"] == {"EUR": "10.00", "USD": "5.00"}
    assert row["converted"] is False
    empty = liquidity({})
    assert empty["totals"] == {}


def test_retention_and_owner():
    invoice = retention({"kind": "invoice"})
    assert invoice["years"] == 7
    property_file = retention({"kind": "invoice", "immovable_property": True})
    assert property_file["years"] == 10
    owner = classify({"kind": "annual_accounts"})
    assert "Accounto" in owner["owner"]


def test_advice_boundary_refuses_a_personal_recommendation():
    refused = advice_boundary({"kind": "recommendation", "instrument": "ASML"})
    assert refused["offered"] is False
    information = advice_boundary({"kind": "information"})
    assert information["offered"] is True
    ticket = order_ticket({"instrument": "ASML", "side": "buy", "quantity": 1, "order_type": "market"})
    assert ticket["ready_to_propose"] is False
    assert "operator_chose" in ticket["missing"]
    weights = concentration({"positions": [{"instrument": "ASML", "value": "75"}, {"instrument": "cash", "value": "25"}]})
    assert weights["positions"][0]["weight"] == "75.00"
    assert weights["house_limit"] is None


async def _tenant(session: AsyncSession, prefix: str) -> Tenant:
    tenant = Tenant(slug=f"{prefix}-{uuid4().hex[:8]}", name=prefix)
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


@pytest.mark.asyncio
async def test_accounting_workpapers_do_not_need_a_package(session_override: AsyncSession):
    tenant = await _tenant(session_override, "boek")
    blocked = await accounting_call(session_override, tenant.id, "vat_rates", {"rate": "9", "net_amount": "100"})
    assert blocked["code"] == "module_off"
    await set_module_enabled(session_override, tenant.id, "accounting", True)
    opened = await accounting_call(session_override, tenant.id, "vat_rates", {"rate": "9", "net_amount": "100"})
    assert opened["ok"] is True
    assert opened["computed"]["vat_amount"] == "9.00"


@pytest.mark.asyncio
async def test_banking_workpapers_do_not_need_a_bank(session_override: AsyncSession):
    tenant = await _tenant(session_override, "fin")
    await set_module_enabled(session_override, tenant.id, "banking", True)
    opened = await banking_call(session_override, tenant.id, "iban_check", {"iban": "NL91ABNA0417164300"})
    assert opened["ok"] is True
    assert opened["valid"] is True
    quotes = await banking_call(session_override, tenant.id, "propose_payment", {})
    assert quotes["ok"] is False


@pytest.mark.asyncio
async def test_documents_workpapers_do_not_need_drive(session_override: AsyncSession):
    tenant = await _tenant(session_override, "doc")
    await set_module_enabled(session_override, tenant.id, "documents", True)
    opened = await documents_call(session_override, tenant.id, "retention", {"kind": "invoice"})
    assert opened["ok"] is True
    assert opened["years"] == 7


@pytest.mark.asyncio
async def test_investing_refuses_advice_and_loads_its_skill(session_override: AsyncSession):
    tenant = await _tenant(session_override, "inv")
    await set_module_enabled(session_override, tenant.id, "investing", True)
    refused = await investing_call(
        session_override,
        tenant.id,
        "advice_boundary",
        {"kind": "recommendation", "instrument": "ASML", "asks_whether_it_fits": True},
    )
    assert refused["offered"] is False
    missing = await investing_call(session_override, tenant.id, "get_quotes", {"symbols": ["ASML"]})
    assert missing["code"] == "no_connection"
    skill = await active_module_skill_prompt(session_override, tenant.id)
    assert "does not" in skill.lower() or "do not invent" in skill.lower()
    assert "coming soon" not in skill.lower()
