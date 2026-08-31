"""Accounting module: registry, capability matrix, router, adapters, and prompts."""

import json
from uuid import UUID, uuid4

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
    filter_tools_for_modules,
    module_for_provider,
    serialize_modules,
    set_module_enabled,
)
from app.services import moneybird
from app.services.integrations_platform import install_mcp


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = Tenant(slug=f"acct-{uuid4().hex[:8]}", name="Accounting Module")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


async def _enable_accounting(session: AsyncSession, tenant: Tenant) -> None:
    """Installed modules need >=1 rostered agent; create one and enable."""
    from app.models.agent import Agent
    from app.services.module_agents import add_module_agent

    agent = Agent(tenant_id=tenant.id, name=f"Boekhouder {uuid4().hex[:6]}", kind="company")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    await add_module_agent(session, tenant.id, "accounting", agent.id, is_default=True)
    await set_module_enabled(session, tenant.id, "accounting", True)


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
    assert modules["accounting"]["setup_path"] == "/modules/accounting"
    assert modules["accounting"]["enabled"] is False
    assert modules["accounting"]["tenant_status"] == "not_installed"
    assert "list_companies" in modules["accounting"]["verbs"]
    assert modules["accounting"]["verb_labels"]
    cards = modules["accounting"]["tool_cards"]
    assert len(cards) == len(modules["accounting"]["verbs"]) + len(
        modules["accounting"]["propose_verbs"]
    )
    verbs_from_cards = [c["verb"] for c in cards if c["kind"] == "read"]
    propose_from_cards = [c["verb"] for c in cards if c["kind"] == "propose"]
    assert verbs_from_cards == modules["accounting"]["verbs"]
    assert propose_from_cards == modules["accounting"]["propose_verbs"]
    assert all(c.get("description") for c in cards)
    assert "decision" not in (modules["accounting"].get("capability_summary") or "").lower()
    assert modules["accounting"]["needs_when"]
    assert modules["banking"]["status"] == "available"
    assert modules["banking"]["provider_slugs"] == ["gocardless_bank"]
    for slug in ("investing", "documents"):
        assert modules[slug]["status"] == "coming_soon"
        assert modules[slug]["tenant_status"] == "coming_soon"
        assert modules[slug]["provider_slugs"] == []
        assert modules[slug]["setup_path"] == f"/modules/{slug}"
        assert modules[slug]["tool_cards"]


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
    assert result["code"] == "module_off"

    await _enable_accounting(session_override, tenant)
    result = await call_accounting_verb(session_override, tenant.id, "list_companies")
    assert result["ok"] is False
    assert result["code"] == "no_connection"


@pytest.mark.asyncio
async def test_king_connection_discovered_and_mocked(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await _enable_accounting(session_override, tenant)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
        use_mock=True,
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
    await _enable_accounting(session_override, tenant)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
        use_mock=True,
    )
    result = await call_accounting_verb(session_override, tenant.id, "list_bank_mutations", {})
    assert result["ok"] is False
    assert result["code"] == "unsupported"
    assert result["capability"] == "bank_mutations.read"
    assert result["hint"]


@pytest.mark.asyncio
async def test_moneybird_connection_mocked_reads(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await _enable_accounting(session_override, tenant)
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
    await _enable_accounting(session_override, tenant)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
        use_mock=True,
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
    await _enable_accounting(session_override, tenant)
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
    await _enable_accounting(session_override, tenant)
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


def test_build_proposal_routes_approve_to_apply_tool():
    proposal = build_proposal(
        "propose_booking",
        {
            "summary": "Boek verkoopfactuur 2026-0042",
            "connection_id": "conn-1",
            "company_id": "adm-1",
            "payload": {
                "journal": "10",
                "date": "2026-08-31",
                "lines": [
                    {"account": "10000", "debit": 100.0},
                    {"account": "8000", "credit": 100.0},
                ],
            },
        },
    )
    assert proposal is not None
    approve = proposal["options"][0]
    assert approve["action_type"] == "accounting_apply_booking"
    # Structured payload is flattened next to the routing ids.
    assert approve["payload"]["journal"] == "10"
    assert approve["payload"]["connection_id"] == "conn-1"
    assert approve["payload"]["company_id"] == "adm-1"

    party = build_proposal("propose_party", {"summary": "New debtor", "payload": {"name": "X"}})
    assert party is not None
    assert party["options"][0]["action_type"] == "accounting_apply_party"

    # No apply path yet for match/send: stays a recorded human decision.
    send = build_proposal("propose_send", {"summary": "Send it"})
    assert send is not None
    assert send["options"][0]["action_type"] == "approve"


# ── writes: kill switch + apply chain ────────────────────────────


@pytest.mark.asyncio
async def test_apply_blocked_by_platform_switch(session_override: AsyncSession, monkeypatch):
    from app.config import get_settings

    tenant = await _tenant(session_override)
    await _enable_accounting(session_override, tenant)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
        use_mock=True,
    )
    monkeypatch.setattr(get_settings(), "module_writes_enabled", "")

    result = await call_accounting_verb(
        session_override, tenant.id, "apply_party", {"name": "Nieuwe Debiteur"}
    )
    assert result["ok"] is False
    assert result["code"] == "writes_disabled"
    assert "MODULE_WRITES_ENABLED" in result["message"]


@pytest.mark.asyncio
async def test_apply_blocked_by_tenant_pref(session_override: AsyncSession, monkeypatch):
    from app.config import get_settings

    tenant = await _tenant(session_override)
    await _enable_accounting(session_override, tenant)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
        use_mock=True,
    )
    monkeypatch.setattr(get_settings(), "module_writes_enabled", "accounting")

    result = await call_accounting_verb(
        session_override, tenant.id, "apply_party", {"name": "Nieuwe Debiteur"}
    )
    assert result["ok"] is False
    assert result["code"] == "writes_disabled"
    assert "Modules > Accounting" in result["message"]


@pytest.mark.asyncio
async def test_apply_runs_when_both_switches_on(session_override: AsyncSession, monkeypatch):
    from app.config import get_settings
    from app.modules.catalog import update_module_prefs

    tenant = await _tenant(session_override)
    await _enable_accounting(session_override, tenant)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
        use_mock=True,
    )
    monkeypatch.setattr(get_settings(), "module_writes_enabled", "accounting")
    await update_module_prefs(
        session_override, tenant.id, "accounting", writes_enabled=True
    )

    # No credentials in dev -> mock write, proving the chain end-to-end.
    result = await call_accounting_verb(
        session_override, tenant.id, "apply_party", {"name": "Nieuwe Debiteur"}
    )
    assert result["ok"] is True
    assert result.get("applied") is True
    assert result.get("mock") is True


@pytest.mark.asyncio
async def test_apply_invalid_payload_rejected(session_override: AsyncSession, monkeypatch):
    from app.config import get_settings
    from app.modules.catalog import update_module_prefs

    tenant = await _tenant(session_override)
    await _enable_accounting(session_override, tenant)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
        use_mock=True,
    )
    monkeypatch.setattr(get_settings(), "module_writes_enabled", "accounting")
    await update_module_prefs(
        session_override, tenant.id, "accounting", writes_enabled=True
    )

    result = await call_accounting_verb(
        session_override, tenant.id, "apply_party", {}
    )
    assert result["ok"] is False
    assert result["code"] == "invalid_payload"


def test_apply_capability_matrix():
    assert vendor_supports("king", "parties.write")
    assert vendor_supports("king", "journal.write")
    assert not vendor_supports("king", "documents.sales.write")
    assert not vendor_supports("moneybird", "parties.write")
    assert not vendor_supports("bjorn_lunden", "journal.write")
    assert capability_for_verb("apply_party") == "parties.write"
    assert capability_for_verb("apply_booking") == "journal.write"


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

    for name in ("accounting_apply_party", "accounting_apply_booking"):
        spec = get_tool_spec(name)
        assert spec is not None, name
        assert spec.mutating is True
        assert spec.gated is True  # direct agent calls escalate to a decision


# ── skill injection + snapshot ───────────────────────────────────


@pytest.mark.asyncio
async def test_module_skill_injected_only_with_connection(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    playbook = await active_module_skill_prompt(session_override, tenant.id)
    assert playbook == ""

    await _enable_accounting(session_override, tenant)
    playbook = await active_module_skill_prompt(session_override, tenant.id)
    assert "on, no package" in playbook
    assert "recommend_module" in playbook
    assert "/modules/accounting" in playbook
    assert "accounting_list_companies" not in playbook

    await _moneybird_connection(session_override, tenant)
    prompt = await active_module_skill_prompt(session_override, tenant.id)
    assert "Accounting module" in prompt
    assert "accounting_list_companies" in prompt
    assert "on, no package" not in prompt


@pytest.mark.asyncio
async def test_snapshot_hides_vendor_tools_for_accounting(session_override: AsyncSession):
    from app.services.tenant_introspection import (
        collect_tenant_snapshot,
        format_tenant_snapshot_prompt,
    )

    tenant = await _tenant(session_override)
    await _enable_accounting(session_override, tenant)
    await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Accountancy",
        use_mock=True,
    )
    await _moneybird_connection(session_override, tenant)

    snapshot = await collect_tenant_snapshot(session_override, tenant.id)
    assert len(snapshot["module_connections"]["accounting"]) == 2
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
    assert "accounting — not installed" in prompt
    assert "/modules/accounting" in prompt
    assert "prepared, not connectable" in prompt


@pytest.mark.asyncio
async def test_list_and_recommend_module_tools(session_override: AsyncSession):
    from app.tools import execute_tool

    tenant = await _tenant(session_override)
    listed = await execute_tool(session_override, tenant.id, None, "list_modules", {})
    slugs = {row["slug"] for row in listed["modules"]}
    assert slugs == {"accounting", "banking", "investing", "documents"}
    accounting = next(row for row in listed["modules"] if row["slug"] == "accounting")
    assert accounting["setup_path"] == "/modules/accounting"
    assert accounting["tenant_status"] == "not_installed"
    assert accounting["enabled"] is False

    coming = await execute_tool(
        session_override,
        tenant.id,
        None,
        "recommend_module",
        {"slug": "investing", "reason": "portfolio tracking"},
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

    from app.models.notification import DecisionRequest

    decision = await session_override.get(DecisionRequest, UUID(str(rec["decision_request_id"])))
    options = json.loads(decision.options_json)
    assert options[0]["action_type"] == "enable_module"
    assert options[0]["payload"]["module"] == "accounting"


def test_module_tools_hidden_until_enabled():
    tools = [
        {"name": "list_modules"},
        {"name": "accounting_list_companies"},
        {"name": "accounting_propose_send"},
        {"name": "create_agent"},
    ]
    hidden = filter_tools_for_modules(tools, set())
    assert [t["name"] for t in hidden] == ["list_modules", "create_agent"]
    shown = filter_tools_for_modules(tools, {"accounting"})
    assert [t["name"] for t in shown] == [
        "list_modules",
        "accounting_list_companies",
        "accounting_propose_send",
        "create_agent",
    ]


def test_module_tools_require_agent_roster():
    from app.services.module_agents import filter_tools_for_agent_modules

    tools = [
        {"name": "list_modules"},
        {"name": "accounting_list_companies"},
        {"name": "create_agent"},
    ]
    # Module installed but agent not on roster → hide accounting tools.
    no_roster = filter_tools_for_agent_modules(
        tools, enabled_slugs={"accounting"}, rostered_slugs=set()
    )
    assert [t["name"] for t in no_roster] == ["list_modules", "create_agent"]
    on_roster = filter_tools_for_agent_modules(
        tools, enabled_slugs={"accounting"}, rostered_slugs={"accounting"}
    )
    assert [t["name"] for t in on_roster] == [
        "list_modules",
        "accounting_list_companies",
        "create_agent",
    ]


def test_read_only_roster_hides_propose_and_apply_tools():
    from app.services.module_agents import filter_tools_for_agent_modules

    tools = [
        {"name": "accounting_list_companies"},
        {"name": "accounting_propose_booking"},
        {"name": "accounting_apply_booking"},
        {"name": "create_agent"},
    ]
    read_only = filter_tools_for_agent_modules(
        tools,
        enabled_slugs={"accounting"},
        rostered_slugs={"accounting"},
        writable_slugs=set(),
    )
    assert [t["name"] for t in read_only] == [
        "accounting_list_companies",
        "create_agent",
    ]
    writable = filter_tools_for_agent_modules(
        tools,
        enabled_slugs={"accounting"},
        rostered_slugs={"accounting"},
        writable_slugs={"accounting"},
    )
    assert [t["name"] for t in writable] == [
        "accounting_list_companies",
        "accounting_propose_booking",
        "accounting_apply_booking",
        "create_agent",
    ]


# ── per-agent scope enforcement ──────────────────────────────────


async def _rostered_agent(session: AsyncSession, tenant: Tenant, **access):
    from app.models.agent import Agent
    from app.services.module_agents import add_module_agent, update_module_agent_access

    agent = Agent(tenant_id=tenant.id, name=f"Scoped {uuid4().hex[:6]}", kind="company")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    await add_module_agent(session, tenant.id, "accounting", agent.id)
    if access:
        await update_module_agent_access(
            session, tenant.id, "accounting", agent.id, **access
        )
    return agent


@pytest.mark.asyncio
async def test_agent_not_on_roster_is_forbidden(session_override: AsyncSession):
    from app.models.agent import Agent

    tenant = await _tenant(session_override)
    await _enable_accounting(session_override, tenant)
    await _moneybird_connection(session_override, tenant)
    outsider = Agent(tenant_id=tenant.id, name="Outsider", kind="company")
    session_override.add(outsider)
    await session_override.commit()
    await session_override.refresh(outsider)

    result = await call_accounting_verb(
        session_override, tenant.id, "list_companies", agent_id=outsider.id
    )
    assert result["ok"] is False
    assert result["code"] == "agent_forbidden"


@pytest.mark.asyncio
async def test_agent_company_scope_enforced(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await _enable_accounting(session_override, tenant)
    await _moneybird_connection(session_override, tenant)
    agent = await _rostered_agent(
        session_override, tenant, company_ids=["adm-demo-2"]
    )

    listed = await call_accounting_verb(
        session_override, tenant.id, "list_companies", agent_id=agent.id
    )
    assert listed["ok"] is True
    assert [c["id"] for c in listed["companies"]] == ["adm-demo-2"]

    denied = await call_accounting_verb(
        session_override,
        tenant.id,
        "search_parties",
        {"company_id": "adm-demo-1", "query": "x"},
        agent_id=agent.id,
    )
    assert denied["ok"] is False
    assert denied["code"] == "company_forbidden"

    allowed = await call_accounting_verb(
        session_override,
        tenant.id,
        "search_parties",
        {"company_id": "adm-demo-2", "query": "x"},
        agent_id=agent.id,
    )
    assert allowed["ok"] is True


@pytest.mark.asyncio
async def test_read_only_agent_cannot_apply(session_override: AsyncSession, monkeypatch):
    from app.config import get_settings
    from app.modules.catalog import update_module_prefs

    tenant = await _tenant(session_override)
    await _enable_accounting(session_override, tenant)
    await _moneybird_connection(session_override, tenant)
    monkeypatch.setattr(get_settings(), "module_writes_enabled", "accounting")
    await update_module_prefs(
        session_override, tenant.id, "accounting", writes_enabled=True
    )
    agent = await _rostered_agent(session_override, tenant)

    result = await call_accounting_verb(
        session_override,
        tenant.id,
        "apply_party",
        {"name": "Test"},
        agent_id=agent.id,
    )
    assert result["ok"] is False
    assert result["code"] == "write_forbidden"


@pytest.mark.asyncio
async def test_user_access_pref_gates_members_not_admins(session_override: AsyncSession):
    from app.modules.catalog import update_module_prefs, user_can_access_module

    tenant = await _tenant(session_override)
    allowed_user = uuid4()
    other_user = uuid4()

    # No pref set: every member may use the module.
    assert await user_can_access_module(
        session_override, tenant.id, "accounting", user_id=other_user, role="member"
    )

    await update_module_prefs(
        session_override,
        tenant.id,
        "accounting",
        user_access={"mode": "selected", "user_ids": [str(allowed_user)]},
    )
    assert await user_can_access_module(
        session_override, tenant.id, "accounting", user_id=allowed_user, role="member"
    )
    assert not await user_can_access_module(
        session_override, tenant.id, "accounting", user_id=other_user, role="member"
    )
    # Owners and admins always keep access.
    assert await user_can_access_module(
        session_override, tenant.id, "accounting", user_id=other_user, role="owner"
    )
    assert await user_can_access_module(
        session_override, tenant.id, "accounting", user_id=other_user, role="admin"
    )

    # Back to all_members reopens the module.
    await update_module_prefs(
        session_override,
        tenant.id,
        "accounting",
        user_access={"mode": "all_members"},
    )
    assert await user_can_access_module(
        session_override, tenant.id, "accounting", user_id=other_user, role="member"
    )


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
