"""Accounting module: registry, capability matrix, router, adapters, and prompts."""

import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.integration import IntegrationConnection
from app.modules.accounting.capabilities import capability_for_verb, vendor_supports
from app.modules.accounting.router import (
    build_proposal,
    call_accounting_verb,
    list_accounting_connections,
)
from app.modules.catalog import (
    MODULE_BY_SLUG,
    active_module_skill_prompt,
    module_for_provider,
    serialize_modules,
)
from app.services import moneybird
from app.services.integrations_platform import install_mcp


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = Tenant(slug=f"acct-{uuid4().hex[:8]}", name="Accounting Module")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


async def _moneybird_connection(
    session: AsyncSession, tenant: Tenant, *, token: str = ""
) -> IntegrationConnection:
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="moneybird",
        display_name="Moneybird",
        status="active",
        credentials_json=json.dumps({"access_token": token} if token else {}),
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


# ── module catalog ───────────────────────────────────────────────


def test_module_catalog_has_prepared_modules():
    modules = {m["slug"]: m for m in serialize_modules()}
    assert modules["accounting"]["status"] == "available"
    assert modules["accounting"]["setup_path"] == "/settings/modules/accounting"
    assert modules["accounting"]["tenant_status"] == "available"
    assert "list_companies" in modules["accounting"]["verbs"]
    assert modules["accounting"]["verb_labels"]
    assert modules["accounting"]["needs_when"]
    for slug in ("banking", "investing", "documents"):
        assert modules[slug]["status"] == "coming_soon"
        assert modules[slug]["tenant_status"] == "coming_soon"
        assert modules[slug]["provider_slugs"] == []
        assert modules[slug]["setup_path"] == f"/settings/modules/{slug}"


def test_provider_module_lookup():
    assert module_for_provider("moneybird") == "accounting"
    assert module_for_provider("king_accountancy") == "accounting"
    assert module_for_provider("bjorn_lunden_mcp") == "accounting"
    assert module_for_provider("exact_online") == "accounting"
    assert module_for_provider("gmail") is None


# ── capability matrix ────────────────────────────────────────────


def test_capability_matrix_king_limits():
    assert vendor_supports("king", "parties.customers.read")
    assert not vendor_supports("king", "documents.sales.read")
    assert not vendor_supports("king", "bank_mutations.read")
    assert vendor_supports("moneybird", "bank_mutations.read")
    assert vendor_supports("bjorn_lunden", "documents.sales.read")


def test_verbs_map_to_capabilities():
    assert capability_for_verb("list_documents") == "documents.sales.read"
    assert capability_for_verb("list_bank_mutations") == "bank_mutations.read"
    assert capability_for_verb("summarize") == "companies.read"


# ── router: discovery + routing ──────────────────────────────────


@pytest.mark.asyncio
async def test_no_connection_returns_structured_error(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    result = await call_accounting_verb(session_override, tenant.id, "list_companies")
    assert result["ok"] is False
    assert result["code"] == "no_connection"


@pytest.mark.asyncio
async def test_king_connection_discovered_and_mocked(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
    )
    connections = await list_accounting_connections(session_override, tenant.id)
    assert [c.vendor for c in connections] == ["king"]
    assert connections[0].has_credentials is False

    result = await call_accounting_verb(session_override, tenant.id, "list_companies")
    assert result["ok"] is True
    assert result["companies"]
    assert result["connections"][0]["vendor"] == "king"


@pytest.mark.asyncio
async def test_capability_miss_is_unsupported_even_with_mocks(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
    )
    result = await call_accounting_verb(session_override, tenant.id, "list_bank_mutations", {})
    assert result["ok"] is False
    assert result["code"] == "unsupported"
    assert result["capability"] == "bank_mutations.read"
    assert result["hint"]


@pytest.mark.asyncio
async def test_moneybird_connection_mocked_reads(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await _moneybird_connection(session_override, tenant)
    connections = await list_accounting_connections(session_override, tenant.id)
    assert [c.vendor for c in connections] == ["moneybird"]

    result = await call_accounting_verb(
        session_override, tenant.id, "list_bank_mutations", {"company_id": "adm-demo-1"}
    )
    assert result["ok"] is True
    assert result["bank_mutations"]
    assert result.get("mock") is True


@pytest.mark.asyncio
async def test_multiple_connections_require_connection_id(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
    )
    await _moneybird_connection(session_override, tenant)

    listing = await call_accounting_verb(session_override, tenant.id, "list_companies")
    assert listing["ok"] is True
    assert len(listing["connections"]) == 2

    scoped = await call_accounting_verb(
        session_override, tenant.id, "search_parties", {"query": "bakker"}
    )
    assert scoped["ok"] is False
    assert scoped["code"] == "ambiguous_connection"

    moneybird_id = next(
        c["connection_id"] for c in listing["connections"] if c["vendor"] == "moneybird"
    )
    scoped = await call_accounting_verb(
        session_override,
        tenant.id,
        "search_parties",
        {"query": "bakker", "connection_id": moneybird_id, "company_id": "adm-demo-1"},
    )
    assert scoped["ok"] is True
    assert scoped["parties"]


@pytest.mark.asyncio
async def test_summarize_composite(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await _moneybird_connection(session_override, tenant)
    result = await call_accounting_verb(
        session_override, tenant.id, "summarize", {"company_id": "adm-demo-1"}
    )
    assert result["ok"] is True
    assert result["company_id"] == "adm-demo-1"
    assert "outstanding" in result
    assert "documents" in result
    # Moneybird has no raw ledger read; the section must be omitted, not error.
    assert "ledger" not in result


# ── moneybird adapter against HTTP fixtures ──────────────────────


def _mb_transport() -> httpx.MockTransport:
    def respond(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/administrations.json"):
            return httpx.Response(
                200, json=[{"id": 111, "name": "Demo BV", "currency": "EUR", "country": "NL"}]
            )
        if path.endswith("/sales_invoices.json"):
            return httpx.Response(
                200,
                json=[
                    {
                        "id": 900,
                        "invoice_id": "2026-0042",
                        "state": "late",
                        "contact_id": 55,
                        "contact": {"company_name": "Bakker BV"},
                        "total_price_incl_tax": "1210.0",
                        "total_unpaid": "1210.0",
                        "currency": "EUR",
                        "invoice_date": "2026-07-01",
                        "due_date": "2026-07-15",
                        "details": [
                            {"description": "Website onderhoud", "price": "1000.0"},
                        ],
                    }
                ],
            )
        if path.endswith("/contacts.json"):
            return httpx.Response(
                200,
                json=[
                    {
                        "id": 55,
                        "company_name": "Bakker BV",
                        "email": "administratie@bakker.nl",
                        "customer_id": "55",
                        "city": "Utrecht",
                    }
                ],
            )
        return httpx.Response(200, json=[])

    return httpx.MockTransport(respond)


@pytest.mark.asyncio
async def test_moneybird_adapter_normalizes_live_responses(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await _moneybird_connection(session_override, tenant, token="live-token")

    moneybird._transport = _mb_transport()
    try:
        companies = await call_accounting_verb(session_override, tenant.id, "list_companies")
        assert companies["ok"] is True
        assert companies["companies"][0]["name"] == "Demo BV"
        assert companies["companies"][0]["vendor"] == "moneybird"

        docs = await call_accounting_verb(
            session_override, tenant.id, "list_documents", {"company_id": "111"}
        )
        assert docs["ok"] is True
        doc = docs["documents"][0]
        assert doc["kind"] == "sales_invoice"
        assert doc["status"] == "overdue"
        assert doc["number"] == "2026-0042"
        assert doc["party_name"] == "Bakker BV"
        assert doc["total"] == 1210.0

        parties = await call_accounting_verb(
            session_override, tenant.id, "search_parties", {"company_id": "111", "query": "bakker"}
        )
        assert parties["ok"] is True
        assert parties["parties"][0]["name"] == "Bakker BV"
        assert parties["parties"][0]["role"] == "customer"
    finally:
        moneybird._transport = None


# ── proposals ────────────────────────────────────────────────────


def test_build_proposal_shapes_decision_payload():
    proposal = build_proposal(
        "propose_send",
        {"summary": "Send reminder for invoice 2026-0042", "document_id": "900"},
    )
    assert proposal is not None
    assert proposal["title"] == "Send accounting document"
    assert proposal["summary"] == "Send reminder for invoice 2026-0042"
    option_ids = [o["id"] for o in proposal["options"]]
    assert option_ids == ["approve", "reject"]
    approve = proposal["options"][0]
    assert approve["action_type"] == "approve"
    assert approve["payload"]["document_id"] == "900"

    assert build_proposal("propose_nonsense", {}) is None


# ── tools registered ─────────────────────────────────────────────


def test_accounting_tools_registered_and_ungated():
    from app.tools.registry import get_tool_spec

    reads = [
        "accounting_list_companies",
        "accounting_search_parties",
        "accounting_list_documents",
        "accounting_list_outstanding",
        "accounting_list_bank_mutations",
        "accounting_summarize",
    ]
    for name in reads:
        spec = get_tool_spec(name)
        assert spec is not None, name
        assert spec.category == "integrations"
        assert spec.mutating is False
        assert spec.gated is False

    for name in ("accounting_propose_document", "accounting_propose_send"):
        spec = get_tool_spec(name)
        assert spec is not None, name
        assert spec.gated is False  # the tool itself asks the human


# ── skill injection + snapshot ───────────────────────────────────


@pytest.mark.asyncio
async def test_module_skill_injected_only_with_connection(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    playbook = await active_module_skill_prompt(session_override, tenant.id)
    assert "not connected" in playbook
    assert "recommend_module" in playbook
    assert "/settings/modules/accounting" in playbook
    assert "accounting_list_companies" not in playbook

    await _moneybird_connection(session_override, tenant)
    prompt = await active_module_skill_prompt(session_override, tenant.id)
    assert "Accounting module" in prompt
    assert "accounting_list_companies" in prompt
    assert "not connected" not in prompt


@pytest.mark.asyncio
async def test_snapshot_hides_vendor_tools_for_accounting(session_override: AsyncSession):
    from app.services.tenant_introspection import (
        collect_tenant_snapshot,
        format_tenant_snapshot_prompt,
    )

    tenant = await _tenant(session_override)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
    )
    await _moneybird_connection(session_override, tenant)

    snapshot = await collect_tenant_snapshot(session_override, tenant.id)
    assert len(snapshot["accounting_connections"]) == 2
    assert all(
        not m["server_url"].startswith("native://king-accountancy")
        for m in snapshot["mcp_servers"]
    )

    prompt = format_tenant_snapshot_prompt(snapshot)
    assert "accounting_list_companies" in prompt
    assert "Modules:" in prompt
    assert "accounting — connected" in prompt
    # Vendor tool names must not leak into the prompt.
    assert "search_customers" not in prompt
    assert "GetAdmInfo" not in prompt


@pytest.mark.asyncio
async def test_snapshot_lists_unconnected_modules(session_override: AsyncSession):
    from app.services.tenant_introspection import (
        collect_tenant_snapshot,
        format_tenant_snapshot_prompt,
    )

    tenant = await _tenant(session_override)
    snapshot = await collect_tenant_snapshot(session_override, tenant.id)
    assert snapshot["modules"]
    prompt = format_tenant_snapshot_prompt(snapshot)
    assert "Modules:" in prompt
    assert "accounting — not connected" in prompt
    assert "/settings/modules/accounting" in prompt
    assert "prepared, not connectable" in prompt


@pytest.mark.asyncio
async def test_list_and_recommend_module_tools(session_override: AsyncSession):
    from app.tools import execute_tool

    tenant = await _tenant(session_override)
    listed = await execute_tool(session_override, tenant.id, None, "list_modules", {})
    slugs = {row["slug"] for row in listed["modules"]}
    assert slugs == {"accounting", "banking", "investing", "documents"}
    accounting = next(row for row in listed["modules"] if row["slug"] == "accounting")
    assert accounting["setup_path"] == "/settings/modules/accounting"
    assert accounting["tenant_status"] == "available"

    coming = await execute_tool(
        session_override,
        tenant.id,
        None,
        "recommend_module",
        {"slug": "banking", "reason": "cash flow"},
    )
    assert coming.get("code") == "coming_soon"
    assert "decision_request_id" not in coming

    rec = await execute_tool(
        session_override,
        tenant.id,
        None,
        "recommend_module",
        {"slug": "accounting", "reason": "VAT returns"},
    )
    assert rec.get("status") == "awaiting_human"
    assert rec.get("decision_request_id")


def test_modules_listed_in_marketplace_payload():
    from app.services.integrations_catalog import PROVIDER_BY_SLUG

    assert PROVIDER_BY_SLUG["moneybird"]["module"] == "accounting"
    assert PROVIDER_BY_SLUG["exact_online"]["status"] == "coming_soon"
    assert PROVIDER_BY_SLUG["snelstart"]["status"] == "coming_soon"
    assert list(MODULE_BY_SLUG["accounting"].provider_slugs) == [
        "king_accountancy",
        "bjorn_lunden_mcp",
        "moneybird",
    ]
