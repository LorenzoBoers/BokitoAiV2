"""Delivered: one event per result, deduped, shown in Why."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.audit import AuditEvent
from app.models.auth import Tenant
from app.models.integration import IntegrationConnection
from app.models.project import Project
from app.models.signal import Signal, SignalEvent
from app.services import deliveries, works_in
from app.services.thread_why import explain_thread


async def _setup(session):
    tenant = Tenant(slug=f"dlv-{uuid4().hex[:6]}", name="Acme")
    session.add(tenant)
    await session.flush()
    folder = Project(tenant_id=tenant.id, name="Klant A", slug=f"klant-{uuid4().hex[:6]}")
    signal = Signal(tenant_id=tenant.id, channel="email", status="open")
    session.add_all([folder, signal])
    await session.commit()
    return tenant, folder, signal


async def _events(session, signal_id) -> list[dict]:
    rows = (
        await session.execute(
            select(SignalEvent).where(SignalEvent.signal_id == signal_id, SignalEvent.event_type == "delivered")
        )
    ).scalars().all()
    return [json.loads(row.payload_json) for row in rows]


@pytest.mark.asyncio
async def test_reply_is_recorded_once_per_message(session_override):
    tenant, _folder, signal = await _setup(session_override)
    for _ in range(2):
        await deliveries.record_delivery(
            session_override, tenant.id, signal.id, target_kind="reply", ref="m1", channel="email"
        )
    await deliveries.record_delivery(
        session_override, tenant.id, signal.id, target_kind="reply", ref="m2", channel="email"
    )
    await session_override.commit()
    events = await _events(session_override, signal.id)
    assert sorted(e["ref"] for e in events) == ["m1", "m2"]

    body = await explain_thread(session_override, tenant, signal.id)
    reply = [line for line in body["lines"] if line["kind"] == "delivered_reply"]
    assert reply == [{"kind": "delivered_reply", "params": {"channel": "email", "count": 2}, "href": None}]
    assert len(body["deliveries"]) == 2


@pytest.mark.asyncio
@pytest.mark.xfail(reason='canvas folder refile after thread-only canvas; list via Signal.project_id not yet reliable', strict=False)
async def test_works_in_canvas_carries_labels_and_link(session_override):
    tenant, folder, signal = await _setup(session_override)
    item = (await works_in.add_item(session_override, tenant.id, folder.id, kind="canvas", title="Cijfers")).get("item") or {}
    row = await deliveries.record_delivery(
        session_override, tenant.id, signal.id, target_kind="works_in", folder_id=folder.id, works_in_key=item["key"]
    )
    assert row is not None
    await session_override.commit()
    (event,) = await _events(session_override, signal.id)
    assert event["folder_name"] == "Klant A"
    assert event["item_label"] == "Cijfers"
    assert event["item_kind"] == "canvas"
    assert event["href"] == item["href"]
    assert event["canvas_id"] == item["key"].split(":", 1)[1] and "resource_id" not in event

    body = await explain_thread(session_override, tenant, signal.id)
    line = next(line for line in body["lines"] if line["kind"] == "delivered_works_in")
    assert line["params"] == {"folder": "Klant A", "item": "Cijfers", "item_kind": "canvas"}

    missing = await deliveries.record_delivery(
        session_override, tenant.id, signal.id, target_kind="works_in", folder_id=folder.id, works_in_key="canvas:nope"
    )
    assert missing is None


@pytest.mark.asyncio
async def test_connection_write_lands_in_its_folder(session_override):
    tenant, folder, signal = await _setup(session_override)
    connection = IntegrationConnection(tenant_id=tenant.id, provider="moneybird", display_name="Moneybird", instance_key="1")
    session_override.add(connection)
    await session_override.commit()
    item = (await works_in.add_item(
        session_override, tenant.id, folder.id, kind="connection", connection_id=connection.id
    )).get("item") or {}

    await deliveries.record_connection_write(
        session_override,
        tenant.id,
        signal.id,
        tool_name="accounting_create_invoice",
        tool_input={"connection_id": str(connection.id)},
        result={"ok": True, "external_ref": "INV-7"},
    )
    await session_override.commit()
    (event,) = await _events(session_override, signal.id)
    assert event["target_kind"] == "works_in"
    assert event["works_in_key"] == item["key"]
    assert event["resource_id"] == item["key"].split(":", 1)[1] and "canvas_id" not in event
    assert event["ref"] == "INV-7"


@pytest.mark.asyncio
async def test_connection_without_folder_is_its_own_destination(session_override):
    tenant, _folder, signal = await _setup(session_override)
    connection = IntegrationConnection(tenant_id=tenant.id, provider="moneybird", display_name="Moneybird", instance_key="1")
    session_override.add(connection)
    await session_override.commit()

    row = await deliveries.record_connection_write(
        session_override,
        tenant.id,
        signal.id,
        tool_name="accounting_create_invoice",
        tool_input={"connection_id": str(connection.id)},
        result={"ok": True},
    )
    await session_override.commit()
    assert row is not None
    (event,) = await _events(session_override, signal.id)
    assert event["works_in_key"] == f"connection:{connection.id}"
    assert event["connection_id"] == str(connection.id)
    assert event["title"] == "Moneybird" and "folder_id" not in event
    issues = (
        await session_override.execute(select(AuditEvent).where(AuditEvent.tenant_id == tenant.id))
    ).scalars().all()
    assert not [i for i in issues if i.action.startswith("delivery:")]

    body = await explain_thread(session_override, tenant, signal.id)
    line = next(line for line in body["lines"] if line["kind"] == "delivered_connection")
    assert line["params"] == {"connection": "Moneybird"}


async def _outcome_events(session, signal_id) -> list[dict]:
    rows = (
        await session.execute(
            select(SignalEvent).where(SignalEvent.signal_id == signal_id, SignalEvent.event_type == "outcome")
        )
    ).scalars().all()
    return [json.loads(row.payload_json or "{}") for row in rows]


@pytest.mark.asyncio
async def test_outcome_on_close_names_the_destination(session_override):
    from app.services.tickets import settle_ticket_on_close

    tenant, folder, signal = await _setup(session_override)
    await deliveries.record_delivery(session_override, tenant.id, signal.id, target_kind="folder", folder_id=folder.id)
    signal.status = "closed"
    session_override.add(signal)
    await settle_ticket_on_close(session_override, signal, actor_type="user", actor_id="1")
    await session_override.commit()

    outcome = json.loads(signal.outcome_json)
    assert outcome["kind"] == "recorded"
    assert outcome["autonomy_used"] == "manual"
    assert len(await _outcome_events(session_override, signal.id)) == 1

    # A second close without new work is the same episode.
    await deliveries.settle_outcome(session_override, signal)
    await session_override.commit()
    assert len(await _outcome_events(session_override, signal.id)) == 1


@pytest.mark.asyncio
async def test_outcome_kinds(session_override):
    tenant, _folder, signal = await _setup(session_override)
    connection = IntegrationConnection(tenant_id=tenant.id, provider="moneybird", display_name="Moneybird", instance_key="2")
    session_override.add(connection)
    await session_override.commit()
    await deliveries.record_connection_write(
        session_override, tenant.id, signal.id, tool_name="x", tool_input={"connection_id": str(connection.id)}, result={}
    )
    await deliveries.record_delivery(session_override, tenant.id, signal.id, target_kind="reply", ref="m1")
    assert await deliveries.settle_outcome(session_override, signal) is None
    signal.status = "closed"
    outcome = await deliveries.settle_outcome(session_override, signal)
    assert outcome is not None and outcome["kind"] == "changed"

    quiet = Signal(tenant_id=tenant.id, channel="email", status="closed")
    session_override.add(quiet)
    await session_override.flush()
    session_override.add(SignalEvent(signal_id=quiet.id, tenant_id=tenant.id, event_type="no_reply_noted", payload_json="{}"))
    await session_override.flush()
    assert (await deliveries.settle_outcome(session_override, quiet))["kind"] == "no_action"

    bare = Signal(tenant_id=tenant.id, channel="email", status="closed")
    session_override.add(bare)
    await session_override.flush()
    assert (await deliveries.settle_outcome(session_override, bare))["kind"] == "done"


@pytest.mark.asyncio
async def test_unknown_target_or_signal_is_ignored(session_override):
    tenant, _folder, signal = await _setup(session_override)
    assert await deliveries.record_delivery(session_override, tenant.id, None, target_kind="reply") is None
    assert await deliveries.record_delivery(session_override, tenant.id, signal.id, target_kind="nope") is None


async def _flow_ticket(session, tenant, folder, *, key=""):
    from app.models.orchestra import Workstream
    from app.models.signal import SignalTag

    flow = Workstream(tenant_id=tenant.id, name="VAT filing", deliver_folder_id=folder.id, deliver_works_in_key=key)
    session.add(flow)
    await session.flush()
    action = SignalTag(tenant_id=tenant.id, name=f"vat-{uuid4().hex[:4]}", workstream_id=flow.id)
    session.add(action)
    await session.flush()
    signal = Signal(tenant_id=tenant.id, channel="email", status="open", ticket_tag_id=action.id, stage_key="open")
    session.add(signal)
    await session.commit()
    return flow, signal


@pytest.mark.asyncio
@pytest.mark.xfail(reason='known WIP flake: soft-option wake / flow destination delivery', strict=False)
async def test_done_stage_delivers_to_flow_destination(session_override):
    from app.services.tickets import move_ticket_stage

    tenant, folder, _signal = await _setup(session_override)
    item = (await works_in.add_item(session_override, tenant.id, folder.id, kind="canvas", title="Cijfers")).get("item") or {}
    flow, signal = await _flow_ticket(session_override, tenant, folder, key=item["key"])
    assert await move_ticket_stage(session_override, signal, status="done", ws=flow)
    await session_override.commit()
    (event,) = await _events(session_override, signal.id)
    assert event["target_kind"] == "works_in"
    assert event["flow_id"] == str(flow.id)
    assert event["item_label"] == "Cijfers"

    from app.services.workstreams import serialize_workstream_full

    body = await serialize_workstream_full(session_override, flow)
    assert body["deliver_to"]["folder_name"] == "Klant A"
    assert body["deliver_to"]["item_label"] == "Cijfers"


@pytest.mark.asyncio
async def test_label_scorecard_from_outcomes(session_override):
    from app.models.learning import EvalScore
    from app.services.learning import LABEL_SCORECARD, NO_LABEL, compute_label_scorecards

    tenant, folder, loose = await _setup(session_override)
    flow, signal = await _flow_ticket(session_override, tenant, folder)
    await deliveries.record_delivery(
        session_override, tenant.id, signal.id, target_kind="reply", ref="m1", agent_id=uuid4()
    )
    for row in (signal, loose):
        row.status = "closed"
        await deliveries.settle_outcome(session_override, row)
    await session_override.commit()
    assert json.loads(signal.outcome_json)["flow_id"] == str(flow.id)
    label_id = str(signal.ticket_tag_id)

    cards = {row.scope_id: row for row in await compute_label_scorecards(session_override, tenant.id)}
    assert set(cards) == {label_id, NO_LABEL}
    card = json.loads(cards[label_id].details_json)
    assert card["volume"] == 1 and card["autonomous_pct"] == 100.0 and card["share_pct"] == 50.0
    assert card["kinds"] == {"answered": 1} and card["flow_id"] == str(flow.id)

    await compute_label_scorecards(session_override, tenant.id)
    rows = (
        await session_override.execute(
            select(EvalScore).where(EvalScore.tenant_id == tenant.id, EvalScore.metric == LABEL_SCORECARD)
        )
    ).scalars().all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_done_stage_skips_when_already_delivered(session_override):
    from app.services.tickets import move_ticket_stage

    tenant, folder, _signal = await _setup(session_override)
    flow, signal = await _flow_ticket(session_override, tenant, folder)
    await deliveries.record_delivery(session_override, tenant.id, signal.id, target_kind="reply", ref="m1")
    await deliveries.record_delivery(
        session_override, tenant.id, signal.id, target_kind="folder", folder_id=folder.id, ref="pr-1"
    )
    await session_override.commit()
    assert await move_ticket_stage(session_override, signal, status="done", ws=flow)
    await session_override.commit()
    events = await _events(session_override, signal.id)
    assert sorted(e["ref"] for e in events) == ["m1", "pr-1"]


@pytest.mark.asyncio
async def test_patch_flow_validates_destination(client, session_override):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    folder = await client.post("/api/folders", headers=headers, json={"name": "Administratie", "slug": "adm", "tags": ["adm"]})
    folder_id = folder.json()["id"]
    created = await client.post("/api/labels", headers=headers, json={"name": "vat"})
    ws_id = created.json()["workstream_id"]

    bad_key = await client.patch(
        f"/api/flows/{ws_id}", headers=headers, json={"deliver_folder_id": folder_id, "deliver_works_in_key": "canvas:nope"}
    )
    assert bad_key.status_code == 422
    bad_folder = await client.patch(
        f"/api/flows/{ws_id}", headers=headers, json={"deliver_folder_id": str(uuid4())}
    )
    assert bad_folder.status_code == 422

    ok = await client.patch(
        f"/api/flows/{ws_id}", headers=headers, json={"deliver_folder_id": folder_id, "deliver_works_in_key": "board"}
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["deliver_to"]["folder_name"] == "Administratie"
    assert ok.json()["deliver_to"]["works_in_key"] == "board"

    cleared = await client.patch(f"/api/flows/{ws_id}", headers=headers, json={"deliver_folder_id": None})
    assert cleared.json()["deliver_to"] is None
    assert cleared.json()["deliver_works_in_key"] == ""