"""Flow capabilities narrow the means (module tools, MCP, connections) on that flow's conversations."""

import json

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection
from app.models.orchestra import Workstream
from app.models.signal import SignalTag
from app.services.connection_scope import usable_connection_ids
from app.services.workstreams import flow_means
from app.tools.executor import _execute_tool
from tests.org_tree import build_org, conversation


async def _conn(session, tenant_id, name):
    conn = IntegrationConnection(
        tenant_id=tenant_id, provider="moneybird", display_name=name, status="active",
        credentials_json='{"access_token":"tok"}',
    )
    session.add(conn)
    await session.flush()
    return conn


async def _flow_conversation(session, org, capabilities):
    flow = Workstream(tenant_id=org.tenant_id, name="Invoices", capabilities_json=json.dumps(capabilities))
    session.add(flow)
    await session.flush()
    tag = SignalTag(tenant_id=org.tenant_id, name="invoice", workstream_id=flow.id)
    session.add(tag)
    await session.flush()
    signal = await conversation(session, org, org.support, holder=org.sam)
    signal.ticket_tag_id = tag.id
    await session.commit()
    return signal


@pytest.mark.asyncio
async def test_capabilities_narrow_module_tools(client, session_override: AsyncSession):
    org = await build_org(session_override)
    signal = await _flow_conversation(session_override, org, ["banking_get_balance", "send_reply"])

    means = await flow_means(session_override, signal)
    assert means is not None and means.tools == frozenset({"banking_get_balance"})

    result = await _execute_tool(
        session_override, org.tenant_id, None, "accounting_list_companies", {},
        signal_id=signal.id, agent=org.sam, trust="internal",
    )
    assert result.get("reason") == "flow_capabilities"
    assert "Invoices" in result["error"]


@pytest.mark.asyncio
async def test_capabilities_narrow_connections(client, session_override: AsyncSession):
    org = await build_org(session_override)
    king = await _conn(session_override, org.tenant_id, "King")
    other = await _conn(session_override, org.tenant_id, "Other")
    signal = await _flow_conversation(session_override, org, [f"connection:{king.id}"])

    usable, denied = await usable_connection_ids(
        session_override, org.tenant_id, [king.id, other.id], agent_id=org.sam.id, project_id=None, signal=signal
    )
    assert usable == {str(king.id)}
    assert "Invoices" in denied[str(other.id)]


@pytest.mark.asyncio
async def test_empty_capabilities_keep_everything(client, session_override: AsyncSession):
    org = await build_org(session_override)
    signal = await _flow_conversation(session_override, org, ["send_reply"])
    assert await flow_means(session_override, signal) is None
