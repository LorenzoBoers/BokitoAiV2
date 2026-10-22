"""Ticket work: stage-entry policy, deadline proposals, checklists and the next step.

Every mechanism is a flow or workspace setting; nothing here is tenant data.
"""

import os
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.learning import Feedback
from app.models.notification import DecisionRequest
from app.models.signal import Signal
from app.services import ticket_work as work
from app.services.counts import status_counts
from app.services.tickets import update_ticket
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"

FLOWS = "/api/flows"

STAGES = [
    {"key": "intake", "name": "Intake", "kind": "open", "waiting_on": "customer"},
    {
        "key": "work",
        "name": "Work",
        "kind": "waiting",
        "waiting_on": "us",
        "exit_requires_checklist": True,
        "checklist": [
            {"key": "id_doc", "label": "ID received", "required": True, "evidence": "attachment"},
            {"key": "note", "label": "Note written"},
        ],
    },
    {"key": "done", "name": "Done", "kind": "done"},
]


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _setup(client: AsyncClient, session, name: str, **flow_patch):
    headers = await _login(client)
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    flow = (await client.post(FLOWS, headers=headers, json={"name": name})).json()
    saved = await client.patch(f"{FLOWS}/{flow['id']}", headers=headers, json={"stages": STAGES, **flow_patch})
    assert saved.status_code == 200, saved.text
    signal = Signal(tenant_id=tenant.id, channel="widget", source="widget", subject=f"{name} request")
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    filed = await client.put(f"/api/signals/{signal.id}/ticket", headers=headers, json={"tag": name})
    assert filed.status_code == 200, filed.text
    sid, tenant_id = signal.id, tenant.id
    session.expire_all()
    return headers, tenant_id, saved.json(), sid


async def _proposals(session, sid, source_type):
    rows = await session.execute(
        select(DecisionRequest).where(DecisionRequest.signal_id == sid, DecisionRequest.source_type == source_type)
    )
    return list(rows.scalars().all())


@pytest.mark.asyncio
async def test_agent_stage_move_becomes_a_proposal_by_default(client: AsyncClient, session_override):
    headers, tid, _flow, sid = await _setup(client, session_override, "aangifte")

    out = await update_ticket(session_override, tid, sid, {"stage_key": "work"}, actor_type="agent")
    assert out["stage_key"] == "intake"
    assert out["proposals_made"][0]["stage_key"] == "work"
    assert out["stage_entry"] == {"policy": "propose", "threshold": 8}
    (decision,) = await _proposals(session_override, sid, work.STAGE_PROPOSAL)
    assert decision.status == "awaiting_human"

    ticket = (await client.get(f"/api/signals/{sid}/ticket", headers=headers)).json()["ticket"]
    assert [p["kind"] for p in ticket["proposals"]] == ["stage"]

    approved = await client.post(
        f"/api/notifications/decisions/{decision.id}/approve", headers=headers, json={"option_id": "approve"}
    )
    assert approved.status_code == 200, approved.text
    session_override.expire_all()
    signal = await session_override.get(Signal, sid)
    assert signal.stage_key == "work"
    feedback = (
        (await session_override.execute(select(Feedback).where(Feedback.subject_id == str(sid)))).scalars().all()
    )
    assert [f.sentiment for f in feedback] == ["up"]


@pytest.mark.asyncio
async def test_person_move_answers_open_proposal_as_correction(client: AsyncClient, session_override):
    headers, tid, _flow, sid = await _setup(client, session_override, "bezwaar")
    await update_ticket(session_override, tid, sid, {"stage_key": "done"}, actor_type="agent")

    moved = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"stage_key": "work"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["ticket"]["proposals"] == []
    session_override.expire_all()
    (decision,) = await _proposals(session_override, sid, work.STAGE_PROPOSAL)
    assert decision.status == "deferred" and decision.chosen_option_id == "superseded"
    (fb,) = (await session_override.execute(select(Feedback).where(Feedback.subject_id == str(sid)))).scalars().all()
    assert fb.sentiment == "down"


@pytest.mark.asyncio
async def test_flow_policy_dial(client: AsyncClient, session_override):
    headers, tid, flow, sid = await _setup(
        client, session_override, "toeslag", stage_entry_policy="auto_above", stage_entry_threshold=7
    )
    assert flow["stage_entry_policy"] == "auto_above" and flow["stage_entry_threshold"] == 7

    unsure = await update_ticket(
        session_override, tid, sid, {"stage_key": "work", "certainty": 5}, actor_type="agent"
    )
    assert unsure["stage_key"] == "intake" and unsure["proposals_made"]
    sure = await update_ticket(
        session_override, tid, sid, {"stage_key": "work", "certainty": 9}, actor_type="agent"
    )
    assert sure["stage_key"] == "work"

    first = await client.patch(f"{FLOWS}/{flow['id']}", headers=headers, json={"stage_entry_policy": "first_stage"})
    assert first.status_code == 200, first.text
    with pytest.raises(HTTPException) as refused:
        await update_ticket(session_override, tid, sid, {"stage_key": "intake"}, actor_type="agent")
    assert refused.value.status_code == 409
    assert refused.value.detail["code"] == "stage_moves_by_people"

    reset = await client.patch(f"{FLOWS}/{flow['id']}", headers=headers, json={"stage_entry_threshold": -1})
    assert reset.json()["stage_entry_threshold"] is None
    bad = await client.patch(f"{FLOWS}/{flow['id']}", headers=headers, json={"stage_entry_policy": "sometimes"})
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_workspace_policy_sets_the_default(client: AsyncClient, session_override):
    headers = await _login(client)
    got = (await client.get("/api/labels/policy", headers=headers)).json()
    assert got["stage_entry_policy"] == "propose" and got["due_soon_days"] == 7
    saved = await client.put(
        "/api/labels/policy",
        headers=headers,
        json={"stage_entry_policy": "auto_above", "stage_entry_threshold": 6, "due_soon_days": 14},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["stage_entry_threshold"] == 6 and saved.json()["due_soon_days"] == 14
    bad = await client.put("/api/labels/policy", headers=headers, json={"due_soon_days": 0})
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_deadline_agent_proposes_person_sets(client: AsyncClient, session_override):
    headers, tid, _flow, sid = await _setup(client, session_override, "aanslag")
    day = (datetime.utcnow() + timedelta(days=3)).date().isoformat()

    out = await update_ticket(
        session_override,
        tid,
        sid,
        {"due_at": day, "due_source": "statutory", "due_basis": "Objection term six weeks"},
        actor_type="agent",
    )
    assert out["due"]["at"] is None and out["proposals_made"][0]["due_at"].startswith(day)
    (decision,) = await _proposals(session_override, sid, work.DUE_PROPOSAL)
    approved = await client.post(
        f"/api/notifications/decisions/{decision.id}/approve", headers=headers, json={"option_id": "approve"}
    )
    assert approved.status_code == 200, approved.text
    session_override.expire_all()
    signal = await session_override.get(Signal, sid)
    assert signal.due_at.isoformat() == f"{day}T23:59:59"
    assert signal.due_source == "statutory" and signal.due_basis == "Objection term six weeks"

    ticket = (await client.get(f"/api/signals/{sid}/ticket", headers=headers)).json()["ticket"]
    assert ticket["next_step"]["due_state"] == "soon" and ticket["next_step"]["days_left"] == 3
    assert ticket["next_step"]["waiting_on"] == "customer"

    past = (datetime.utcnow() - timedelta(days=1)).date().isoformat()
    moved = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"due_at": past})
    assert moved.json()["ticket"]["next_step"]["due_state"] == "overdue"
    counts = await status_counts(session_override, [Signal.tenant_id == tid], [Signal.id == sid])
    assert counts["overdue"] == 1

    agenda = (await client.get("/api/agenda", headers=headers, params={"sources": "deadline"})).json()["items"]
    row = next(i for i in agenda if i["kind"] == "deadline" and i["signal_id"] == str(sid))
    assert row["status"] == "overdue"

    cleared = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"due_at": None})
    assert cleared.json()["ticket"]["due"]["at"] is None


@pytest.mark.asyncio
async def test_checklist_agent_proposes_person_confirms_and_exit_gate(client: AsyncClient, session_override):
    headers, tid, _flow, sid = await _setup(client, session_override, "intake")
    moved = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"stage_key": "work"})
    assert moved.json()["ticket"]["next_step"]["missing"] == ["ID received"]

    blocked = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"stage_key": "done"})
    assert blocked.status_code == 400
    assert blocked.json()["error"]["code"] == "checklist_required"
    back = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"stage_key": "intake"})
    assert back.status_code == 200, back.text
    await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"stage_key": "work"})
    session_override.expire_all()

    out = await update_ticket(session_override, tid, sid, {"checklist": {"id_doc": "done"}}, actor_type="agent")
    item = next(i for i in out["checklist"] if i["key"] == "id-doc")
    assert item["status"] == "proposed" and out["next_step"]["to_confirm"] == 1
    still = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"stage_key": "done"})
    assert still.status_code == 400

    confirmed = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"checklist": {"id_doc": "done"}})
    assert confirmed.json()["ticket"]["next_step"]["missing"] == []
    done = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"stage_key": "done"})
    assert done.status_code == 200, done.text


@pytest.mark.asyncio
async def test_checklist_keys_are_unique_in_a_flow(client: AsyncClient, session_override):
    headers = await _login(client)
    flow = (await client.post(FLOWS, headers=headers, json={"name": "dubbel"})).json()
    stages = [
        {"key": "a", "name": "A", "kind": "open", "checklist": [{"key": "x", "label": "X"}]},
        {"key": "b", "name": "B", "kind": "done", "checklist": [{"key": "x", "label": "X again"}]},
    ]
    res = await client.patch(f"{FLOWS}/{flow['id']}", headers=headers, json={"stages": stages})
    assert res.status_code == 400


def test_due_normalizes_and_checkup_marks():
    assert work.parse_due_input("2026-11-02").isoformat() == "2026-11-02T23:59:59"
    assert work.parse_due_input("2026-11-02T10:30:00Z").isoformat() == "2026-11-02T10:30:00"

    now = datetime(2026, 10, 1, 9, 0)
    week = 7 * 1440
    assert work.checkup_next_at(now, week, None, 7) == now + timedelta(days=7)
    due = datetime(2026, 10, 5, 23, 59, 59)
    assert work.checkup_next_at(now, week, due, 7) == due - timedelta(days=1)
    assert work.checkup_next_at(now, week, datetime(2026, 9, 30), 7) == now + timedelta(days=1)
    assert work.checkup_next_at(now, 60, due, 7) == now + timedelta(minutes=60)
