"""Agent loop with the mock model, knowledge search on pgvector, usage metering."""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from bokito.agent.loop import run_agent_on_conversation
from bokito.domain.conversation import Conversation
from bokito.domain.identity import Tenant
from bokito.services import work as work_svc
from tests.conftest import auth


async def test_knowledge_search(client: AsyncClient, owner: dict) -> None:
    r = await client.post(
        "/api/knowledge/docs",
        json={
            "title": "Opening hours",
            "body": "# Hours\nWe are open Monday to Friday 9:00-17:00.",
            "published": True,
        },
        headers=auth(owner),
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        "/api/knowledge/docs",
        json={"title": "Returns", "body": "Returns are accepted within 30 days with a receipt."},
        headers=auth(owner),
    )
    r = await client.get(
        "/api/knowledge/search", params={"q": "when are you open monday"}, headers=auth(owner)
    )
    hits = r.json()
    assert hits and hits[0]["title"] == "Opening hours"
    r = await client.get("/api/knowledge/docs", headers=auth(owner))
    assert len(r.json()) == 2


async def test_agent_loop_replies_with_knowledge(client: AsyncClient, owner: dict, session) -> None:
    await client.post(
        "/api/govern/policy/posture", json={"posture": "autonomous"}, headers=auth(owner)
    )
    await client.post(
        "/api/knowledge/docs",
        json={"title": "Opening hours", "body": "We are open Monday to Friday 9:00-17:00."},
        headers=auth(owner),
    )
    r = await client.post(
        "/api/conversations",
        json={"subject": "Opening hours", "body": "When are you open?", "ask_agent": True},
        headers=auth(owner),
    )
    assert r.status_code == 201, r.text
    conv_id = r.json()["id"]

    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    msgs = r.json()["items"]
    outbound = [m for m in msgs if m["direction"] == "outbound"]
    assert len(outbound) == 1
    assert outbound[0]["ai_generated"] is True
    assert "open Monday" in outbound[0]["body"]

    r = await client.get(f"/api/conversations/{conv_id}", headers=auth(owner))
    assert r.json()["status"] == "waiting"
    assert r.json()["agent_id"] is not None

    r = await client.get(f"/api/conversations/{conv_id}/usage", headers=auth(owner))
    report = r.json()
    assert report["lines"][0]["kind"] == "llm"
    assert report["lines"][0]["region"] == "eu"

    r = await client.get("/api/usage", headers=auth(owner))
    assert r.status_code == 200, r.text
    period = r.json()
    assert period["total_cost_eur"] > 0
    assert period["eu_share"] == 1.0
    assert len(period["by_day"]) == 1
    assert period["by_day"][0]["cost_eur"] == period["total_cost_eur"]

    r = await client.get("/api/runs", params={"kind": "reply"}, headers=auth(owner))
    assert r.json()[0]["status"] == "done"
    r = await client.get(f"/api/runs/{r.json()[0]['id']}", headers=auth(owner))
    assert [e["kind"] for e in r.json()["events"]][:1] == ["start"]


async def test_agent_tool_call_pauses_on_decision(
    client: AsyncClient, owner: dict, session
) -> None:
    tenant = await session.get(Tenant, uuid.UUID(owner["tenant_id"]))
    agent = await work_svc.ensure_default_agent(session, tenant.id)
    r = await client.post("/api/conversations", json={"subject": "S"}, headers=auth(owner))
    conv = await session.get(Conversation, uuid.UUID(r.json()["id"]))
    from bokito.domain.conversation import Direction, MessageKind
    from bokito.services import conversation as conv_svc

    await conv_svc.append_message(
        session,
        conv,
        kind=MessageKind.message,
        direction=Direction.inbound,
        body='/tool reply {"body": "Here is your quote for 500 EUR"}',
    )
    result = await run_agent_on_conversation(session, tenant, agent, conv)
    await session.commit()
    assert result.status == "waiting"
    assert result.decision_id is not None

    r = await client.get("/api/decisions", headers=auth(owner))
    assert len(r.json()) == 1
    r = await client.post(
        f"/api/decisions/{result.decision_id}/resolve",
        json={"option": "reject"},
        headers=auth(owner),
    )
    assert r.json()["status"] == "rejected"
    r = await client.get(f"/api/conversations/{conv.id}/messages", headers=auth(owner))
    assert not [m for m in r.json()["items"] if m["direction"] == "outbound"]

    # The paused agent run is closed with the decision instead of staying "waiting".
    r = await client.get(f"/api/runs/{result.run_id}", headers=auth(owner))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"
    assert r.json()["output"]["decision"] == "rejected"


async def test_handoff_stops_agent(client: AsyncClient, owner: dict) -> None:
    await client.post(
        "/api/govern/policy/posture", json={"posture": "autonomous"}, headers=auth(owner)
    )
    r = await client.post(
        "/api/conversations",
        json={"subject": "Angry", "body": "I want to speak to a human"},
        headers=auth(owner),
    )
    conv_id = r.json()["id"]
    r = await client.post(
        "/api/tools/execute",
        json={"name": "handoff", "args": {"conversation_id": conv_id, "reason": "escalation"}},
        headers=auth(owner),
    )
    assert r.json()["status"] == "done"
    r = await client.post(f"/api/conversations/{conv_id}/agent", headers=auth(owner))
    assert r.status_code == 200
    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    assert not [m for m in r.json()["items"] if m["direction"] == "outbound"]
    r = await client.get("/api/conversations", params={"queue": "attention"}, headers=auth(owner))
    assert [c["id"] for c in r.json()["items"]] == [conv_id]
