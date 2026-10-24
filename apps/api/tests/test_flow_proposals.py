"""Scorecard proposals by the department lead, with a cooldown."""

import json
from datetime import datetime
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.orchestra import Workstream
from app.models.platform_change import PlatformChange
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.flow_proposals import accepted_improvements, propose_from_scorecards
from app.services.teams import create_team, set_team_members


async def _setup(session, *, autonomy: str, outcomes: list[dict]):
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars().first()
    team = await create_team(session, tenant.id, name="Content", description="", pickup="people", members=[])
    await set_team_members(session, team, [{"kind": "agent", "id": str(agent.id), "duty": "primary"}])
    flow = Workstream(tenant_id=tenant.id, name="Maandcontent", department_id=team.id, autonomy=autonomy)
    session.add(flow)
    await session.flush()
    holder = Signal(tenant_id=tenant.id, channel="email", source="email", subject="x")
    session.add(holder)
    await session.flush()
    for data in outcomes:
        session.add(SignalEvent(
            signal_id=holder.id, tenant_id=tenant.id, event_type="outcome",
            payload_json=json.dumps({"flow_id": str(flow.id), **data}),
        ))
    await session.commit()
    return tenant, flow, agent


@pytest.mark.asyncio
async def test_clean_outcomes_propose_autonomous_once(client: AsyncClient, session_override):
    tenant, flow, agent = await _setup(session_override, autonomy="assisted", outcomes=[{"corrections": 0}] * 20)
    made = await propose_from_scorecards(session_override, tenant.id)
    assert [m["target"] for m in made] == ["autonomous"]
    change = await session_override.get(PlatformChange, UUID(made[0]["change_id"]))
    assert change.status == "pending_review" and json.loads(change.after_json)["autonomy"] == "autonomous"
    message = (
        await session_override.execute(select(SignalMessage).where(SignalMessage.author_agent_id == agent.id))
    ).scalars().first()
    assert message is not None and "Maandcontent" in message.body_text
    assert await propose_from_scorecards(session_override, tenant.id) == []


@pytest.mark.asyncio
async def test_many_corrections_propose_a_step_back(client: AsyncClient, session_override):
    rows = [{"corrections": 1}] * 4 + [{"corrections": 0}] * 6
    tenant, _flow, _agent = await _setup(session_override, autonomy="autonomous", outcomes=rows)
    made = await propose_from_scorecards(session_override, tenant.id)
    assert [m["target"] for m in made] == ["assisted"]


@pytest.mark.asyncio
async def test_below_threshold_proposes_nothing(client: AsyncClient, session_override):
    tenant, _flow, _agent = await _setup(session_override, autonomy="assisted", outcomes=[{"corrections": 0}] * 5)
    assert await propose_from_scorecards(session_override, tenant.id) == []


@pytest.mark.asyncio
async def test_accepted_proposal_shows_as_improvement(client: AsyncClient, session_override):
    tenant, flow, _agent = await _setup(session_override, autonomy="assisted", outcomes=[{"corrections": 0}] * 20)
    made = await propose_from_scorecards(session_override, tenant.id)
    assert await accepted_improvements(session_override, tenant.id) == []
    change = await session_override.get(PlatformChange, UUID(made[0]["change_id"]))
    change.status = "accepted"
    change.resolved_at = datetime.utcnow()
    await session_override.commit()
    rows = await accepted_improvements(session_override, tenant.id)
    assert [(r["workstream_id"], r["flow"], r["autonomy"]) for r in rows] == [
        (str(flow.id), "Maandcontent", "autonomous"),
    ]


async def _labelled(session, **flow_fields):
    from app.models.signal import SignalTag

    tenant, flow, agent = await _setup(session, autonomy="assisted", outcomes=[])
    for key, value in flow_fields.items():
        setattr(flow, key, value)
    label = SignalTag(tenant_id=tenant.id, name="maandcontent", workstream_id=flow.id)
    session.add_all([flow, label])
    await session.commit()
    return tenant, flow, agent, label


@pytest.mark.asyncio
async def test_repeated_draft_corrections_propose_instructions(client: AsyncClient, session_override):
    from app.models.learning import Feedback

    tenant, flow, agent, _label = await _labelled(session_override, instructions="Keep it short.")
    for n in range(3):
        session_override.add(Feedback(
            tenant_id=tenant.id, subject_type="draft_edit", subject_id=f"d{n}",
            correction_key="reply:maandcontent",
            metadata_json=json.dumps({"original": "Hoi", "sent": f"Beste klant, versie {n}"}),
        ))
    await session_override.commit()
    made = await propose_from_scorecards(session_override, tenant.id)
    assert [m["kind"] for m in made] == ["instructions"]
    change = await session_override.get(PlatformChange, UUID(made[0]["change_id"]))
    after = json.loads(change.after_json)
    assert after["instructions"].startswith("Keep it short.")
    assert "Beste klant, versie 2" in after["instructions"]
    assert change.proposed_by_id == "learning:instructions" and change.agent_id == agent.id
    assert await propose_from_scorecards(session_override, tenant.id) == []


@pytest.mark.asyncio
async def test_rejected_tool_leaves_the_capabilities(client: AsyncClient, session_override):
    from app.models.notification import DecisionRequest

    tenant, _flow, _agent, label = await _labelled(
        session_override, capabilities_json=json.dumps(["send_reply", "set_thread_tags"])
    )
    ticket = Signal(tenant_id=tenant.id, channel="email", source="email", subject="t", ticket_tag_id=label.id)
    session_override.add(ticket)
    await session_override.flush()
    for _ in range(3):
        session_override.add(DecisionRequest(
            tenant_id=tenant.id, signal_id=ticket.id, title="Tags", status="rejected",
            options_json=json.dumps([
                {"id": "approve", "action_type": "set_thread_tags"},
                {"id": "reject", "action_type": "reject"},
            ]),
        ))
    await session_override.commit()
    made = await propose_from_scorecards(session_override, tenant.id)
    assert [(m["kind"], m["tool"]) for m in made] == [("capabilities", "set_thread_tags")]
    change = await session_override.get(PlatformChange, UUID(made[0]["change_id"]))
    assert json.loads(change.after_json)["capabilities"] == ["send_reply"]


@pytest.mark.asyncio
async def test_unmatched_cluster_proposes_a_flow_for_the_department(client: AsyncClient, session_override):
    from app.models.auth import User
    from app.models.signal import SignalTag
    from app.services.platform_changes import accept_platform_change
    from app.services.signal_catalog import read_backlog, record_unknown
    from scripts.seed import TEST_EMAIL

    tenant, _flow, agent = await _setup(session_override, autonomy="assisted", outcomes=[])
    for n in range(5):
        await record_unknown(
            session_override, tenant.id, name="Offerte aanvraag", sentence="Klanten vragen een offerte.",
            example=f"Mag ik een offerte {n}", agent_id=agent.id,
        )
    await session_override.refresh(tenant)
    made = await propose_from_scorecards(session_override, tenant.id)
    assert [m["kind"] for m in made] == ["new_flow"]
    change = await session_override.get(PlatformChange, UUID(made[0]["change_id"]))
    owner = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    await accept_platform_change(session_override, tenant.id, change.id, owner.id)
    await session_override.commit()
    tag = (
        await session_override.execute(
            select(SignalTag).where(SignalTag.tenant_id == tenant.id, SignalTag.name == made[0]["backlog_key"])
        )
    ).scalar_one()
    assert tag.workstream_id is not None
    team_id = (await session_override.get(Workstream, _flow.id)).department_id
    assert team_id is not None and tag.department_id == team_id
    await session_override.refresh(tenant)
    assert all(row["key"] != made[0]["backlog_key"] for row in read_backlog(tenant))


@pytest.mark.asyncio
async def test_rejecting_the_card_rejects_the_change_and_scores_the_lead(client: AsyncClient, session_override):
    from app.models.auth import User
    from app.models.learning import EvalScore, Feedback
    from app.models.notification import DecisionRequest
    from app.services.flow_proposals import score_proposers
    from app.services.notifications import resolve_decision
    from scripts.seed import TEST_EMAIL

    tenant, _flow, agent = await _setup(session_override, autonomy="assisted", outcomes=[{"corrections": 0}] * 20)
    made = await propose_from_scorecards(session_override, tenant.id)
    change = await session_override.get(PlatformChange, UUID(made[0]["change_id"]))
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.platform_change_id == change.id)
        )
    ).scalars().first()
    assert decision is not None
    owner = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    options = json.loads(decision.options_json or "[]")
    reject_id = next((o["id"] for o in options if o.get("action_type") == "reject" or o.get("id") == "reject"), "reject")
    await resolve_decision(session_override, tenant.id, decision.id, reject_id, "rejected", user_id=owner.id)
    await session_override.refresh(change)
    assert change.status == "rejected"
    feedback = (
        await session_override.execute(select(Feedback).where(Feedback.subject_type == "learning_proposal"))
    ).scalars().all()
    assert [f.subject_id for f in feedback] == [str(change.id)]
    scores = await score_proposers(session_override, tenant.id)
    await session_override.commit()
    row = next(s for s in scores if s.scope_id == str(agent.id))
    assert row.metric == "proposals_accepted_pct" and row.value == 0.0 and row.sample_size == 1
    assert (await session_override.get(EvalScore, row.id)) is not None


@pytest.mark.asyncio
async def test_open_proposals_show_on_the_department_page_and_in_the_briefing(client: AsyncClient, session_override):
    from app.services.awareness import department_snapshot, render_snapshot
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    tenant, flow, _agent = await _setup(session_override, autonomy="assisted", outcomes=[{"corrections": 0}] * 20)
    made = await propose_from_scorecards(session_override, tenant.id)
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    res = await client.get(f"/api/departments/{flow.department_id}/overview", headers=headers)
    assert res.status_code == 200, res.text
    rows = res.json()["proposals"]
    assert [(r["change_id"], r["kind"], r["signal_id"]) for r in rows] == [
        (made[0]["change_id"], "autonomy", made[0]["signal_id"])
    ]
    snap = await department_snapshot(session_override, tenant.id, flow.department_id)
    assert "Autonomy of flow Maandcontent: autonomous" in render_snapshot(snap)
