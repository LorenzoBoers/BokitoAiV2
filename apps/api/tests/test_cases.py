"""Phase 2–3: cases, bindings, type.mode, and governed agent tools."""

import os
from datetime import datetime, timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.case import CaseType
from app.models.notification import DecisionRequest
from app.models.orchestra import WorkstreamRun
from app.models.platform_change import PlatformChange
from app.models.project import Project
from app.models.signal import Signal, SignalMessage
from app.services.cases import (
    create_binding,
    create_case,
    create_case_type,
    ensure_platform_case_types,
)
from app.tools import execute_tool
from app.tools.policy import resolve_tool_mode, tenant_allowances
from app.tools.registry import get_tool_spec
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _signal(session, tenant_id, *, subject="Case thread") -> Signal:
    signal = Signal(tenant_id=tenant_id, channel="widget", source="widget", subject=subject)
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


async def _type_by_slug(session, tenant_id, slug: str) -> CaseType:
    await ensure_platform_case_types(session, tenant_id)
    return (
        await session.execute(
            select(CaseType).where(CaseType.tenant_id == tenant_id, CaseType.slug == slug)
        )
    ).scalar_one()


async def _assistant(session) -> Agent:
    return (await session.execute(select(Agent).where(Agent.role == "assistant"))).scalar_one()


@pytest.mark.asyncio
async def test_platform_types_and_multi_cases_per_thread(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    listed = await client.get("/api/cases/types", headers=headers)
    assert listed.status_code == 200
    slugs = {row["slug"] for row in listed.json()["items"]}
    assert {"complaint", "bug_report", "feature_request", "spam_abuse"} <= slugs

    signal = await _signal(session_override, tenant.id)
    bug = await _type_by_slug(session_override, tenant.id, "bug_report")
    feature = await _type_by_slug(session_override, tenant.id, "feature_request")
    first = await client.post(
        "/api/cases",
        headers=headers,
        json={"case_type_id": str(bug.id), "signal_id": str(signal.id), "title": "Checkout 500"},
    )
    second = await client.post(
        "/api/cases",
        headers=headers,
        json={"case_type_id": str(feature.id), "signal_id": str(signal.id), "title": "Export CSV"},
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["case"]["status"] == "open"
    thread = await client.get(f"/api/signals/{signal.id}/cases", headers=headers)
    assert thread.status_code == 200
    assert len(thread.json()["items"]) == 2


@pytest.mark.asyncio
async def test_agent_mode_and_certainty_gates(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id, subject="Modes")
    bug = await _type_by_slug(session_override, tenant.id, "bug_report")
    complaint = await _type_by_slug(session_override, tenant.id, "complaint")
    spam = await _type_by_slug(session_override, tenant.id, "spam_abuse")

    low = await create_case(
        session_override,
        tenant.id,
        case_type_id=bug.id,
        signal_id=signal.id,
        title="Maybe a bug",
        certainty=4,
        actor="agent",
    )
    assert low["case"]["status"] == "proposed"
    assert low.get("asked_customer") is True

    mid = await create_case(
        session_override,
        tenant.id,
        case_type_id=bug.id,
        signal_id=signal.id,
        title="Likely a bug",
        certainty=7,
        actor="agent",
    )
    assert mid["case"]["status"] == "proposed"

    high = await create_case(
        session_override,
        tenant.id,
        case_type_id=bug.id,
        signal_id=signal.id,
        title="Definite bug",
        certainty=9,
        actor="agent",
    )
    assert high["case"]["status"] == "open"

    always_ask = await create_case(
        session_override,
        tenant.id,
        case_type_id=complaint.id,
        signal_id=signal.id,
        title="Angry",
        certainty=10,
        actor="agent",
    )
    assert always_ask["case"]["status"] == "proposed"

    auto = await create_case(
        session_override,
        tenant.id,
        case_type_id=spam.id,
        signal_id=signal.id,
        title="Spam",
        certainty=8,
        actor="agent",
    )
    assert auto["case"]["status"] == "open"


@pytest.mark.asyncio
async def test_zero_one_n_bindings_and_input_kind(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id, subject="Bindings")
    custom = await create_case_type(
        session_override, tenant.id, name="Intake test", slug="intake-test", create_mode="auto"
    )

    none = await create_case(
        session_override,
        tenant.id,
        case_type_id=custom.id,
        signal_id=signal.id,
        title="No route",
        certainty=10,
        actor="agent",
    )
    assert none["case"]["status"] == "open"
    assert none["case"]["workstream_id"] is None
    assert none["bindings"] == 0

    ws = await client.post("/api/workstreams", headers=headers, json={"name": "Intake"})
    assert ws.status_code == 200
    ws_id = ws.json()["id"]
    steps = await client.put(
        f"/api/workstreams/{ws_id}/steps",
        headers=headers,
        json={"steps": [{"name": "Triage", "kind": "agent", "goal": "Triage the case."}]},
    )
    assert steps.status_code == 200
    await create_binding(
        session_override,
        tenant.id,
        case_type_id=custom.id,
        target_kind="workstream",
        target_id=UUID(ws_id),
        auto_link=True,
        auto_start_run=True,
    )

    linked = await create_case(
        session_override,
        tenant.id,
        case_type_id=custom.id,
        signal_id=signal.id,
        title="Routed",
        certainty=10,
        actor="agent",
    )
    assert linked.get("linked") is True
    assert linked["case"]["status"] == "linked"
    assert linked["case"]["workstream_id"] == ws_id
    run_id = linked["case"]["workstream_run_id"]
    assert run_id
    run = (
        await session_override.execute(select(WorkstreamRun).where(WorkstreamRun.id == UUID(run_id)))
    ).scalar_one()
    assert run.input_kind == "case"
    assert run.input_ref == linked["case"]["id"]

    other = await client.post("/api/workstreams", headers=headers, json={"name": "Also intake"})
    other_id = other.json()["id"]
    await create_binding(
        session_override,
        tenant.id,
        case_type_id=custom.id,
        target_kind="workstream",
        target_id=__import__("uuid").UUID(other_id),
        auto_link=True,
        priority=1,
    )
    asked = await create_case(
        session_override,
        tenant.id,
        case_type_id=custom.id,
        signal_id=signal.id,
        title="Ambiguous",
        certainty=10,
        actor="agent",
    )
    assert asked["case"]["status"] == "waiting_operator"
    assert asked.get("asked_operator") is True
    decisions = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.source_id == asked["case"]["id"])
        )
    ).scalars().all()
    assert decisions
    updates = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.kind == "status_update",
            )
        )
    ).scalars().all()
    assert any("asked the team" in (m.body_text or "") for m in updates)


@pytest.mark.asyncio
async def test_project_scoped_binding_beats_tenant(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id, subject="Specificity")
    case_type = await create_case_type(
        session_override, tenant.id, name="Scoped", slug="scoped-type", create_mode="auto"
    )
    project = Project(tenant_id=tenant.id, name="Acme", slug="acme-cases", autonomous_scope="project")
    session_override.add(project)
    await session_override.commit()
    await session_override.refresh(project)

    tenant_ws = await client.post("/api/workstreams", headers=headers, json={"name": "Tenant intake"})
    project_ws = await client.post(
        "/api/workstreams",
        headers=headers,
        json={"name": "Project intake", "project_id": str(project.id)},
    )
    tenant_id_ws = tenant_ws.json()["id"]
    project_id_ws = project_ws.json()["id"]
    await create_binding(
        session_override,
        tenant.id,
        case_type_id=case_type.id,
        target_kind="workstream",
        target_id=UUID(tenant_id_ws),
        auto_link=True,
        auto_start_run=False,
        priority=50,
    )
    await create_binding(
        session_override,
        tenant.id,
        case_type_id=case_type.id,
        target_kind="workstream",
        target_id=UUID(project_id_ws),
        auto_link=True,
        auto_start_run=False,
        priority=1,
    )

    result = await create_case(
        session_override,
        tenant.id,
        case_type_id=case_type.id,
        signal_id=signal.id,
        title="On project",
        certainty=10,
        project_id=project.id,
        actor="agent",
    )
    assert result.get("linked") is True
    assert result["case"]["workstream_id"] == project_id_ws


@pytest.mark.asyncio
async def test_verify_required_without_assurance_waits(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id, subject="Billing")
    billing = await create_case_type(
        session_override,
        tenant.id,
        name="Billing inquiry",
        slug="billing-inquiry-test",
        create_mode="ask_customer",
        requires_verification=True,
        audience="customer",
    )
    result = await create_case(
        session_override,
        tenant.id,
        case_type_id=billing.id,
        signal_id=signal.id,
        title="Invoice copy",
        certainty=8,
        actor="agent",
    )
    assert result["status"] == "needs_verification"
    assert result["case"]["status"] == "waiting_customer"

    signal.assurance_level = "verified"
    signal.assurance_email = "a@example.com"
    signal.assurance_expires_at = datetime.utcnow() + timedelta(minutes=30)
    signal.assurance_verified_at = datetime.utcnow()
    session_override.add(signal)
    await session_override.commit()

    opened = await create_case(
        session_override,
        tenant.id,
        case_type_id=billing.id,
        signal_id=signal.id,
        title="Invoice copy 2",
        certainty=8,
        actor="agent",
    )
    assert opened["case"]["status"] == "proposed"


@pytest.mark.asyncio
async def test_cases_posture_and_external_follows_type_mode(client: AsyncClient, session_override):
    await _login(client)
    tenant = await _tenant(session_override)
    allowances = tenant_allowances(tenant)
    assert allowances["cases"] == "allow"

    tenant.settings_json = '{"autonomy_posture":"manual"}'
    session_override.add(tenant)
    await session_override.commit()
    session_override.expire_all()
    tenant = await _tenant(session_override)
    assert tenant_allowances(tenant)["cases"] == "ask"

    tenant.settings_json = '{"autonomy_posture":"assisted","tool_allowances":{"cases":"deny"}}'
    session_override.add(tenant)
    await session_override.commit()
    session_override.expire_all()
    tenant = await _tenant(session_override)
    spec = get_tool_spec("create_case")
    mode, reason = await resolve_tool_mode(session_override, tenant, None, spec, trust="external")
    assert (mode, reason) == ("deny", "category:cases") or mode == "deny"

    tenant.settings_json = '{"autonomy_posture":"assisted"}'
    session_override.add(tenant)
    await session_override.commit()
    session_override.expire_all()
    tenant = await _tenant(session_override)
    mode, reason = await resolve_tool_mode(session_override, tenant, None, spec, trust="external")
    assert mode == "allow"
    assert reason != "external_trust"

    signal = await _signal(session_override, tenant.id, subject="Widget case")
    agent = await _assistant(session_override)
    agent.autonomy_level = "auto"
    session_override.add(agent)
    await session_override.commit()
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_case",
        {
            "case_type": "bug_report",
            "signal_id": str(signal.id),
            "title": "Button missing",
            "certainty": 7,
        },
        agent=agent,
        signal_id=signal.id,
        trust="external",
    )
    assert result.get("status") != "awaiting_human"
    assert result.get("case", {}).get("status") == "proposed"
    assert result.get("asked_customer") is True


@pytest.mark.asyncio
async def test_member_denied_structural_case_type(client: AsyncClient, session_override):
    await _login(client)
    tenant = await _tenant(session_override)
    spec = get_tool_spec("create_case_type")
    mode, reason = await resolve_tool_mode(
        session_override, tenant, None, spec, user_role="member"
    )
    assert (mode, reason) == ("deny", "user_role")
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_case_type",
        {"name": "Should fail"},
        user_role="member",
    )
    assert result.get("status") == "denied"


@pytest.mark.asyncio
async def test_wake_agent_proposes_binding_as_platform_change(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    agent = await _assistant(session_override)
    bug = await _type_by_slug(session_override, tenant.id, "bug_report")
    ws = await client.post("/api/workstreams", headers=headers, json={"name": "Bugs"})
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "bind_case_type",
        {
            "case_type_id": str(bug.id),
            "target_kind": "workstream",
            "target_id": ws.json()["id"],
            "auto_link": True,
        },
        agent=agent,
        user_role=None,
    )
    assert result.get("status") in ("pending_review", "draft")
    assert result.get("change_id")
    change = (
        await session_override.execute(
            select(PlatformChange).where(PlatformChange.id == UUID(result["change_id"]))
        )
    ).scalar_one()
    assert change.resource_type == "case_type_binding"
    assert change.status == "pending_review"


@pytest.mark.asyncio
async def test_ask_operator_creates_decision_and_status_update(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id, subject="Ask operator")
    row = await create_case_type(
        session_override,
        tenant.id,
        name="Needs review",
        slug="needs-review",
        create_mode="ask_operator",
    )
    agent = await _assistant(session_override)
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_case",
        {
            "case_type_id": str(row.id),
            "signal_id": str(signal.id),
            "title": "Please review",
            "certainty": 8,
        },
        agent=agent,
        signal_id=signal.id,
        trust="external",
    )
    assert result.get("asked_operator") is True
    assert result["case"]["status"] == "waiting_operator"
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.source_id == result["case"]["id"])
        )
    ).scalar_one()
    assert decision.source_type == "case"
    note = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.kind == "status_update",
            )
        )
    ).scalar_one()
    assert "asked the team" in (note.body_text or "")


@pytest.mark.asyncio
async def test_case_binding_map_lists_unbound_types(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    from app.services.assistant_context import case_binding_map_block

    block = await case_binding_map_block(session_override, tenant.id)
    assert "bug_report → none" in block
    assert "one case per distinct intent" in block
