"""Banking module: proof the generic module backbone works without shared-code edits.

The banking provider package (app/modules/banking) plus its catalog spec is
the entire module: tools auto-register from the spec, verbs dispatch through
call_module_verb, and the module/roster gates come from the shared contract.
"""

import json
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.integration import IntegrationConnection
from app.modules.catalog import set_module_enabled
from app.modules.dispatch import build_module_proposal, call_module_verb
from app.tools.registry import get_tool_spec


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = Tenant(slug=f"bank-{uuid4().hex[:8]}", name="Banking Module")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


async def _enable_banking(session: AsyncSession, tenant: Tenant):
    from app.models.agent import Agent
    from app.services.module_agents import add_module_agent

    agent = Agent(tenant_id=tenant.id, name=f"Bankier {uuid4().hex[:6]}", kind="company")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    await add_module_agent(session, tenant.id, "banking", agent.id, is_default=True)
    await set_module_enabled(session, tenant.id, "banking", True)
    return agent


async def _bank_connection(session: AsyncSession, tenant: Tenant) -> IntegrationConnection:
    from app.services.module_attach import attach_connection_to_module

    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="gocardless_bank",
        display_name="GoCardless",
        status="active",
        credentials_json=json.dumps({}),
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    await attach_connection_to_module(session, tenant.id, conn.id, "banking")
    return conn


def test_banking_tools_auto_registered():
    for name in (
        "banking_list_accounts",
        "banking_get_balance",
        "banking_list_transactions",
        "banking_propose_payment",
    ):
        spec = get_tool_spec(name)
        assert spec is not None, name
    assert get_tool_spec("banking_list_accounts").gated is False
    assert get_tool_spec("banking_list_accounts").mutating is False
    # Propose tools never write; they land as decisions.
    assert get_tool_spec("banking_propose_payment").gated is False


@pytest.mark.asyncio
async def test_banking_module_gates(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    result = await call_module_verb(session_override, tenant.id, "banking", "list_accounts")
    assert result["ok"] is False
    assert result["code"] == "module_off"

    await _enable_banking(session_override, tenant)
    result = await call_module_verb(session_override, tenant.id, "banking", "list_accounts")
    assert result["ok"] is False
    assert result["code"] == "no_connection"


@pytest.mark.asyncio
async def test_banking_roster_enforced(session_override: AsyncSession):
    from app.models.agent import Agent

    tenant = await _tenant(session_override)
    await _enable_banking(session_override, tenant)
    await _bank_connection(session_override, tenant)

    outsider = Agent(tenant_id=tenant.id, name="Outsider", kind="company")
    session_override.add(outsider)
    await session_override.commit()
    await session_override.refresh(outsider)

    result = await call_module_verb(
        session_override, tenant.id, "banking", "list_accounts", agent_id=outsider.id
    )
    assert result["ok"] is False
    assert result["code"] == "agent_forbidden"


@pytest.mark.asyncio
async def test_banking_mocked_reads(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    agent = await _enable_banking(session_override, tenant)
    conn = await _bank_connection(session_override, tenant)

    accounts = await call_module_verb(
        session_override, tenant.id, "banking", "list_accounts", agent_id=agent.id
    )
    assert accounts["ok"] is True
    assert accounts["mock"] is True
    assert accounts["accounts"][0]["connection_id"] == str(conn.id)

    balance = await call_module_verb(
        session_override,
        tenant.id,
        "banking",
        "get_balance",
        {"account_id": "acc-demo-2"},
        agent_id=agent.id,
    )
    assert balance["ok"] is True
    assert balance["balance"]["account_id"] == "acc-demo-2"

    txs = await call_module_verb(
        session_override,
        tenant.id,
        "banking",
        "list_transactions",
        {"account_id": "acc-demo-1"},
        agent_id=agent.id,
    )
    assert txs["ok"] is True
    assert all(t["account_id"] == "acc-demo-1" for t in txs["transactions"])


@pytest.mark.asyncio
async def test_banking_writes_never_execute(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    agent = await _enable_banking(session_override, tenant)
    await _bank_connection(session_override, tenant)

    result = await call_module_verb(
        session_override, tenant.id, "banking", "apply_payment", agent_id=agent.id
    )
    assert result["ok"] is False
    assert result["code"] == "unsupported"


def test_banking_generic_proposal_card():
    proposal = build_module_proposal(
        "banking",
        "propose_payment",
        {"summary": "Pay invoice 2026-118", "payload": {"amount": 1250.0}},
    )
    assert proposal is not None
    assert proposal["summary"] == "Pay invoice 2026-118"
    option_ids = [o["id"] for o in proposal["options"]]
    assert option_ids == ["approve", "reject"]
    assert proposal["options"][0]["payload"]["amount"] == 1250.0
