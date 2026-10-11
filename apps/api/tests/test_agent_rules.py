"""Agent autonomy: ceiling, exception rules, certainty, learning from decision cards."""

import json
from uuid import UUID

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.platform_change import PlatformChange
from app.services.agent_rules import (
    agent_rules,
    apply_judgement,
    check_can_grant,
    normalize_autonomy,
    parse_autonomy_level,
)
from app.services.ai_handling import resolve_ai_handling
from app.tools import execute_tool
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient, email: str = TEST_EMAIL, password: str = TEST_PASSWORD) -> dict:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _member(client: AsyncClient, owner: dict) -> dict:
    r = await client.post("/api/auth/invite", headers=owner, json={"email": "member@example.com", "role": "member"})
    assert r.status_code == 200, r.text
    r = await client.post(
        "/api/auth/accept-invite",
        json={"token": r.json()["token"], "password": "member12345", "display_name": "Member"},
    )
    assert r.status_code == 200, r.text
    return await _login(client, "member@example.com", "member12345")


async def _pin_ask(client: AsyncClient, headers: dict, tool: str = "create_task") -> None:
    r = await client.put("/api/govern/tool-overrides", headers=headers, json={"tool_name": tool, "mode": "ask"})
    assert r.status_code == 200, r.text


async def _agent(session, **fields) -> tuple[UUID, UUID]:
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = Agent(tenant_id=tenant.id, name="Billing", kind="company", **fields)
    session.add(agent)
    await session.commit()
    return tenant.id, agent.id


def test_vocabulary_and_grant_rules():
    assert normalize_autonomy("approval") == "assisted"
    assert normalize_autonomy("auto") == "autonomous"
    assert normalize_autonomy("weird") == "assisted"
    assert parse_autonomy_level("auto") == "autonomous"
    assert parse_autonomy_level("approval") == "assisted"
    with pytest.raises(HTTPException) as invalid:
        parse_autonomy_level("yolo")
    assert invalid.value.status_code == 400
    rule = {"mode": "autonomous"}
    check_can_grant(rule, None, "owner")
    check_can_grant(rule, {"mode": "autonomous"}, "member")
    with pytest.raises(HTTPException) as exc:
        check_can_grant(rule, {"mode": "assisted"}, "member")
    assert exc.value.status_code == 403
    check_can_grant({"mode": "manual"}, None, "member")


def test_certainty_and_judgement():
    rules = [{"id": "money", "text": "Ask on refunds", "mode": "assisted", "kind": "judgement"}]
    assert apply_judgement("allow", "category", rules=rules, certainty=4, rule_id="", consequential=False) == (
        "ask",
        "low_certainty",
    )
    assert apply_judgement("allow", "category", rules=rules, certainty=9, rule_id="", consequential=False)[0] == "allow"
    mode, reason = apply_judgement("allow", "category", rules=rules, certainty=9, rule_id="money", consequential=False)
    assert (mode, reason) == ("ask", "rule:money")


async def test_agent_rules_crud_and_member_cannot_grant(client: AsyncClient, session_override):
    owner = await _login(client)
    _, agent_id = await _agent(session_override)

    r = await client.get(f"/api/workforce/agents/{agent_id}/rules", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["autonomy_level"] == "assisted"

    r = await client.put(
        f"/api/workforce/agents/{agent_id}/rules",
        headers=owner,
        json={"rules": [{"text": "Create tasks yourself", "mode": "autonomous", "kind": "hard", "tool": "create_task"}]},
    )
    assert r.status_code == 200, r.text
    rule = r.json()["rules"][0]
    assert rule["mode"] == "autonomous" and rule["id"]

    r = await client.put(
        f"/api/workforce/agents/{agent_id}/rules",
        headers=owner,
        json={"rules": [{"text": "No tool", "mode": "assisted", "kind": "hard"}]},
    )
    assert r.status_code == 422

    member = await _member(client, owner)
    r = await client.put(
        f"/api/workforce/agents/{agent_id}/rules",
        headers=member,
        json={"rules": [{"text": "Send replies yourself", "mode": "autonomous", "kind": "hard", "tool": "send_reply"}]},
    )
    assert r.status_code == 403
    r = await client.put(f"/api/workforce/agents/{agent_id}/rules", headers=member, json={"autonomy_level": "autonomous"})
    assert r.status_code == 403


async def test_hard_rule_lets_agent_act_and_try_out_reports_it(client: AsyncClient, session_override):
    owner = await _login(client)
    tenant_id, agent_id = await _agent(session_override)
    await _pin_ask(client, owner)

    r = await client.post(f"/api/workforce/agents/{agent_id}/rules/test", headers=owner, json={"tool": "create_task"})
    assert r.status_code == 200, r.text
    assert r.json()["outcome"] == "asks"

    r = await client.put(
        f"/api/workforce/agents/{agent_id}/rules",
        headers=owner,
        json={"rules": [{"text": "Create tasks yourself", "mode": "autonomous", "kind": "hard", "tool": "create_task"}]},
    )
    rule_id = r.json()["rules"][0]["id"]

    r = await client.post(f"/api/workforce/agents/{agent_id}/rules/test", headers=owner, json={"tool": "create_task"})
    body = r.json()
    assert body["outcome"] == "runs"
    assert body["rule"]["id"] == rule_id

    r = await client.post(
        f"/api/workforce/agents/{agent_id}/rules/test",
        headers=owner,
        json={"tool": "create_task", "certainty": 3},
    )
    assert r.json()["outcome"] == "asks"
    assert r.json()["reason"] == "low_certainty"

    session_override.expire_all()
    agent = await session_override.get(Agent, agent_id)
    result = await execute_tool(
        session_override, tenant_id, None, "create_task", {"title": "Follow up", "certainty": 9}, agent=agent
    )
    assert result.get("task_id"), result
    session_override.expire_all()
    agent = await session_override.get(Agent, agent_id)
    assert agent_rules(agent)[0]["uses"] == 1


async def test_workspace_rules_endpoints(client: AsyncClient, session_override):
    owner = await _login(client)
    r = await client.put(
        "/api/govern/rules",
        headers=owner,
        json={"rules": [{"text": "Never close conversations", "mode": "manual", "kind": "hard", "tool": "close_thread"}]},
    )
    assert r.status_code == 200, r.text
    r = await client.get("/api/govern/rules", headers=owner)
    assert r.json()["rules"][0]["tool"] == "close_thread"
    r = await client.post("/api/govern/rules/test", headers=owner, json={"tool": "close_thread"})
    assert r.status_code == 200, r.text
    assert r.json()["reason"].startswith("rule:")


async def test_learn_from_card_owner_applies_rule_now(client: AsyncClient, session_override):
    owner = await _login(client)
    tenant_id, agent_id = await _agent(session_override)
    await _pin_ask(client, owner)
    session_override.expire_all()
    agent = await session_override.get(Agent, agent_id)

    await execute_tool(session_override, tenant_id, None, "create_task", {"title": "Call back"}, agent=agent)
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.tenant_id == tenant_id).order_by(DecisionRequest.created_at.desc())
        )
    ).scalars().first()
    options = json.loads(decision.options_json)
    assert options[0]["learn"]["agent_id"] == str(agent_id)
    assert not any(o["id"] == "always_auto" for o in options)
    decision_id = decision.id

    r = await client.post(f"/api/notifications/decisions/{decision_id}/learn", headers=owner, json={"choice": "unsure"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "collected"

    # An owner's verdict applies right away; Govern keeps it as an applied
    # change (audit + rollback) instead of a draft to confirm.
    r = await client.post(f"/api/notifications/decisions/{decision_id}/learn", headers=owner, json={"choice": "allow"})
    assert r.status_code == 200, r.text
    assert r.json()["applied"] is True
    change_id = r.json()["change_id"]
    change = await session_override.get(PlatformChange, UUID(change_id))
    assert change.resource_type == "agent_rule"
    assert change.status == "applied_yolo"

    session_override.expire_all()
    agent = await session_override.get(Agent, agent_id)
    rules = agent_rules(agent)
    assert rules and rules[0]["tool"] == "create_task" and rules[0]["mode"] == "autonomous"


def test_agent_ceiling_clamps_ai_handling():
    tenant = Tenant(name="T", slug="t", settings_json=json.dumps({"tool_allowances": {"messaging": "allow"}}))
    agent = Agent(tenant_id=tenant.id, name="Careful", kind="company", autonomy_level="manual")
    handling = resolve_ai_handling(tenant, scope="workspace", agent=agent)
    assert handling.ceiling == "manual"
    if handling.requested != "manual":
        assert handling.clamped_by == "agent"
