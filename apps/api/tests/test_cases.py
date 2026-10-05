"""Phase 2–3: cases, bindings, type.mode, and governed agent tools."""

import os
from datetime import datetime, timedelta
from uuid import UUID

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.case import CaseType
from app.models.notification import DecisionRequest
from app.models.orchestra import Workstream, WorkstreamRun
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


async def _make_ticket_type(session, tenant_id, type_id, *, stages_json: str = "[]") -> Workstream:
    """Bind a category to a fresh workstream so it files tickets."""
    ws = Workstream(tenant_id=tenant_id, name=f"Pipeline {type_id}", stages_json=stages_json)
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    await create_binding(
        session,
        tenant_id,
        case_type_id=type_id,
        target_kind="workstream",
        target_id=ws.id,
        auto_link=True,
        auto_start_run=False,
    )
    return ws


@pytest.mark.asyncio
async def test_platform_types_and_one_category_per_thread(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    listed = await client.get("/api/cases/types", headers=headers)
    assert listed.status_code == 200
    items = listed.json()["items"]
    slugs = {row["slug"] for row in items}
    assert {
        "invoice_payment",
        "complaint",
        "bug_report",
        "feature_request",
        "spam_abuse",
    } <= slugs
    by_slug = {row["slug"]: row for row in items}
    assert by_slug["invoice_payment"]["name"] == "Factuur/betaling"
    assert by_slug["complaint"]["name"] == "Klacht"
    assert by_slug["bug_report"]["name"] == "Storing"
    assert by_slug["feature_request"]["name"] == "Functieverzoek"
    assert by_slug["spam_abuse"]["name"] == "Spam of misbruik"

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
    # No workstream binding: the category only labels the conversation.
    assert first.json()["case"]["status"] == "done"
    assert first.json()["label_only"] is True
    # An operator picking another category recategorizes the conversation.
    thread = await client.get(f"/api/signals/{signal.id}/cases", headers=headers)
    assert thread.status_code == 200
    items = thread.json()["items"]
    assert [row["case_type_id"] for row in items] == [str(feature.id)]

    # An agent cannot add a second category; the new intent is a split.
    with pytest.raises(HTTPException) as exc:
        await create_case(
            session_override,
            tenant.id,
            case_type_id=bug.id,
            signal_id=signal.id,
            certainty=10,
            actor="agent",
        )
    assert exc.value.status_code == 409
    again = await create_case(
        session_override, tenant.id, case_type_id=feature.id, signal_id=signal.id, actor="agent"
    )
    assert again["existing"] is True


@pytest.mark.asyncio
async def test_platform_type_rename_in_place_leaves_custom_names(client: AsyncClient, session_override):
    # `client` seeds the test tenant; rename runs through ensure_platform_case_types.
    _ = client
    tenant = await _tenant(session_override)
    await ensure_platform_case_types(session_override, tenant.id)
    complaint = await _type_by_slug(session_override, tenant.id, "complaint")
    bug = await _type_by_slug(session_override, tenant.id, "bug_report")
    # Simulate a tenant stuck on the prior EN seed labels.
    complaint.name = "Complaint"
    complaint.description = "A customer is unhappy and wants this recorded."
    bug.name = "Klachten VIP"
    session_override.add_all([complaint, bug])
    await session_override.commit()

    await ensure_platform_case_types(session_override, tenant.id)
    await session_override.refresh(complaint)
    await session_override.refresh(bug)
    assert complaint.name == "Klacht"
    assert "ontevreden" in (complaint.description or "")
    # Operator-customized name is preserved.
    assert bug.name == "Klachten VIP"
    invoice = await _type_by_slug(session_override, tenant.id, "invoice_payment")
    assert invoice.name == "Factuur/betaling"


@pytest.mark.asyncio
async def test_agent_mode_and_certainty_gates(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    bug = await _type_by_slug(session_override, tenant.id, "bug_report")
    complaint = await _type_by_slug(session_override, tenant.id, "complaint")
    spam = await _type_by_slug(session_override, tenant.id, "spam_abuse")
    await _make_ticket_type(session_override, tenant.id, bug.id)

    async def read(case_type, certainty):
        signal = await _signal(session_override, tenant.id, subject="Modes")
        return await create_case(
            session_override,
            tenant.id,
            case_type_id=case_type.id,
            signal_id=signal.id,
            title="Read",
            certainty=certainty,
            actor="agent",
        )

    low = await read(bug, 4)
    # Below the ask threshold the read is unsure: it becomes a confirm chip on
    # the thread instead of work, and nothing is asked of the customer yet.
    assert low["case"]["status"] == "proposed"
    assert low.get("proposed") is True
    assert low.get("asked_customer") is None

    assert (await read(bug, 7))["case"]["status"] == "open"
    assert (await read(bug, 9))["case"]["status"] == "open"

    # Label-only categories: an accepted read is done at once, an unsure one waits.
    always_ask = await read(complaint, 10)
    assert always_ask["case"]["status"] == "done"
    assert always_ask["label_only"] is True
    assert (await read(complaint, 3))["case"]["status"] == "proposed"
    auto = await read(spam, 8)
    assert auto["case"]["status"] == "done"
    assert auto.get("label_only") is True


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
    assert none["case"]["status"] == "done"
    assert none["case"]["workstream_id"] is None
    assert none["bindings"] == 0
    assert none["label_only"] is True

    ws = await client.post("/api/workstreams", headers=headers, json={"name": "Intake"})
    assert ws.status_code == 200
    ws_id = ws.json()["id"]
    steps = await client.put(
        f"/api/workstreams/{ws_id}/steps",
        headers=headers,
        json={"steps": [{"name": "Triage", "kind": "agent_task", "goal": "Triage the case."}]},
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

    signal = await _signal(session_override, tenant.id, subject="Bindings routed")
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
    assert linked["case"]["is_ticket"] is True
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
    signal = await _signal(session_override, tenant.id, subject="Bindings ambiguous")
    asked = await create_case(
        session_override,
        tenant.id,
        case_type_id=custom.id,
        signal_id=signal.id,
        title="Ambiguous",
        certainty=10,
        actor="agent",
    )
    assert asked["case"]["status"] == "waiting"
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
    assert result["case"]["status"] == "waiting"

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
    # Verified: the same category re-reads and, label-only, is done.
    assert opened["case"]["status"] == "done"
    assert opened["case"]["title"] == "Invoice copy 2"


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
    bug = await _type_by_slug(session_override, tenant.id, "bug_report")
    await _make_ticket_type(session_override, tenant.id, bug.id)
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
    assert result.get("case", {}).get("status") == "open"
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
    await _make_ticket_type(session_override, tenant.id, row.id)
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
    assert result["case"]["status"] == "waiting"
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
async def test_case_list_filters_and_type_retirement(client: AsyncClient, session_override):
    """Cross-surface case search remains while the dedicated hub is retired."""
    headers = await _login(client)
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id, subject="Signal filter thread")
    other_signal = await _signal(session_override, tenant.id, subject="Other thread")
    bug = await _type_by_slug(session_override, tenant.id, "bug_report")
    feature = await _type_by_slug(session_override, tenant.id, "feature_request")
    await _make_ticket_type(session_override, tenant.id, bug.id)

    first = await client.post(
        "/api/cases",
        headers=headers,
        json={"case_type_id": str(bug.id), "signal_id": str(signal.id), "title": "Checkout crash"},
    )
    second = await client.post(
        "/api/cases",
        headers=headers,
        json={"case_type_id": str(feature.id), "signal_id": str(other_signal.id), "title": "CSV export"},
    )
    assert first.status_code == 200
    assert second.status_code == 200

    project = Project(
        tenant_id=tenant.id, name="Board", slug="board-cases", autonomous_scope="project"
    )
    session_override.add(project)
    await session_override.commit()
    await session_override.refresh(project)
    project_signal = await _signal(session_override, tenant.id, subject="Project thread")
    on_project = await client.post(
        "/api/cases",
        headers=headers,
        json={
            "case_type_id": str(bug.id),
            "signal_id": str(project_signal.id),
            "title": "Project board",
            "project_id": str(project.id),
        },
    )
    assert on_project.status_code == 200
    by_project = await client.get(f"/api/cases?project_id={project.id}", headers=headers)
    assert by_project.status_code == 200
    project_titles = [row["title"] for row in by_project.json()["items"]]
    assert project_titles == ["Project board"]

    by_type = await client.get(f"/api/cases?case_type_id={bug.id}", headers=headers)
    assert by_type.status_code == 200
    items = by_type.json()["items"]
    assert items
    assert all(row["case_type_id"] == str(bug.id) for row in items)
    assert any(row["signal_subject"] == "Signal filter thread" for row in items)

    by_text = await client.get("/api/cases?q=checkout", headers=headers)
    assert by_text.status_code == 200
    titles = [row["title"] for row in by_text.json()["items"]]
    assert "Checkout crash" in titles
    assert "CSV export" not in titles

    spam = await _type_by_slug(session_override, tenant.id, "spam_abuse")
    spam_signal = await _signal(session_override, tenant.id, subject="Spam thread")
    spam_case = await client.post(
        "/api/cases",
        headers=headers,
        json={"case_type_id": str(spam.id), "signal_id": str(spam_signal.id), "title": "Junk mail"},
    )
    assert spam_case.status_code == 200
    assert spam_case.json()["case"]["status"] == "done"

    tickets = await client.get("/api/cases?tickets_only=true", headers=headers)
    assert tickets.status_code == 200
    ticket_titles = [row["title"] for row in tickets.json()["items"]]
    assert "Checkout crash" in ticket_titles
    assert "Junk mail" not in ticket_titles
    assert "CSV export" not in ticket_titles

    unused = await client.post(
        "/api/cases/types",
        headers=headers,
        json={"name": "Temp unused", "slug": "temp-unused"},
    )
    assert unused.status_code == 200
    unused_id = unused.json()["id"]
    deleted = await client.delete(f"/api/cases/types/{unused_id}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True, "archived": False, "cases": 0}

    tracked = await client.post(
        "/api/cases/types",
        headers=headers,
        json={"name": "Track me", "slug": "track-me", "create_mode": "auto"},
    )
    assert tracked.status_code == 200
    tracked_id = tracked.json()["id"]
    await _make_ticket_type(session_override, tenant.id, UUID(tracked_id))
    tracked_signal = await _signal(session_override, tenant.id, subject="Tracked thread")
    used = await client.post(
        "/api/cases",
        headers=headers,
        json={"case_type_id": tracked_id, "signal_id": str(tracked_signal.id), "title": "Needs archive"},
    )
    assert used.status_code == 200
    assert used.json()["case"]["status"] == "open"
    archived = await client.delete(f"/api/cases/types/{tracked_id}", headers=headers)
    assert archived.status_code == 200
    body = archived.json()
    assert body["archived"] is True
    assert body["cases"] >= 1
    assert body["closed"] >= 1
    types_after = await client.get("/api/cases/types", headers=headers)
    track_row = next(r for r in types_after.json()["items"] if r["id"] == tracked_id)
    assert track_row["enabled"] is False


@pytest.mark.asyncio
async def test_case_binding_map_lists_unbound_types(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    from app.services.assistant_context import case_binding_map_block

    block = await case_binding_map_block(session_override, tenant.id)
    assert "bug_report → none" in block
    assert "one case per distinct intent" in block


@pytest.mark.asyncio
async def test_tracked_case_does_not_open_follow_up_task(client: AsyncClient, session_override):
    from app.models.orchestration import AgentTask

    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id, subject="Need a call back")
    row = await create_case_type(
        session_override,
        tenant.id,
        name="Callback",
        slug="callback-follow-up",
        create_mode="manual_only",
    )
    first = await create_case(
        session_override,
        tenant.id,
        case_type_id=row.id,
        signal_id=signal.id,
        title="Call the customer",
        actor="operator",
        created_by_type="user",
        created_by_id=str(tenant.id),  # placeholder; assignee may be null
    )
    assert first["case"]["status"] == "done"

    tasks = (
        await session_override.execute(
            select(AgentTask).where(
                AgentTask.tenant_id == tenant.id,
                AgentTask.signal_id == signal.id,
                AgentTask.origin == "case",
            )
        )
    ).scalars().all()
    assert tasks == []


@pytest.mark.asyncio
async def test_opening_case_does_not_create_agenda_task(client: AsyncClient, session_override):
    """Human gates stay in the thread; opening a signal never creates AgentTask."""
    from app.models.orchestration import AgentTask
    from app.services.cases import update_case

    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id, subject="Waiting approval")
    row = await create_case_type(
        session_override,
        tenant.id,
        name="Needs approve",
        slug="needs-approve-follow-up",
        create_mode="ask_operator",
    )
    await _make_ticket_type(session_override, tenant.id, row.id)
    created = await create_case(
        session_override,
        tenant.id,
        case_type_id=row.id,
        signal_id=signal.id,
        title="Approve me",
        actor="agent",
        certainty=9,
    )
    assert created["case"]["status"] == "waiting"
    before = (
        await session_override.execute(
            select(AgentTask).where(
                AgentTask.tenant_id == tenant.id,
                AgentTask.signal_id == signal.id,
                AgentTask.origin == "case",
            )
        )
    ).scalars().all()
    assert before == []

    await update_case(
        session_override,
        tenant.id,
        UUID(created["case"]["id"]),
        {"status": "open"},
    )
    after = (
        await session_override.execute(
            select(AgentTask).where(
                AgentTask.tenant_id == tenant.id,
                AgentTask.signal_id == signal.id,
                AgentTask.origin == "case",
            )
        )
    ).scalars().all()
    assert after == []


@pytest.mark.asyncio
async def test_signal_policy_and_backlog_promotion(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)

    default = await client.get("/api/cases/policy", headers=headers)
    assert default.status_code == 200
    assert default.json()["accept_roles"] == "admins"
    assert default.json()["backlog_threshold"] == 3
    assert default.json()["may_accept"] is True

    saved = await client.put(
        "/api/cases/policy",
        headers=headers,
        json={"accept_roles": "members", "backlog_threshold": 2},
    )
    assert saved.status_code == 200
    assert saved.json()["accept_roles"] == "members"

    # An unmatched pattern is counted, never turned into a type on its own.
    from app.services.signal_catalog import record_unknown

    for _ in range(2):
        await record_unknown(
            session_override,
            tenant.id,
            name="Warranty claim",
            sentence="A customer claims warranty on a delivered product.",
            example="My heat pump broke after two months.",
        )
    backlog = await client.get("/api/cases/backlog", headers=headers)
    assert backlog.status_code == 200
    entry = backlog.json()["items"][0]
    assert entry["count"] == 2
    assert entry["ready"] is True

    promoted = await client.post(
        f"/api/cases/backlog/{entry['key']}/promote",
        headers=headers,
        json={},
    )
    assert promoted.status_code == 200
    assert promoted.json()["name"] == "Warranty claim"
    assert (await client.get("/api/cases/backlog", headers=headers)).json()["items"] == []


@pytest.mark.asyncio
async def test_unsure_signal_waits_for_confirmation_before_routing(
    client: AsyncClient, session_override
):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id, subject="Unsure")
    row = await create_case_type(
        session_override,
        tenant.id,
        name="Refund request",
        slug="refund-request-confirm",
        create_mode="auto",
    )
    ws = await client.post("/api/workstreams", headers=headers, json={"name": "Refunds"})
    assert ws.status_code == 200
    await create_binding(
        session_override,
        tenant.id,
        case_type_id=row.id,
        target_kind="workstream",
        target_id=UUID(ws.json()["id"]),
        auto_link=True,
    )

    unsure = await create_case(
        session_override,
        tenant.id,
        case_type_id=row.id,
        signal_id=signal.id,
        title="Maybe a refund",
        certainty=5,
        actor="agent",
    )
    assert unsure["case"]["status"] == "proposed"
    assert unsure["case"]["workstream_id"] is None

    from app.services.cases import update_case

    accepted = await update_case(
        session_override, tenant.id, UUID(unsure["case"]["id"]), {"status": "open"}
    )
    assert accepted.status == "open"
    assert str(accepted.workstream_id) == ws.json()["id"]


@pytest.mark.asyncio
async def test_ticket_moves_through_workstream_stages(client: AsyncClient, session_override):
    from app.models.signal import SignalEvent
    from app.services.workstreams import advance_run

    headers = await _login(client)
    tenant = await _tenant(session_override)
    row = await create_case_type(
        session_override, tenant.id, name="Repair", slug="repair-stages", create_mode="auto"
    )
    ws = await client.post("/api/workstreams", headers=headers, json={"name": "Repairs"})
    ws_id = ws.json()["id"]
    assert [s["kind"] for s in ws.json()["stages"]] == ["open", "waiting", "done"]
    stages = [
        {"name": "Intake", "kind": "open"},
        {"name": "Waiting for parts", "kind": "waiting"},
        {"name": "Fixed", "kind": "done"},
    ]
    patched = await client.patch(
        f"/api/workstreams/{ws_id}", headers=headers, json={"stages": stages}
    )
    assert patched.status_code == 200
    assert [s["key"] for s in patched.json()["stages"]] == ["intake", "waiting-for-parts", "fixed"]
    no_done = await client.patch(
        f"/api/workstreams/{ws_id}",
        headers=headers,
        json={"stages": [{"name": "Only", "kind": "open"}]},
    )
    assert no_done.status_code == 400
    steps = await client.put(
        f"/api/workstreams/{ws_id}/steps",
        headers=headers,
        json={
            "steps": [
                {"name": "Order parts", "kind": "wait_for_reply", "stage_key": "waiting-for-parts"}
            ]
        },
    )
    assert steps.status_code == 200
    assert steps.json()["steps"][0]["stage_key"] == "waiting-for-parts"
    await create_binding(
        session_override,
        tenant.id,
        case_type_id=row.id,
        target_kind="workstream",
        target_id=UUID(ws_id),
        auto_link=True,
        auto_start_run=True,
    )
    signal = await _signal(session_override, tenant.id, subject="Broken pump")
    result = await create_case(
        session_override,
        tenant.id,
        case_type_id=row.id,
        signal_id=signal.id,
        title="Pump broken",
        certainty=10,
        actor="agent",
    )
    case_id = result["case"]["id"]
    assert result["case"]["is_ticket"] is True
    await advance_run(session_override, tenant.id, UUID(result["case"]["workstream_run_id"]))

    detail = await client.get(f"/api/cases/{case_id}", headers=headers)
    body = detail.json()
    assert body["stage"] == {"key": "waiting-for-parts", "name": "Waiting for parts", "kind": "waiting"}
    assert body["status"] == "waiting"
    assert len(body["stages"]) == 3

    moved = await client.patch(
        f"/api/cases/{case_id}", headers=headers, json={"stage_key": "fixed"}
    )
    assert moved.status_code == 200
    assert moved.json()["status"] == "done"
    unknown = await client.patch(
        f"/api/cases/{case_id}", headers=headers, json={"stage_key": "nope"}
    )
    assert unknown.status_code == 400

    thread = (await client.get(f"/api/signals/{signal.id}", headers=headers)).json()["thread"]
    assert thread["category_case"]["name"] == "Repair"
    assert thread["category_case"]["is_ticket"] is True
    assert thread["category_case"]["stage"]["name"] == "Fixed"

    events = (
        await session_override.execute(
            select(SignalEvent.event_type).where(SignalEvent.signal_id == signal.id)
        )
    ).scalars().all()
    assert "category_set" in events
    assert events.count("ticket_stage_changed") >= 3


@pytest.mark.asyncio
async def test_dismissing_a_proposal_removes_the_category(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    bug = await _type_by_slug(session_override, tenant.id, "bug_report")
    signal = await _signal(session_override, tenant.id, subject="Unsure label")
    proposed = await create_case(
        session_override,
        tenant.id,
        case_type_id=bug.id,
        signal_id=signal.id,
        certainty=2,
        actor="agent",
    )
    assert proposed["case"]["status"] == "proposed"
    dismissed = await client.patch(
        f"/api/cases/{proposed['case']['id']}", headers=headers, json={"status": "done"}
    )
    assert dismissed.json() == {"id": proposed["case"]["id"], "removed": True}
    listed = await client.get(f"/api/signals/{signal.id}/cases", headers=headers)
    assert listed.json()["items"] == []
