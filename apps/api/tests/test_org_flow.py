"""The Grid data: channels, executors in zones, flows and results."""

import json
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.channel import ChannelAccount
from app.models.notification import DecisionRequest
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.signal import Signal, SignalMessage, SignalTag, SignalTagLink
from app.models.team import Department, DepartmentMember
from app.services import deliveries, org_flow, works_in


async def _seed(session):
    tenant = Tenant(
        slug=f"grid-{uuid4().hex[:6]}",
        name="Acme",
        settings_json=json.dumps({"ai_handling": {"default": {"mode": "autonomous"}, "ceiling": "autonomous"}}),
    )
    session.add(tenant)
    await session.flush()
    support = Department(tenant_id=tenant.id, name="Support", pickup="agent_first")
    dev = Department(tenant_id=tenant.id, name="Development")
    session.add_all([support, dev])
    await session.flush()
    email = ChannelAccount(
        tenant_id=tenant.id, channel="email", provider="mock", address="help@acme.test", routing_department_id=support.id
    )
    chat = ChannelAccount(tenant_id=tenant.id, channel="widget", provider="widget", address="acme")
    ava = Agent(tenant_id=tenant.id, name="Ava")
    bram = Agent(tenant_id=tenant.id, name="Bram")
    helper = Agent(tenant_id=tenant.id, name="Bokito", acts_for_user=True)
    person = User(email=f"lisa-{uuid4().hex[:4]}@acme.test", display_name="Lisa", hashed_password="x")
    folder = Project(tenant_id=tenant.id, name="Klant A", slug=f"klant-{uuid4().hex[:4]}")
    billing_flow = Workstream(tenant_id=tenant.id, name="Billing")
    bug_flow = Workstream(tenant_id=tenant.id, name="Bugs")
    session.add_all([email, chat, ava, bram, helper, person, folder, billing_flow, bug_flow])
    await session.flush()
    billing = SignalTag(tenant_id=tenant.id, name="billing", workstream_id=billing_flow.id)
    bug = SignalTag(tenant_id=tenant.id, name="bug", workstream_id=bug_flow.id, color="orange", icon="bug")
    vip = SignalTag(tenant_id=tenant.id, name="vip")
    session.add_all([billing, bug, vip])
    session.add_all(
        [
            DepartmentMember(tenant_id=tenant.id, department_id=support.id, member_kind="agent", agent_id=ava.id),
            DepartmentMember(tenant_id=tenant.id, department_id=dev.id, member_kind="agent", agent_id=ava.id),
            DepartmentMember(tenant_id=tenant.id, department_id=dev.id, member_kind="user", user_id=person.id),
        ]
    )
    await session.flush()

    def conv(account, *, agent=None, user=None, tag=None, status="open", **extra):
        kwargs = {}
        if agent is not None:
            kwargs.update(assignee_kind="agent", assignee_id=agent.id, agent_id=agent.id)
        if user is not None:
            kwargs.update(assignee_kind="user", assignee_id=user.id)
        if tag is not None:
            kwargs.update(ticket_tag_id=tag.id, stage_key="open", ticket_status="open")
        signal = Signal(
            tenant_id=tenant.id,
            channel=account.channel,
            channel_account_id=account.id,
            status=status,
            **kwargs,
            **extra,
        )
        session.add(signal)
        return signal

    s = {
        "s1": conv(email, agent=ava, tag=billing),
        "s2": conv(email, agent=ava, tag=billing, status="closed"),
        "s3": conv(email, agent=ava),
        "s4": conv(chat, agent=bram, tag=bug),
        "s5": conv(chat, user=person, status="closed"),
        "s6": conv(chat),
        "s7": conv(email, user=person, tag=bug, project_id=folder.id),
        "s8": conv(email, agent=ava, tag=billing),
        "s9": conv(email, status="closed"),
        "old": conv(email, agent=ava, status="closed", last_message_at=datetime.utcnow() - timedelta(days=30)),
    }
    await session.flush()
    session.add(SignalTagLink(signal_id=s["s1"].id, tag_id=vip.id, tenant_id=tenant.id))
    session.add(SignalTagLink(signal_id=s["s3"].id, tag_id=vip.id, tenant_id=tenant.id))
    session.add(SignalMessage(signal_id=s["s2"].id, tenant_id=tenant.id, direction="outbound", kind="user_message", body_text="Done"))
    decision = DecisionRequest(tenant_id=tenant.id, signal_id=s["s3"].id, title="Send this reply?")
    session.add(decision)
    await session.flush()
    session.add(
        SignalMessage(signal_id=s["s3"].id, tenant_id=tenant.id, kind="decision_request", direction="outbound", decision_id=decision.id)
    )
    await deliveries.record_delivery(session, tenant.id, s["s1"].id, target_kind="folder", folder_id=folder.id, ref="pr-1")
    await deliveries.record_delivery(session, tenant.id, s["s8"].id, target_kind="reply", ref="m8", channel="email")
    await session.commit()
    return {
        "tenant": tenant, "support": support, "dev": dev, "email": email, "chat": chat, "ava": ava, "bram": bram,
        "helper": helper, "person": person, "folder": folder, "billing_flow": billing_flow, "bug_flow": bug_flow,
        "billing": billing, "bug": bug, "vip": vip, **s,
    }


def _path(body, source, target):
    return next((p for p in body["paths"] if p["source"] == source and p["target"] == target), None)


def _node(body, node_id):
    return next(n for n in body["nodes"] if n["id"] == node_id)


@pytest.mark.asyncio
async def test_paths_modes_and_results(session_override):
    d = await _seed(session_override)
    body = await org_flow.build_org_flow(session_override, d["tenant"], None)
    assert body["layers"] == ["input", "executor", "work", "result"]
    email, chat = f"channel:{d['email'].id}", f"channel:{d['chat'].id}"
    ava, lisa = f"agent:{d['ava'].id}", f"user:{d['person'].id}"
    billing, bugs = f"flow:{d['billing_flow'].id}", f"flow:{d['bug_flow'].id}"
    folder = f"folder:{d['folder'].id}"

    nodes = {n["id"]: n for n in body["nodes"]}
    assert (nodes[bugs]["color"], nodes[bugs]["icon"]) == ("orange", "bug")
    assert (nodes[billing]["color"], nodes[billing]["icon"]) == ("sky", "route")
    assert _path(body, email, ava)["count"] == 4
    from app.services.ai_handling import resolve_for_signal

    expected = (await resolve_for_signal(session_override, d["tenant"], d["s3"])).effective
    assert _path(body, email, ava)["mode"] == expected
    assert _path(body, chat, lisa)["mode"] == "human"
    assert _path(body, chat, org_flow.UNASSIGNED)["mode"] == "none"
    assert _path(body, email, org_flow.UNASSIGNED)["count"] == 1
    assert _path(body, ava, billing)["count"] == 3

    assert _path(body, billing, folder)["count"] == 1
    assert _path(body, billing, org_flow.REPLY)["count"] == 2
    assert _path(body, ava, org_flow.SINK_OPEN)["by_label"] == {str(d["vip"].id): 1}
    assert _path(body, bugs, org_flow.SINK_OPEN)["count"] == 1
    assert _path(body, bugs, folder)["count"] == 1
    assert _path(body, lisa, org_flow.SINK_CLOSED)["count"] == 1
    assert _path(body, org_flow.UNASSIGNED, org_flow.SINK_CLOSED)["count"] == 1
    assert body["estimated"] is True
    assert _node(body, org_flow.REPLY)["channels"] == ["email"]
    assert all(p["source"] != f"channel:{d['old'].channel_account_id}" or p["count"] <= 4 for p in body["paths"])

    # The flow label wins over a free label on the same conversation.
    assert _path(body, ava, billing)["by_label"] == {str(d["billing"].id): 3}


@pytest.mark.asyncio
async def test_zones_issues_and_waiting(session_override, monkeypatch):
    monkeypatch.setattr(org_flow, "OVERLOAD_OPEN", 2)
    d = await _seed(session_override)
    body = await org_flow.build_org_flow(session_override, d["tenant"], None)
    ava = _node(body, f"agent:{d['ava'].id}")
    assert ava["zones"] == [str(d["support"].id), str(d["dev"].id)]
    assert "overloaded" in ava["issues"]
    assert ava["waiting_on_you"] == 1
    bram = _node(body, f"agent:{d['bram'].id}")
    assert bram["zones"] == [] and "no_department" in bram["issues"]
    assert _node(body, f"user:{d['person'].id}")["zones"] == [str(d["dev"].id)]
    assert ava["mark"]["name"] == d["ava"].name and ava["mark"]["avatar_kind"]
    assert _node(body, f"user:{d['person'].id}")["mark"]["avatar_kind"] in ("image", "initials")
    assert "unassigned" in _node(body, org_flow.UNASSIGNED)["issues"]
    zones = {z["id"]: z for z in body["zones"]}
    assert zones[str(d["support"].id)]["hint"] == "agent_first"
    assert org_flow.ZONE_NONE in zones
    assert all(n["id"] != f"agent:{d['helper'].id}" for n in body["nodes"])


@pytest.mark.asyncio
async def test_label_sums_and_works_in(session_override):
    d = await _seed(session_override)
    await works_in.add_item(session_override, d["tenant"].id, d["folder"].id, kind="canvas", title="Cijfers")
    body = await org_flow.build_org_flow(session_override, d["tenant"], None)
    for path in body["paths"]:
        assert sum(path["by_label"].values()) == path["count"]
    for node in body["nodes"]:
        assert sum(node["open_by_label"].values()) == node["open"]
    names = [label["name"] for label in body["labels"]]
    assert "billing" in names and "vip" in names
    assert body["labels"][-1]["id"] is None
    folder = _node(body, f"folder:{d['folder'].id}")
    expected = await works_in.works_in_items(session_override, d["tenant"].id, d["folder"].id)
    assert [i["key"] for i in folder["works_in"]] == [i["key"] for i in expected]


@pytest.mark.asyncio
async def test_counts_match_the_lists(session_override):
    from app.services.workforce_runtime import company_agents
    from app.services.workstreams import operator_flows

    d = await _seed(session_override)
    body = await org_flow.build_org_flow(session_override, d["tenant"], None)
    flows = [n for n in body["nodes"] if n["kind"] == "flow"]
    agents = [n for n in body["nodes"] if n["kind"] == "agent"]
    assert len(flows) == len(await operator_flows(session_override, d["tenant"].id)) == 2
    assert len(agents) == len(await company_agents(session_override, d["tenant"].id)) == 2


@pytest.mark.asyncio
async def test_without_deliveries_everything_is_estimated_or_sunk(session_override):
    tenant = Tenant(slug=f"grid-{uuid4().hex[:6]}", name="Empty")
    session_override.add(tenant)
    await session_override.commit()
    body = await org_flow.build_org_flow(session_override, tenant, None)
    assert body["paths"] == [] and body["estimated"] is False and body["labels"] == []


@pytest.mark.asyncio
async def test_endpoint(client, session_override):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    res = await client.get("/api/org/flow?days=7", headers=headers)
    assert res.status_code == 200, res.text
    assert set(res.json()) >= {"layers", "zones", "nodes", "paths", "labels", "estimated", "issues"}
    assert (await client.get("/api/org/flow?days=0", headers=headers)).status_code == 422


@pytest.mark.asyncio
async def test_autonomy_reason_and_thread_links(session_override):
    d = await _seed(session_override)
    body = await org_flow.build_org_flow(session_override, d["tenant"], None)
    ava = _node(body, f"agent:{d['ava'].id}")
    assert ava["autonomy_why"]["mode"] == ava["autonomy"]
    assert ava["autonomy_why"]["source"] in ("workspace", "channel", "conversation")
    assert ava["threads_href"] == f"/communication/inbox/open?agent={d['ava'].id}"
    assert _node(body, f"user:{d['person'].id}")["autonomy_why"] is None
    assert _node(body, org_flow.UNASSIGNED)["threads_href"] == "/communication/inbox/unassigned"
    assert _node(body, f"folder:{d['folder'].id}")["threads_href"] == f"/communication/folder/{d['folder'].id}"


@pytest.mark.asyncio
async def test_suggest_labels_opens_a_chat_with_the_unlabeled_work(session_override):
    from sqlalchemy import select

    d = await _seed(session_override)
    user = User(email=f"op-{uuid4().hex[:4]}@acme.test", display_name="Op", hashed_password="x")
    session_override.add(user)
    await session_override.commit()
    email = f"channel:{d['email'].id}"
    sample = await org_flow.unlabeled_sample(session_override, d["tenant"].id, email)
    assert [s.id for s in sample] == [d["s9"].id]

    created = await org_flow.open_label_suggestion(
        session_override, d["tenant"], user, email, lang="nl", is_admin=True
    )
    assert created and created["has_opener"] is True
    chat = await session_override.get(Signal, UUID(created["id"]))
    assert chat.channel == "assistant" and chat.subject.startswith("Labels voorstellen")
    opener = (
        await session_override.execute(select(SignalMessage).where(SignalMessage.signal_id == chat.id))
    ).scalars().first()
    assert f"/threads/{d['s9'].id}" in (opener.body_text or opener.body_html or "")

    # Everything at Ava carries a label, so there is nothing to suggest.
    assert await org_flow.open_label_suggestion(
        session_override, d["tenant"], user, f"agent:{d['ava'].id}", is_admin=True
    ) is None


@pytest.mark.asyncio
async def test_subfolders_count_on_their_top_folder(session_override):
    d = await _seed(session_override)
    tenant = d["tenant"]
    sub = Project(tenant_id=tenant.id, name="Offerte", slug=f"offerte-{uuid4().hex[:4]}", parent_id=d["folder"].id)
    session_override.add(sub)
    await session_override.flush()
    deeper = Project(tenant_id=tenant.id, name="Bijlagen", slug=f"bijlagen-{uuid4().hex[:4]}", parent_id=sub.id)
    session_override.add(deeper)
    await session_override.flush()
    session_override.add(
        Signal(tenant_id=tenant.id, channel="email", channel_account_id=d["email"].id, status="open",
               assignee_kind="agent", assignee_id=d["bram"].id, agent_id=d["bram"].id, project_id=deeper.id)
    )
    await session_override.commit()
    body = await org_flow.build_org_flow(session_override, tenant, None)
    ids = {n["id"] for n in body["nodes"]}
    assert f"folder:{sub.id}" not in ids and f"folder:{deeper.id}" not in ids
    top = _node(body, f"folder:{d['folder'].id}")
    assert top["children_count"] == 2
    by_id = {s["id"]: s for s in top["subfolders"]}
    assert by_id[str(deeper.id)]["count"] == 1 and by_id[str(deeper.id)]["open"] == 1
    assert by_id[str(sub.id)]["count"] == 0
    assert _path(body, f"agent:{d['bram'].id}", f"folder:{d['folder'].id}")["count"] == 1
    sample = await org_flow.unlabeled_sample(session_override, tenant.id, f"folder:{d['folder'].id}")
    assert any(s.project_id == deeper.id for s in sample)


def test_overload_is_above_fifteen_or_twice_the_median():
    assert org_flow.overload_threshold([]) == 15
    assert org_flow.overload_threshold([0, 0]) == 15
    assert org_flow.overload_threshold([10, 10, 10]) == 15
    assert org_flow.overload_threshold([1, 1, 1, 8]) == 2
    assert org_flow.overload_threshold([3, 4, 5]) == 8


@pytest.mark.asyncio
async def test_replies_per_channel(session_override):
    d = await _seed(session_override)
    body = await org_flow.build_org_flow(session_override, d["tenant"], None)
    # s8 has a delivered reply, s2 an outbound message.
    assert _node(body, f"channel:{d['email'].id}")["replies"] == 2
    assert _node(body, f"channel:{d['chat'].id}")["replies"] == 0


@pytest.mark.asyncio
async def test_closed_on_purpose_stays_out_of_the_sink(session_override):
    from app.models.signal import SignalEvent

    d = await _seed(session_override)
    tenant = d["tenant"]
    before = await org_flow.build_org_flow(session_override, tenant, None)
    sunk = _node(before, org_flow.SINK_CLOSED)["count"]
    quiet = Signal(tenant_id=tenant.id, channel="email", channel_account_id=d["email"].id, status="closed")
    outside = Signal(tenant_id=tenant.id, channel="email", channel_account_id=d["email"].id, status="closed")
    suggested = Signal(tenant_id=tenant.id, channel="email", channel_account_id=d["email"].id, status="closed")
    session_override.add_all([quiet, outside, suggested])
    await session_override.flush()
    session_override.add_all([
        SignalEvent(signal_id=quiet.id, tenant_id=tenant.id, event_type="no_reply_noted", payload_json="{}"),
        SignalEvent(signal_id=outside.id, tenant_id=tenant.id, event_type="handled_externally", payload_json="{}"),
        SignalEvent(signal_id=suggested.id, tenant_id=tenant.id, event_type="suggestion_created",
                    payload_json=json.dumps({"kind": "action_suggestion"})),
    ])
    await session_override.commit()
    body = await org_flow.build_org_flow(session_override, tenant, None)
    sink = _node(body, org_flow.SINK_CLOSED)
    assert sink["count"] == sunk
    assert sink["closed_on_purpose"] == {"no_reply": 2, "handled_externally": 1}


@pytest.mark.asyncio
async def test_without_flow_label_the_first_free_label_counts(session_override):
    d = await _seed(session_override)
    tenant = d["tenant"]
    alpha = SignalTag(tenant_id=tenant.id, name="alpha")
    session_override.add(alpha)
    signal = Signal(tenant_id=tenant.id, channel="widget", channel_account_id=d["chat"].id, status="open",
                    assignee_kind="agent", assignee_id=d["bram"].id, agent_id=d["bram"].id)
    session_override.add(signal)
    await session_override.flush()
    now = datetime.utcnow()
    session_override.add(SignalTagLink(signal_id=signal.id, tag_id=alpha.id, tenant_id=tenant.id, created_at=now))
    session_override.add(
        SignalTagLink(signal_id=signal.id, tag_id=d["vip"].id, tenant_id=tenant.id, created_at=now - timedelta(hours=1))
    )
    await session_override.commit()
    body = await org_flow.build_org_flow(session_override, tenant, None)
    path = _path(body, f"channel:{d['chat'].id}", f"agent:{d['bram'].id}")
    assert path["by_label"].get(str(d["vip"].id)) == 1 and str(alpha.id) not in path["by_label"]


@pytest.mark.asyncio
async def test_works_in_marks_what_lives_in_bokito(session_override):
    d = await _seed(session_override)
    await works_in.add_item(session_override, d["tenant"].id, d["folder"].id, kind="canvas", title="Cijfers")
    body = await org_flow.build_org_flow(session_override, d["tenant"], None)
    items = _node(body, f"folder:{d['folder'].id}")["works_in"]
    assert items and all(i["in_bokito"] == (i["origin"] == "bokito") for i in items)
    assert any(i["kind"] == "canvas" and i["in_bokito"] for i in items)
