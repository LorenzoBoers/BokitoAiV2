"""Policy engine and the single decision path."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import select

from bokito.deps import Principal
from bokito.domain.govern import Policy
from bokito.domain.identity import Posture
from bokito.services import policy as policy_svc
from bokito.services import work as work_svc
from bokito.tools import execute_tool
from tests.conftest import auth


def _policy(posture: Posture, **kw) -> Policy:
    return Policy(
        tenant_id=uuid.uuid4(),
        posture=posture,
        allowances=kw.get("allowances", {}),
        tool_overrides=kw.get("tool_overrides", {}),
        consequential=kw.get("consequential", []),
    )


def test_evaluate_posture_defaults() -> None:
    p = _policy(Posture.assisted)
    assert (
        policy_svc.evaluate(
            p, tool_name="reply", category="communicate", consequential=False, trust="agent"
        ).verdict
        == "ask"
    )
    assert (
        policy_svc.evaluate(
            p, tool_name="add_note", category="write", consequential=False, trust="agent"
        ).verdict
        == "allow"
    )
    p = _policy(Posture.autonomous)
    assert (
        policy_svc.evaluate(
            p, tool_name="reply", category="communicate", consequential=False, trust="agent"
        ).verdict
        == "allow"
    )
    assert (
        policy_svc.evaluate(
            p, tool_name="delete_contact", category="destructive", consequential=True, trust="agent"
        ).verdict
        == "ask"
    )
    p = _policy(Posture.manual)
    assert (
        policy_svc.evaluate(
            p, tool_name="add_note", category="write", consequential=False, trust="agent"
        ).verdict
        == "ask"
    )
    assert (
        policy_svc.evaluate(
            p, tool_name="search_knowledge", category="read", consequential=False, trust="agent"
        ).verdict
        == "allow"
    )


def test_evaluate_precedence() -> None:
    p = _policy(Posture.autonomous, tool_overrides={"reply": "deny"})
    assert (
        policy_svc.evaluate(
            p, tool_name="reply", category="communicate", consequential=False, trust="agent"
        ).verdict
        == "deny"
    )
    # Operators are never asked, but deny still applies.
    assert (
        policy_svc.evaluate(
            p, tool_name="reply", category="communicate", consequential=False, trust="operator"
        ).verdict
        == "deny"
    )
    p = _policy(Posture.manual)
    assert (
        policy_svc.evaluate(
            p, tool_name="reply", category="communicate", consequential=False, trust="operator"
        ).verdict
        == "allow"
    )
    # Agent cap lowers the effective posture.
    p = _policy(Posture.autonomous)
    ev = policy_svc.evaluate(
        p,
        tool_name="reply",
        category="communicate",
        consequential=False,
        trust="agent",
        caps=[Posture.assisted],
    )
    assert ev.verdict == "ask" and ev.posture == Posture.assisted
    p = _policy(Posture.assisted, allowances={"communicate": "allow"})
    assert (
        policy_svc.evaluate(
            p, tool_name="reply", category="communicate", consequential=False, trust="agent"
        ).verdict
        == "allow"
    )


async def test_agent_reply_becomes_decision_and_resolves(
    client: AsyncClient, owner: dict, session
) -> None:
    r = await client.post(
        "/api/conversations", json={"subject": "Q", "body": "hi"}, headers=auth(owner)
    )
    conv_id = r.json()["id"]
    tenant_id = uuid.UUID(owner["tenant_id"])

    agent_row = await work_svc.ensure_default_agent(session, tenant_id)
    agent = Principal(trust="agent", tenant_id=tenant_id, agent_id=agent_row.id)
    outcome = await execute_tool(
        session,
        agent,
        "reply",
        {"conversation_id": conv_id, "body": "Auto answer"},
        conversation_id=uuid.UUID(conv_id),
    )
    await session.commit()
    assert outcome.status == "decision"
    assert outcome.decision_id is not None

    r = await client.get("/api/decisions", headers=auth(owner))
    assert [d["id"] for d in r.json()] == [str(outcome.decision_id)]
    assert r.json()[0]["tool_call"]["name"] == "reply"

    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    assert [m["kind"] for m in r.json()["items"]] == ["message", "decision"]

    r = await client.post(
        f"/api/decisions/{outcome.decision_id}/resolve",
        json={"option": "approve"},
        headers=auth(owner),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"
    assert r.json()["result"]["status"] == "done"

    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    msgs = r.json()["items"]
    sent = [m for m in msgs if m["direction"] == "outbound"]
    assert len(sent) == 1
    assert sent[0]["ai_generated"] is True
    assert "AI assistant" in sent[0]["body"]  # Art. 50 disclosure appended

    r = await client.post(
        f"/api/decisions/{outcome.decision_id}/resolve",
        json={"option": "approve"},
        headers=auth(owner),
    )
    assert r.status_code == 409

    r = await client.get("/api/runs", headers=auth(owner))
    statuses = {run["tool_name"]: run["status"] for run in r.json()}
    assert statuses["reply"] == "done"


async def test_autonomous_posture_lets_agent_reply(
    client: AsyncClient, owner: dict, session
) -> None:
    r = await client.post(
        "/api/govern/policy/posture", json={"posture": "autonomous"}, headers=auth(owner)
    )
    assert r.status_code == 200, r.text
    # set_posture is consequential but the operator acts directly: executed, not asked.
    assert r.json()["status"] == "done"
    r = await client.get("/api/govern/policy", headers=auth(owner))
    assert r.json()["posture"] == "autonomous"

    r = await client.post(
        "/api/conversations", json={"subject": "Q", "body": "hi"}, headers=auth(owner)
    )
    conv_id = uuid.UUID(r.json()["id"])
    tenant_id = uuid.UUID(owner["tenant_id"])
    agent_row = await work_svc.ensure_default_agent(session, tenant_id)
    agent = Principal(trust="agent", tenant_id=tenant_id, agent_id=agent_row.id)
    outcome = await execute_tool(
        session,
        agent,
        "reply",
        {"conversation_id": str(conv_id), "body": "ok"},
        conversation_id=conv_id,
    )
    await session.commit()
    assert outcome.status == "done"

    r = await client.get("/api/govern/changes", headers=auth(owner))
    titles = [c["title"] for c in r.json()]
    assert "Posture set to autonomous" in titles
    change = next(c for c in r.json() if c["title"] == "Posture set to autonomous")
    r = await client.post(f"/api/govern/changes/{change['id']}/rollback", headers=auth(owner))
    assert r.status_code == 200
    r = await client.get("/api/govern/policy", headers=auth(owner))
    assert r.json()["posture"] == "assisted"


async def test_denied_tool_is_audited(client: AsyncClient, owner: dict, session) -> None:
    r = await client.post(
        "/api/govern/policy/allowances",
        json={"tool_name": "add_note", "verdict": "deny"},
        headers=auth(owner),
    )
    assert r.json()["tool_overrides"] == {"add_note": "deny"}
    r = await client.post("/api/conversations", json={"subject": "Q"}, headers=auth(owner))
    conv_id = r.json()["id"]
    r = await client.post(
        f"/api/conversations/{conv_id}/notes", json={"body": "x"}, headers=auth(owner)
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "policy_denied"
    policy = await session.scalar(select(Policy))
    assert policy is not None
