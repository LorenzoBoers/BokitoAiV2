"""Why panel: one server-built line per reason, each with the page that changes it."""

import json
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.channel import ChannelAccount, Company, Contact
from app.models.orchestra import Workstream
from app.models.project import Project, ProjectTagLink
from app.models.signal import CompanyTagLink, ContactTagLink, Signal, SignalMessage, SignalTag
from app.services.agent.turn_persist import knowledge_refs
from app.services.thread_why import explain_thread


async def _tenant(session: AsyncSession, default: str = "autonomous") -> Tenant:
    tenant = Tenant(
        slug=f"why-{uuid4().hex[:6]}",
        name="Acme",
        settings_json=json.dumps({"ai_handling": {"default": {"mode": default}, "ceiling": "autonomous"}}),
    )
    session.add(tenant)
    await session.commit()
    return tenant


async def _account(session: AsyncSession, tenant: Tenant, **ai_config) -> ChannelAccount:
    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        address=f"help-{uuid4().hex[:4]}@acme.test",
        provider="gmail",
        settings_json=json.dumps({"ai_config": ai_config}),
    )
    session.add(account)
    await session.flush()
    return account


def _kinds(body: dict) -> list[str]:
    return [line["kind"] for line in body["lines"]]


def _line(body: dict, kind: str) -> dict:
    return next(line for line in body["lines"] if line["kind"] == kind)


def test_knowledge_refs_keep_unique_docs():
    doc = str(uuid4())
    hits = [{"doc_id": doc, "title": "Prices"}, {"doc_id": doc, "title": "Prices"}, {"doc_id": "x"}, {}]
    assert knowledge_refs(hits) == [{"doc_id": doc, "title": "Prices"}]


@pytest.mark.asyncio
async def test_channel_source_agent_cap_and_knowledge(session_override: AsyncSession):
    tenant = await _tenant(session_override, default="assisted")
    account = await _account(session_override, tenant, ai_handling={"mode": "autonomous"})
    agent = Agent(tenant_id=tenant.id, name="Desk", autonomy_level="manual")
    session_override.add(agent)
    signal = Signal(tenant_id=tenant.id, channel="email", channel_account_id=account.id, status="open")
    session_override.add(signal)
    await session_override.flush()
    doc = str(uuid4())
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            direction="outbound",
            role="assistant",
            author_agent_id=agent.id,
            content="Hello",
            metadata_json=json.dumps({"knowledge_refs": [{"doc_id": doc, "title": "Prices"}]}),
        )
    )
    await session_override.commit()

    body = await explain_thread(session_override, tenant, signal.id)
    assert body["agent"] == {"id": str(agent.id), "name": "Desk", "via": "reply"}
    assert _kinds(body) == ["agent_reply", "handling_channel", "cap_agent", "knowledge_doc"]
    assert _line(body, "handling_channel")["params"]["mode"] == "autonomous"
    assert _line(body, "cap_agent")["params"] == {"mode": "manual", "agent": "Desk", "flow": ""}
    assert _line(body, "cap_agent")["href"] == f"/agents/{agent.id}"
    assert _line(body, "knowledge_doc") == {
        "kind": "knowledge_doc",
        "params": {"title": "Prices"},
        "href": f"/knowledge/{doc}",
    }
    assert [layer["source"] for layer in body["ai_handling"]["layers"]] == ["workspace", "channel", "conversation"]


@pytest.mark.asyncio
async def test_conversation_source_and_breaker(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    account = await _account(session_override, tenant, breaker_tripped_at="2026-10-20T10:00:00")
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        channel_account_id=account.id,
        status="open",
        ai_handling="autonomous",
        ai_handling_reason="operator",
    )
    session_override.add(signal)
    await session_override.commit()

    body = await explain_thread(session_override, tenant, signal.id)
    assert body["source"] == "conversation"
    assert _kinds(body) == ["agent_none", "handling_conversation", "cap_breaker"]
    assert body["knowledge"] == []
    assert _line(body, "cap_breaker")["params"]["mode"] == "assisted"


@pytest.mark.asyncio
async def test_workspace_source_without_caps(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    signal = Signal(tenant_id=tenant.id, channel="email", status="open")
    session_override.add(signal)
    await session_override.commit()

    body = await explain_thread(session_override, tenant, signal.id)
    assert _kinds(body) == ["agent_none", "handling_workspace"]
    assert _line(body, "handling_workspace")["href"] == "/settings/govern?tab=policy"


@pytest.mark.asyncio
async def test_flow_and_folder_via_contact_label(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    flow = Workstream(tenant_id=tenant.id, name="Complaints", always_review=True)
    session_override.add(flow)
    await session_override.flush()
    action = SignalTag(tenant_id=tenant.id, name="complaint", workstream_id=flow.id)
    vip = SignalTag(tenant_id=tenant.id, name="vip")
    contact = Contact(tenant_id=tenant.id, address="vip@client.test", display_name="VIP")
    project = Project(tenant_id=tenant.id, name="Key accounts", slug=f"key-{uuid4().hex[:4]}")
    session_override.add_all([action, vip, contact, project])
    await session_override.flush()
    session_override.add(ContactTagLink(contact_id=contact.id, tag_id=vip.id, tenant_id=tenant.id))
    session_override.add(ProjectTagLink(project_id=project.id, tag_id=vip.id, tenant_id=tenant.id))
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        status="open",
        contact_id=contact.id,
        project_id=project.id,
        ticket_tag_id=action.id,
        stage_key="open",
    )
    session_override.add(signal)
    await session_override.commit()

    body = await explain_thread(session_override, tenant, signal.id)
    assert _kinds(body) == ["agent_none", "handling_workspace", "cap_flow", "folder_contact", "flow"]
    assert _line(body, "cap_flow")["href"] == f"/flows/{flow.id}"
    folder = _line(body, "folder_contact")
    assert folder["params"] == {"folder": "Key accounts", "tag": "vip"}
    assert folder["href"] == f"/contacts/{contact.id}"
    assert _line(body, "flow")["params"] == {"flow": "Complaints", "label": "complaint", "stage": "Not started"}
    assert body["placement"]["flow"]["always_review"] is True


@pytest.mark.asyncio
async def test_folder_via_company_label(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    company = Company(tenant_id=tenant.id, name="Client BV")
    session_override.add(company)
    await session_override.flush()
    tag = SignalTag(tenant_id=tenant.id, name="partner")
    contact = Contact(tenant_id=tenant.id, address="a@client.test", company_id=company.id)
    project = Project(tenant_id=tenant.id, name="Partners", slug=f"p-{uuid4().hex[:4]}")
    session_override.add_all([tag, contact, project])
    await session_override.flush()
    session_override.add(CompanyTagLink(company_id=company.id, tag_id=tag.id, tenant_id=tenant.id))
    session_override.add(ProjectTagLink(project_id=project.id, tag_id=tag.id, tenant_id=tenant.id))
    signal = Signal(
        tenant_id=tenant.id, channel="email", status="open", contact_id=contact.id, project_id=project.id
    )
    session_override.add(signal)
    await session_override.commit()

    body = await explain_thread(session_override, tenant, signal.id)
    folder = _line(body, "folder_company")
    assert folder["href"] == f"/contacts/companies/{company.id}"


@pytest.mark.asyncio
async def test_why_endpoint_returns_lines(client: AsyncClient, session_override: AsyncSession):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = Signal(tenant_id=tenant.id, channel="email", status="open")
    session_override.add(signal)
    await session_override.commit()

    res = await client.get(f"/api/signals/{signal.id}/why", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["lines"][0]["kind"].startswith("agent_")
    assert all({"kind", "params", "href"} <= set(line) for line in body["lines"])
