"""Product value stays on the server: prompts, visitor frames, close and ask."""

from datetime import datetime
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.gateway.manager import GatewayConnection
from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.modules.catalog import serialize_modules
from app.services.tickets import file_ticket
from app.services.thread_ask import match_soft_decision_reply
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


def test_module_catalog_omits_prompts_and_step_goals():
    modules = {row["slug"]: row for row in serialize_modules()}
    package = modules["accounting"]["package"]
    agent = package["agent_template"]
    assert "system_prompt" not in agent
    assert "extra_tools" not in agent
    assert agent["name"] == "Boekito"
    assert agent["job_title"] == "Controller"
    assert agent["avatar_shape"] == "shield"
    assert agent["role_blurb"]
    for playbook in package["playbooks"]:
        assert playbook["steps_count"] >= 1
        for step in playbook["steps"]:
            assert "goal" not in step
            assert step.get("name") or step.get("kind")


def test_soft_yes_matches_one_binary_card():
    options = [{"id": "approve", "label": "Ja"}, {"id": "reject", "label": "Nee"}]
    assert match_soft_decision_reply("Ja graag", options) == {
        "action": "approve",
        "option_id": "approve",
    }
    assert match_soft_decision_reply("nee", options)["action"] == "reject"
    many = [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}, {"id": "reject", "label": "Nee"}]
    assert match_soft_decision_reply("ja", many) is None


def test_gateway_audience_split():
    widget = GatewayConnection(None, tenant_id="t", kind="widget")  # type: ignore[arg-type]
    operator = GatewayConnection(None, tenant_id="t", kind="user")  # type: ignore[arg-type]
    widget.topics = {"signal:1"}
    operator.topics = {"signal:1"}

    def envelope(audience: str, event: str = "message") -> dict:
        return {
            "tenant_id": "t",
            "topics": ["signal:1"],
            "event": event,
            "data": {"audience": audience},
        }

    assert widget.matches(envelope("visitor")) is True
    assert widget.matches(envelope("operator")) is False
    assert widget.matches(envelope("all", "message.delta")) is True
    assert operator.matches(envelope("operator")) is True
    assert operator.matches(envelope("visitor")) is False
    assert operator.matches(envelope("all", "message.delta")) is True


@pytest.mark.asyncio
async def test_openapi_root_is_hidden(client: AsyncClient):
    hidden = await client.get("/openapi.json")
    assert hidden.status_code == 404
    public = await client.get("/api/docs/openapi.json")
    assert public.status_code == 200
    assert "paths" in public.json()


@pytest.mark.asyncio
async def test_agent_list_hides_prompt_detail_keeps_it(client: AsyncClient):
    headers = await _login(client)
    listed = await client.get("/api/workforce/agents", headers=headers)
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert items
    assert all("system_prompt" not in row and "purpose" not in row for row in items)
    assert "role_slug" in items[0]

    agent_id = items[0]["id"]
    detail = await client.get(f"/api/workforce/agents/{agent_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert "system_prompt" in detail.json()["agent"]


@pytest.mark.asyncio
async def test_close_asks_for_stage_fields_then_closes(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    created = await client.post("/api/labels", headers=headers, json={"name": "klacht-close"})
    assert created.status_code == 200, created.text
    body = created.json()
    stages = [
        {"name": "Open", "kind": "open"},
        {
            "name": "Klaar",
            "kind": "done",
            "fields": [{"name": "Eindoordeel", "type": "text", "required": True}],
        },
    ]
    patched = await client.patch(
        f"/api/flows/{body['workstream_id']}", headers=headers, json={"stages": stages}
    )
    assert patched.status_code == 200, patched.text

    signal = Signal(tenant_id=tenant.id, channel="widget", source="widget", subject="Close me")
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)
    await file_ticket(
        session_override,
        tenant.id,
        signal_id=signal.id,
        tag_id=UUID(body["id"]),
        certainty=10,
        actor="agent",
    )

    blocked = await client.post(f"/api/signals/{signal.id}/close", headers=headers, json={})
    assert blocked.status_code == 409, blocked.text
    err = blocked.json()["error"]
    assert err["code"] == "stage_fields_required"
    await session_override.refresh(signal)
    assert signal.status != "closed"

    field_key = err["fields"][0]["key"]
    closed = await client.post(
        f"/api/signals/{signal.id}/close",
        headers=headers,
        json={"fields": {field_key: "afgehandeld"}},
    )
    assert closed.status_code == 200, closed.text
    await session_override.refresh(signal)
    assert signal.status == "closed"
    assert signal.ticket_status == "done"


@pytest.mark.asyncio
async def test_ask_yes_resolves_one_card_without_a_session(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    signal = Signal(tenant_id=tenant.id, channel="widget", source="widget", subject="Decide")
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="decision_request",
        direction="internal",
        role="assistant",
        body_text="Doorgaan?",
        created_at=datetime.utcnow(),
    )
    session_override.add(message)
    await session_override.flush()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=signal.id,
        message_id=message.id,
        title="Doorgaan?",
        status="awaiting_human",
        options_json='[{"id":"approve","label":"Ja"},{"id":"reject","label":"Nee"}]',
    )
    session_override.add(decision)
    await session_override.flush()
    message.decision_id = decision.id
    session_override.add(message)
    await session_override.commit()

    asked = await client.post(
        f"/api/signals/{signal.id}/ask",
        headers=headers,
        json={"text": "ja"},
    )
    assert asked.status_code == 200, asked.text
    body = asked.json()
    assert body["kind"] == "decision"
    assert body["action"] == "approve"
    assert "session_id" not in body
    await session_override.refresh(decision)
    assert decision.status == "approved"
    children = (
        await session_override.execute(
            select(Signal).where(Signal.context_signal_id == signal.id)
        )
    ).scalars().all()
    assert children == []
