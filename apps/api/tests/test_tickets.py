"""Categories are hashtags with a playbook; the conversation is the ticket."""

import os
from datetime import datetime, timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.orchestra import WorkstreamRun
from app.models.platform_change import PlatformChange
from app.models.project import Project
from app.models.signal import Signal, SignalEvent, SignalMessage, SignalTag
from app.services.tickets import ensure_platform_tags, file_ticket, update_ticket
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


async def _signal(session, tenant_id, *, subject="Ticket thread") -> Signal:
    signal = Signal(tenant_id=tenant_id, channel="widget", source="widget", subject=subject)
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


async def _assistant(session) -> Agent:
    return (await session.execute(select(Agent).where(Agent.role == "assistant"))).scalar_one()


async def _project(session, tenant_id, name="Acme") -> Project:
    """A folder with its own tag (named after the slug), like the API creates."""
    from app.services.projects import create_project

    slug = name.lower().replace(" ", "-")
    created = await create_project(
        session,
        tenant_id,
        name=name,
        slug=slug,
        autonomous_scope="project",
        tags=[slug],
    )
    return await session.get(Project, UUID(created["id"]))


async def _category(
    client: AsyncClient,
    headers,
    name: str,
    *,
    project_ids: list[str] | None = None,
    steps: list[dict] | None = None,
    stages: list[dict] | None = None,
    **config,
) -> dict:
    created = await client.post("/api/categories", headers=headers, json={"name": name})
    assert created.status_code == 200, created.text
    body = created.json()
    ws_id = body["workstream_id"]
    patch: dict = {}
    if project_ids is not None:
        patch["project_ids"] = project_ids
    if stages is not None:
        patch["stages"] = stages
    # `steps` is ignored — step engine retired.
    _ = steps
    if patch:
        res = await client.patch(f"/api/workstreams/{ws_id}", headers=headers, json=patch)
        assert res.status_code == 200, res.text
    if config:
        res = await client.patch(f"/api/categories/{body['id']}", headers=headers, json=config)
        assert res.status_code == 200, res.text
        body = res.json()
    return body


@pytest.mark.asyncio
async def test_seeds_are_free_tags_and_promote_makes_a_category(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    await ensure_platform_tags(session_override, tenant.id)
    tags = (await client.get("/api/signals/tags", headers=headers)).json()
    names = {row["name"]: row for row in tags}
    assert {"factuur", "klacht", "storing", "functieverzoek", "spam"} <= set(names)
    assert names["klacht"]["is_category"] is False
    assert (await client.get("/api/categories", headers=headers)).json()["items"] == []

    promoted = await client.post(
        f"/api/signals/tags/{names['klacht']['id']}/promote", headers=headers, json={}
    )
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["is_category"] is True
    assert promoted.json()["show_in_nav"] is True
    categories = (await client.get("/api/categories", headers=headers)).json()["items"]
    assert [row["name"] for row in categories] == ["klacht"]

    nav = (await client.get("/api/signals/nav", headers=headers)).json()
    assert [row["name"] for row in nav["ticket_tags"]] == ["klacht"]

    # Deleting a seed does not bring it back on the next run.
    spam = names["spam"]["id"]
    assert (await client.delete(f"/api/signals/tags/{spam}", headers=headers)).status_code in (200, 204)
    await ensure_platform_tags(session_override, tenant.id)
    names_after = {row["name"] for row in (await client.get("/api/signals/tags", headers=headers)).json()}
    assert "spam" not in names_after


@pytest.mark.asyncio
async def test_folder_follows_from_tags(client: AsyncClient, session_override):
    """Filing in a folder adds the folder's tag; the folder follows from the tags."""
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _project(session_override, tenant.id, "Acme")
    other = await _project(session_override, tenant.id, "Other")
    repair = await _category(client, headers, "reparatie", project_ids=[str(acme.id)])
    signal = await _signal(session_override, tenant.id, subject="Broken pump")

    # No folder tag yet: the ticket is open and sits in no folder.
    plain = await client.put(
        f"/api/signals/{signal.id}/ticket", headers=headers, json={"tag_id": repair["id"]}
    )
    assert plain.status_code == 200, plain.text
    assert plain.json()["ticket"]["status"] == "open"
    assert plain.json()["ticket"]["project_id"] is None
    assert plain.json()["ticket"]["folder_path"] is None

    filed = await client.put(
        f"/api/signals/{signal.id}/ticket",
        headers=headers,
        json={"tag": "#Reparatie", "project_id": str(acme.id)},
    )
    assert filed.status_code == 200, filed.text
    ticket = filed.json()["ticket"]
    assert ticket["status"] == "open"
    assert ticket["project_id"] == str(acme.id)
    assert ticket["folder_path"]["label"].lstrip("#") == "Acme"
    thread = (await client.get(f"/api/signals/{signal.id}", headers=headers)).json()["thread"]
    assert "acme" in thread["tags"]

    def _lane(board):
        return next(lane for lane in board if lane["workstream_id"] == repair["workstream_id"])

    board = (await client.get(f"/api/folders/{acme.id}/board", headers=headers)).json()["playbooks"]
    lane = _lane(board)
    assert [t["signal_id"] for t in lane["tickets"]] == [str(signal.id)]
    assert lane["tickets"][0]["stage_key"] == lane["stages"][0]["key"]
    other_board = (await client.get(f"/api/folders/{other.id}/board", headers=headers)).json()["playbooks"]
    assert repair["workstream_id"] not in {lane["workstream_id"] for lane in other_board}

    # Out of the folder: the folder's tag goes, the ticket stays a ticket.
    moved = await client.patch(
        f"/api/signals/{signal.id}/ticket", headers=headers, json={"project_id": None}
    )
    assert moved.json()["ticket"]["project_id"] is None
    board = (await client.get(f"/api/folders/{acme.id}/board", headers=headers)).json()["playbooks"]
    assert _lane(board)["tickets"] == []
    thread = (await client.get(f"/api/signals/{signal.id}", headers=headers)).json()["thread"]
    assert "acme" not in thread["tags"]
    assert thread["ticket"]["name"] == "reparatie"
    assert thread["ticket"]["status"] == "open"

    # Tagging alone moves it: #other lands it in Other.
    tagged = await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["other"]})
    assert tagged.status_code == 200, tagged.text
    thread = (await client.get(f"/api/signals/{signal.id}", headers=headers)).json()["thread"]
    assert thread["project_id"] == str(other.id)
    events = (
        await session_override.execute(
            select(SignalEvent).where(SignalEvent.signal_id == signal.id, SignalEvent.event_type == "folder_set")
        )
    ).scalars().all()
    assert len(events) >= 3


@pytest.mark.asyncio
async def test_agent_filing_does_not_need_a_folder(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _project(session_override, tenant.id, "Acme")
    repair = await _category(client, headers, "reparatie", project_ids=[str(acme.id)])
    signal = await _signal(session_override, tenant.id)

    result = await file_ticket(
        session_override, tenant.id, signal_id=signal.id, tag_id=UUID(repair["id"]),
        certainty=10, actor="agent",
    )
    assert result["ticket"]["status"] == "open"
    assert result["ticket"]["project_id"] is None
    assert "needs_project" not in result

    accepted = await client.patch(
        f"/api/signals/{signal.id}/ticket",
        headers=headers,
        json={"project_id": str(acme.id)},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["ticket"]["project_id"] == str(acme.id)

    # Filing a proposal with status open accepts it without a folder.
    low = await _signal(session_override, tenant.id, subject="Low certainty")
    result = await file_ticket(
        session_override, tenant.id, signal_id=low.id, tag_id=UUID(repair["id"]), certainty=2, actor="agent"
    )
    assert result["ticket"]["status"] == "proposed"
    opened = await client.patch(f"/api/signals/{low.id}/ticket", headers=headers, json={"status": "open"})
    assert opened.status_code == 200, opened.text
    assert opened.json()["ticket"]["status"] == "open"


@pytest.mark.asyncio
async def test_agent_mode_and_certainty_gates(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    bug = await _category(client, headers, "storing")
    auto = await _category(client, headers, "spam", create_mode="auto")
    manual = await _category(client, headers, "callback", create_mode="manual_only")

    async def read(category, certainty):
        signal = await _signal(session_override, tenant.id, subject="Modes")
        return await file_ticket(
            session_override, tenant.id, signal_id=signal.id, tag_id=UUID(category["id"]),
            certainty=certainty, actor="agent",
        )

    low = await read(bug, 4)
    assert low["ticket"]["status"] == "proposed"
    assert low.get("proposed") is True
    assert (await read(bug, 7))["ticket"]["status"] == "open"
    assert (await read(auto, 8))["ticket"]["status"] == "proposed"
    assert (await read(auto, 9))["ticket"]["status"] == "open"
    assert (await read(manual, 10))["ticket"]["status"] == "proposed"


@pytest.mark.asyncio
async def test_one_category_per_conversation(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    bug = await _category(client, headers, "storing")
    feature = await _category(client, headers, "functieverzoek")
    signal = await _signal(session_override, tenant.id)
    await client.put(f"/api/signals/{signal.id}/ticket", headers=headers, json={"tag_id": bug["id"]})
    await client.put(f"/api/signals/{signal.id}/ticket", headers=headers, json={"tag_id": feature["id"]})
    thread = (await client.get(f"/api/signals/{signal.id}", headers=headers)).json()["thread"]
    assert thread["ticket"]["name"] == "functieverzoek"
    # The category is not repeated as a free tag.
    assert "functieverzoek" not in thread.get("tags", [])

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await file_ticket(
            session_override, tenant.id, signal_id=signal.id, tag_id=UUID(bug["id"]),
            certainty=10, actor="agent",
        )
    assert exc.value.status_code == 409

    # The category hashtag still finds the conversation in the tag filter.
    listed = await client.get("/api/signals?view=all&tag=functieverzoek", headers=headers)
    assert [row["id"] for row in listed.json()["items"]] == [str(signal.id)]


@pytest.mark.asyncio
async def test_ask_operator_decision_offers_projects(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _project(session_override, tenant.id, "Acme")
    await _category(
        client, headers, "review", project_ids=[str(acme.id)], create_mode="ask_operator"
    )
    signal = await _signal(session_override, tenant.id, subject="Ask operator")
    agent = await _assistant(session_override)
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "file_ticket",
        {"signal_id": str(signal.id), "category": "review", "certainty": 8},
        agent=agent,
        signal_id=signal.id,
        trust="external",
    )
    assert result.get("asked_operator") is True, result
    assert result["ticket"]["status"] == "waiting"
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.source_id == str(signal.id))
        )
    ).scalar_one()
    assert decision.source_type == "ticket"
    labels = [o["label"] for o in __import__("json").loads(decision.options_json)]
    assert labels == ["File this ticket", "Dismiss"]
    note = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id, SignalMessage.kind == "status_update"
            )
        )
    ).scalar_one()
    assert "asked the team" in (note.body_text or "")

    opened = await update_ticket(
        session_override, tenant.id, signal.id, {"status": "open", "project_id": str(acme.id)}
    )
    assert opened["status"] == "open"
    assert opened["project_id"] == str(acme.id)


@pytest.mark.asyncio
async def test_verify_required_without_assurance_waits(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    billing = await _category(client, headers, "factuurvraag", requires_verification=True)
    signal = await _signal(session_override, tenant.id, subject="Billing")
    result = await file_ticket(
        session_override, tenant.id, signal_id=signal.id, tag_id=UUID(billing["id"]),
        certainty=8, actor="agent",
    )
    assert result["status"] == "needs_verification"
    assert result["ticket"]["status"] == "waiting"

    signal.assurance_level = "verified"
    signal.assurance_email = "a@example.com"
    signal.assurance_expires_at = datetime.utcnow() + timedelta(minutes=30)
    signal.assurance_verified_at = datetime.utcnow()
    session_override.add(signal)
    await session_override.commit()
    opened = await file_ticket(
        session_override, tenant.id, signal_id=signal.id, tag_id=UUID(billing["id"]),
        certainty=8, actor="agent",
    )
    assert opened["ticket"]["status"] == "open"


@pytest.mark.asyncio
async def test_ticket_tools_posture_and_member_denied(client: AsyncClient, session_override):
    await _login(client)
    tenant = await _tenant(session_override)
    assert tenant_allowances(tenant)["tickets"] == "allow"
    tenant.settings_json = '{"autonomy_posture":"manual"}'
    session_override.add(tenant)
    await session_override.commit()
    session_override.expire_all()
    tenant = await _tenant(session_override)
    assert tenant_allowances(tenant)["tickets"] == "ask"

    spec = get_tool_spec("create_category")
    mode, reason = await resolve_tool_mode(session_override, tenant, None, spec, user_role="member")
    assert (mode, reason) == ("deny", "user_role")


@pytest.mark.asyncio
async def test_agent_category_change_is_a_platform_change(client: AsyncClient, session_override):
    await _login(client)
    tenant = await _tenant(session_override)
    agent = await _assistant(session_override)
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_category",
        {"name": "garantie", "description": "Warranty claims."},
        agent=agent,
        user_role=None,
    )
    assert result.get("status") in ("pending_review", "draft"), result
    change = (
        await session_override.execute(
            select(PlatformChange).where(PlatformChange.id == UUID(result["change_id"]))
        )
    ).scalar_one()
    assert change.resource_type == "category"


@pytest.mark.asyncio
async def test_signal_policy_and_backlog_promotion(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    default = await client.get("/api/categories/policy", headers=headers)
    assert default.json()["accept_roles"] == "admins"
    saved = await client.put(
        "/api/categories/policy", headers=headers, json={"accept_roles": "members", "backlog_threshold": 2}
    )
    assert saved.json()["accept_roles"] == "members"

    from app.services.signal_catalog import record_unknown

    for _ in range(2):
        await record_unknown(
            session_override,
            tenant.id,
            name="Warranty claim",
            sentence="A customer claims warranty on a delivered product.",
            example="My heat pump broke after two months.",
        )
    entry = (await client.get("/api/categories/backlog", headers=headers)).json()["items"][0]
    assert entry["count"] == 2
    promoted = await client.post(f"/api/categories/backlog/{entry['key']}/promote", headers=headers, json={})
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["name"] == "warranty_claim"
    assert promoted.json()["workstream_id"]
    assert (await client.get("/api/categories/backlog", headers=headers)).json()["items"] == []


@pytest.mark.asyncio
async def test_ticket_moves_through_playbook_stages(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    repair = await _category(client, headers, "reparatie", create_mode="auto")
    ws_id = repair["workstream_id"]
    ws = (await client.get(f"/api/workstreams/{ws_id}", headers=headers)).json()
    assert [s["kind"] for s in ws["stages"]] == ["open", "waiting", "done"]
    stages = [
        {"name": "Intake", "kind": "open"},
        {"name": "Waiting for parts", "kind": "waiting"},
        {"name": "Fixed", "kind": "done"},
        {"name": "Not repairable", "kind": "done"},
    ]
    patched = await client.patch(f"/api/workstreams/{ws_id}", headers=headers, json={"stages": stages})
    assert patched.status_code == 200
    assert [s["key"] for s in patched.json()["stages"]] == [
        "intake", "waiting-for-parts", "fixed", "not-repairable",
    ]
    no_done = await client.patch(
        f"/api/workstreams/{ws_id}", headers=headers, json={"stages": [{"name": "Only", "kind": "open"}]}
    )
    assert no_done.status_code == 400

    signal = await _signal(session_override, tenant.id, subject="Broken pump")
    result = await file_ticket(
        session_override, tenant.id, signal_id=signal.id, tag_id=UUID(repair["id"]),
        certainty=10, actor="agent",
    )
    assert result["ticket"]["status"] == "open"
    # Steps retired: filing no longer starts a workstream run.
    run = (
        await session_override.execute(select(WorkstreamRun).where(WorkstreamRun.signal_id == signal.id))
    ).scalar_one_or_none()
    assert run is None

    ticket = (await client.get(f"/api/signals/{signal.id}/ticket", headers=headers)).json()["ticket"]
    assert ticket["status"] == "open"

    moved = await client.patch(
        f"/api/signals/{signal.id}/ticket", headers=headers, json={"stage_key": "not-repairable"}
    )
    assert moved.json()["ticket"]["status"] == "done"
    unknown = await client.patch(f"/api/signals/{signal.id}/ticket", headers=headers, json={"stage_key": "nope"})
    assert unknown.status_code == 400

    events = (
        await session_override.execute(select(SignalEvent.event_type).where(SignalEvent.signal_id == signal.id))
    ).scalars().all()
    assert "category_set" in events
    assert events.count("ticket_stage_changed") >= 1


@pytest.mark.asyncio
async def test_dismissing_a_proposal_removes_the_category(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    bug = await _category(client, headers, "storing")
    signal = await _signal(session_override, tenant.id, subject="Unsure label")
    proposed = await file_ticket(
        session_override, tenant.id, signal_id=signal.id, tag_id=UUID(bug["id"]), certainty=2, actor="agent"
    )
    assert proposed["ticket"]["status"] == "proposed"
    dismissed = await client.patch(
        f"/api/signals/{signal.id}/ticket", headers=headers, json={"status": "dismissed"}
    )
    assert dismissed.json() == {"ticket": None}
    refreshed = await session_override.get(Signal, signal.id)
    await session_override.refresh(refreshed)
    assert refreshed.ticket_tag_id is None


@pytest.mark.asyncio
async def test_detaching_the_playbook_unfiles_tickets(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    bug = await _category(client, headers, "storing")
    signal = await _signal(session_override, tenant.id)
    await client.put(f"/api/signals/{signal.id}/ticket", headers=headers, json={"tag_id": bug["id"]})
    res = await client.patch(f"/api/categories/{bug['id']}", headers=headers, json={"workstream_id": None})
    assert res.status_code == 200, res.text
    tag = await session_override.get(SignalTag, UUID(bug["id"]))
    await session_override.refresh(tag)
    assert tag.workstream_id is None
    refreshed = await session_override.get(Signal, signal.id)
    await session_override.refresh(refreshed)
    assert refreshed.ticket_tag_id is None


@pytest.mark.asyncio
async def test_category_map_lists_categories(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    await _category(client, headers, "storing")
    from app.services.assistant_context import category_map_block

    block = await category_map_block(session_override, tenant.id)
    assert "#storing" in block


@pytest.mark.asyncio
async def test_action_tag_can_be_a_folder(client: AsyncClient, session_override):
    """A folder that carries an action tag collects every ticket of that tag."""
    headers = await _login(client)
    tenant = await _tenant(session_override)
    repair = await _category(client, headers, "reparatie")
    created = await client.post(
        "/api/folders",
        headers=headers,
        json={
            "name": "Reparaties",
            "slug": "reparaties",
            "tag_ids": [repair["id"]],
        },
    )
    assert created.status_code == 200, created.text
    folder = created.json()
    assert folder["tag_ids"] == [repair["id"]]
    assert folder["tag_names"] == ["reparatie"]

    signal = await _signal(session_override, tenant.id, subject="Pump")
    filed = await client.put(f"/api/signals/{signal.id}/ticket", headers=headers, json={"tag_id": repair["id"]})
    assert filed.json()["ticket"]["project_id"] == folder["id"]
    row = (await client.get("/api/categories", headers=headers)).json()["items"][0]
    assert [f["id"] for f in row["folders"]] == [folder["id"]]
    # The nav lists the tag as a folder, not twice.
    nav = (await client.get("/api/signals/nav", headers=headers)).json()
    assert nav["ticket_tags"] == []
    assert [row["id"] for row in nav["projects"]] == [folder["id"]]
    assert nav["projects"][0]["count"] == 1


@pytest.mark.asyncio
async def test_category_list_carries_folders_and_counts(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _project(session_override, tenant.id, "Acme")
    repair = await _category(client, headers, "reparatie", project_ids=[str(acme.id)])
    for subject in ("One", "Two"):
        signal = await _signal(session_override, tenant.id, subject=subject)
        filed = await client.put(
            f"/api/signals/{signal.id}/ticket",
            headers=headers,
            json={"tag_id": repair["id"], "project_id": str(acme.id)},
        )
        assert filed.status_code == 200, filed.text
    proposed = await _signal(session_override, tenant.id, subject="Unsure")
    await file_ticket(
        session_override, tenant.id, signal_id=proposed.id, tag_id=UUID(repair["id"]), certainty=2, actor="agent"
    )

    row = (await client.get("/api/categories", headers=headers)).json()["items"][0]
    assert row["folders"] == []
    assert (row["open"], row["waiting"], row["proposed"]) == (2, 0, 1)
    assert row["filed_7d"] == 2
    assert row["filed_prev_7d"] == 0


@pytest.mark.asyncio
async def test_stage_move_requires_target_fields(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    klacht = await _category(client, headers, "klacht", create_mode="auto")
    ws_id = klacht["workstream_id"]
    stages = [
        {"name": "Niet gestart", "kind": "open"},
        {"name": "Actief", "kind": "waiting"},
        {
            "name": "Klaar",
            "kind": "done",
            "fields": [{"name": "Eindoordeel", "type": "text", "required": True}],
        },
    ]
    patched = await client.patch(f"/api/workstreams/{ws_id}", headers=headers, json={"stages": stages})
    assert patched.status_code == 200, patched.text
    klaar_key = next(s["key"] for s in patched.json()["stages"] if s["kind"] == "done")

    signal = await _signal(session_override, tenant.id, subject="Broken pipe")
    await file_ticket(
        session_override, tenant.id, signal_id=signal.id, tag_id=UUID(klacht["id"]), certainty=10, actor="agent"
    )

    blocked = await client.patch(
        f"/api/signals/{signal.id}/ticket", headers=headers, json={"stage_key": klaar_key}
    )
    assert blocked.status_code == 400
    err = blocked.json()["error"]
    assert err["code"] == "stage_fields_required"
    assert any(f["key"] == "eindoordeel" for f in err["fields"])

    still = (await client.get(f"/api/signals/{signal.id}/ticket", headers=headers)).json()["ticket"]
    assert still["status"] != "done"

    moved = await client.patch(
        f"/api/signals/{signal.id}/ticket",
        headers=headers,
        json={"stage_key": klaar_key, "fields": {"eindoordeel": "Opgelost"}},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["ticket"]["status"] == "done"
    assert moved.json()["ticket"]["fields"]["eindoordeel"] == "Opgelost"

