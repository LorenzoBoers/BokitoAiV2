"""Departments as the home of agent awareness: domain questions, event wakes,
the reach ladder, Call me, the marketplace drop and the Grid lanes."""

import json
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import get_settings
from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.signal import Signal, SignalEvent, SignalMessage, SignalTag
from app.models.team import Department
from app.models.usage import PushSubscription
from app.services.agent_awareness import aware_context, set_awareness
from app.services.event_wakes import wake_for_events
from app.services.notify import save_prefs
from app.services.push import notify_decision
from app.services.reach import REACH_EVENT, in_quiet_hours, parse_reach, urgency
from app.services.teams import create_team, set_team_members
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

STAGES = [
    {"key": "brief", "name": "Brief", "kind": "open"},
    {"key": "akkoord", "name": "Akkoord", "kind": "waiting", "waiting_on": "customer"},
    {"key": "klaar", "name": "Klaar", "kind": "done"},
]


async def _headers(client: AsyncClient) -> dict[str, str]:
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _department(session, *, with_flow: bool = True):
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    owner = (await session.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    lead = (await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars().first()
    team = await create_team(session, tenant.id, name="Content", description="", pickup="people", members=[])
    await set_team_members(
        session,
        team,
        [{"kind": "agent", "id": str(lead.id), "duty": "primary"}, {"kind": "user", "id": str(owner.id), "duty": "primary"}],
    )
    flow = label = None
    if with_flow:
        flow = Workstream(tenant_id=tenant.id, name="Maandcontent", department_id=team.id, stages_json=json.dumps(STAGES))
        session.add(flow)
        await session.flush()
        label = SignalTag(tenant_id=tenant.id, name="maandcontent", workstream_id=flow.id)
        session.add(label)
    await session.commit()
    return tenant, owner, lead, team, flow, label


async def _ticket(session, tenant, label, **extra) -> Signal:
    signal = Signal(
        tenant_id=tenant.id, channel="email", source="email", subject="Posts juni",
        ticket_tag_id=label.id, ticket_status="open", stage_key="brief", **extra,
    )
    session.add(signal)
    await session.commit()
    return signal


@pytest.mark.asyncio
async def test_domain_question_is_asked_once_and_its_answer_reaches_the_brief(client: AsyncClient, session_override):
    headers = await _headers(client)
    _tenant, _owner, lead, team, _flow, _label = await _department(session_override)
    lead_id = lead.id

    first = await client.post(
        f"/api/departments/{team.id}/domain/questions", json={"question": "Which tone do clients expect?"}, headers=headers
    )
    assert first.status_code == 200 and first.json()["status"] == "open"
    again = await client.post(
        f"/api/departments/{team.id}/domain/questions", json={"question": "which  tone do clients expect?"}, headers=headers
    )
    assert again.json()["key"] == first.json()["key"]

    key = first.json()["key"]
    answered = await client.patch(
        f"/api/departments/{team.id}/domain/questions/{key}", json={"answer": "Warm, no jargon."}, headers=headers
    )
    assert answered.status_code == 200 and answered.json()["status"] == "answered"
    missing = await client.patch(
        f"/api/departments/{team.id}/domain/questions/nope", json={"answer": "x"}, headers=headers
    )
    assert missing.status_code == 404

    rows = (await client.get(f"/api/departments/{team.id}/domain/questions", headers=headers)).json()
    assert len(rows) == 1
    session_override.expire_all()
    agent = await session_override.get(Agent, lead_id)
    text = await aware_context(session_override, agent)
    assert "Warm, no jargon." in text


@pytest.mark.asyncio
async def test_awareness_is_set_on_the_lead_through_the_department(client: AsyncClient, session_override):
    headers = await _headers(client)
    _tenant, _owner, lead, team, _flow, _label = await _department(session_override)

    res = await client.patch(
        f"/api/departments/{team.id}/awareness",
        json={"follows": ["inbound", "deadline"], "daily_cost_cents": 150, "max_proposals": 2},
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["follows"] == ["inbound", "deadline"]
    assert body["daily_cost_cents"] == 150 and body["max_proposals"] == 2
    bad = await client.patch(f"/api/departments/{team.id}/awareness", json={"follows": ["gossip"]}, headers=headers)
    assert bad.status_code == 400
    view = await client.get(f"/api/departments/{team.id}/awareness", headers=headers)
    assert view.json()["follows"] == ["inbound", "deadline"]


@pytest.mark.asyncio
async def test_event_wakes_the_lead_once_per_window_and_respects_the_cap(client: AsyncClient, session_override):
    tenant, _owner, lead, _team, _flow, label = await _department(session_override)
    signal = await _ticket(session_override, tenant, label)

    def event(actor_type: str = "user", actor_id: str = "") -> SignalEvent:
        ev = SignalEvent(
            signal_id=signal.id, tenant_id=tenant.id, event_type="ticket_stage_changed",
            actor_type=actor_type, actor_id=actor_id, payload_json="{}",
        )
        session_override.add(ev)
        return ev

    first = await wake_for_events(session_override, [event()])
    assert [r["outcome"] for r in first] == ["queued"] and first[0]["agent_id"] == str(lead.id)
    second = await wake_for_events(session_override, [event()])
    assert [r["outcome"] for r in second] == ["duplicate"]
    own = await wake_for_events(session_override, [event("agent", str(lead.id))])
    assert own == []

    agent = await session_override.get(Agent, lead.id)
    set_awareness(agent, {"follows": ["deadline"]})
    session_override.add(agent)
    await session_override.flush()
    assert await wake_for_events(session_override, [event()]) == []

    set_awareness(agent, {"follows": ["stage_change"], "daily_cost_cents": 0})
    session_override.add(agent)
    await session_override.flush()
    capped = await wake_for_events(session_override, [event()])
    assert [r["outcome"] for r in capped] == ["cost_cap"]


def test_quiet_hours_wrap_midnight_and_urgency_scores():
    reach = parse_reach({"quiet_from": "22:00", "quiet_to": "07:00"})
    # 23:30 UTC is after midnight in Amsterdam; 11:00 UTC is midday.
    assert in_quiet_hours(reach, datetime(2026, 6, 1, 23, 30)) is True
    assert in_quiet_hours(reach, datetime(2026, 6, 1, 11, 0)) is False
    now = datetime.utcnow()
    late = Signal(tenant_id=uuid4(), channel="email", subject="x", due_at=now - timedelta(hours=1))
    assert urgency(None, late, now) >= 0.6
    assert urgency(None, Signal(tenant_id=uuid4(), channel="email", subject="x"), now) == 0.0


async def _department_decision(session, tenant, team, *, due_at=None) -> tuple[Signal, DecisionRequest]:
    signal = Signal(tenant_id=tenant.id, channel="internal", subject="Budget juni", due_at=due_at)
    session.add(signal)
    await session.flush()
    card = SignalMessage(
        signal_id=signal.id, tenant_id=tenant.id, kind="decision_request", direction="inbound", body_text="Budget?"
    )
    session.add(card)
    await session.flush()
    decision = DecisionRequest(
        tenant_id=tenant.id, signal_id=signal.id, message_id=card.id, title="Approve the budget",
        status="awaiting_human", addressee_kind="department", addressee_department_id=team.id,
    )
    session.add(decision)
    await session.commit()
    return signal, decision


async def _reach_events(session, signal_id) -> list[dict]:
    rows = (
        await session.execute(
            select(SignalEvent.payload_json).where(
                SignalEvent.signal_id == signal_id, SignalEvent.event_type == REACH_EVENT
            )
        )
    ).scalars().all()
    return [json.loads(r) for r in rows]


@pytest.mark.asyncio
async def test_reach_ladder_pushes_urgent_department_work_within_quiet_hours_and_daily_max(
    client: AsyncClient, session_override
):
    tenant, owner, _lead, team, _flow, _label = await _department(session_override, with_flow=False)
    session_override.add(
        PushSubscription(
            tenant_id=tenant.id, user_id=owner.id,
            endpoint=f"expo:ExponentPushToken[{uuid4()}]", keys_json='{"provider": "expo"}',
        )
    )
    await session_override.commit()

    with patch("app.services.push._send_expo_push", new_callable=AsyncMock) as expo:
        expo.return_value = True
        # Force "not quiet" for the urgent delivery path so the suite is not
        # timezone-/time-of-day dependent; the night block below patches quiet on.
        with patch("app.services.reach.in_quiet_hours", return_value=False):
            calm, calm_decision = await _department_decision(session_override, tenant, team)
            assert await notify_decision(session_override, calm_decision) == 0
            assert await _reach_events(session_override, calm.id) == []

            urgent, urgent_decision = await _department_decision(
                session_override, tenant, team, due_at=datetime.utcnow() - timedelta(hours=2)
            )
            assert await notify_decision(session_override, urgent_decision) == 1
        payload = expo.await_args.args[3]
        assert payload["category"] == "decision" and payload["urgency"] >= 0.6
        events = await _reach_events(session_override, urgent.id)
        assert events[0]["status"] == "delivered" and events[0]["department_id"] == str(team.id)
        assert events[0]["recipient_name"]

        await save_prefs(session_override, tenant.id, owner.id, {"reach": {"max_per_day": 1}})
        await session_override.commit()
        with patch("app.services.reach.in_quiet_hours", return_value=False):
            capped, capped_decision = await _department_decision(
                session_override, tenant, team, due_at=datetime.utcnow() - timedelta(hours=2)
            )
            assert await notify_decision(session_override, capped_decision) == 0
        assert (await _reach_events(session_override, capped.id))[0]["status"] == "daily_max"

        await save_prefs(
            session_override, tenant.id, owner.id, {"reach": {"max_per_day": 50, "quiet_from": "00:00", "quiet_to": "23:59"}}
        )
        await session_override.commit()
        night, night_decision = await _department_decision(
            session_override, tenant, team, due_at=datetime.utcnow() - timedelta(hours=2)
        )
        with patch("app.services.reach.in_quiet_hours", return_value=True):
            assert await notify_decision(session_override, night_decision) == 0
        assert (await _reach_events(session_override, night.id))[0]["status"] == "quiet_hours"


@pytest.mark.asyncio
async def test_call_me_rings_and_is_a_reach_event(client: AsyncClient, session_override, monkeypatch):
    monkeypatch.setattr(get_settings(), "agent_calls_enabled", True)
    headers = await _headers(client)
    tenant, _owner, _lead, team, _flow, _label = await _department(session_override, with_flow=False)
    signal, decision = await _department_decision(session_override, tenant, team)

    res = await client.post("/api/calls/request", json={"decision_id": str(decision.id)}, headers=headers)
    assert res.status_code == 200 and res.json()["status"] == "ringing"
    again = await client.post("/api/calls/request", json={"decision_id": str(decision.id)}, headers=headers)
    assert again.json()["call_id"] == res.json()["call_id"]
    events = await _reach_events(session_override, signal.id)
    assert [e["channel"] for e in events] == ["call"]


@pytest.mark.asyncio
async def test_module_joins_an_existing_department_and_uninstall_keeps_it(client: AsyncClient, session_override):
    headers = await _headers(client)
    tenant, owner, _lead, team, _flow, _label = await _department(session_override, with_flow=False)
    team.name = "Finance"
    team_id = team.id
    session_override.add(team)
    await session_override.commit()

    plan = await client.get("/api/integrations/modules/accounting/install-plan", headers=headers)
    assert plan.status_code == 200
    body = plan.json()
    assert body["ships"]["specialist"]
    assert str(team_id) in [c["id"] for c in body["candidates"]]

    installed = await client.patch(
        "/api/integrations/modules/accounting",
        json={"action": "install", "department_id": str(team_id), "accountable_user_id": str(owner.id), "specialist_leads": False},
        headers=headers,
    )
    assert installed.status_code == 200, installed.text
    session_override.expire_all()
    dept = await session_override.get(Department, team_id)
    assert dept.origin_module_slug == "accounting"

    removed = await client.patch("/api/integrations/modules/accounting", json={"action": "uninstall"}, headers=headers)
    assert removed.status_code == 200, removed.text
    assert removed.json()["module"].get("department_kept") is True
    session_override.expire_all()
    dept = await session_override.get(Department, team_id)
    assert dept.deleted_at is None and dept.origin_module_slug is None


@pytest.mark.asyncio
async def test_grid_puts_flows_in_their_department_lane(client: AsyncClient, session_override):
    headers = await _headers(client)
    _tenant, _owner, _lead, team, flow, _label = await _department(session_override)
    grid = (await client.get("/api/org/flow", headers=headers)).json()
    nodes = {n["id"]: n for n in grid["nodes"]}
    assert nodes[f"flow:{flow.id}"]["zones"] == [str(team.id)]
    zone = next(z for z in grid["zones"] if z["id"] == str(team.id))
    assert zone["href"] == f"/departments/{team.id}"
    for issue in grid.get("issues") or []:
        assert issue["department_id"] and "lead" in issue


@pytest.mark.asyncio
async def test_overview_and_folder_show_who_works_where(client: AsyncClient, session_override):
    headers = await _headers(client)
    tenant, _owner, _lead, team, flow, label = await _department(session_override)
    folder = Project(tenant_id=tenant.id, name="Klant A", slug=f"klant-a-{uuid4().hex[:6]}", department_id=team.id)
    session_override.add(folder)
    await session_override.flush()
    await _ticket(session_override, tenant, label, project_id=folder.id, due_at=datetime.utcnow() - timedelta(days=1))

    overview = (await client.get(f"/api/departments/{team.id}/overview", headers=headers)).json()
    stage = overview["flows"][0]["stages"][0]
    assert stage["key"] == "brief" and stage["count"] == 1 and stage["overdue"] == 1
    assert {"key": "unassigned", "count": 1} in overview["today"]["bottlenecks"]
    assert overview["lands"][0]["id"] == str(folder.id) and overview["lands"][0]["home"] is True
    assert overview["room_signal_id"] and overview["awareness"]["follows"]

    detail = (await client.get(f"/api/folders/{folder.id}", headers=headers)).json()
    assert detail["departments"][0]["id"] == str(team.id) and detail["departments"][0]["home"] is True
