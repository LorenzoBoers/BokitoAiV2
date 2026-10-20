"""Tool authorization pipeline: hooks, rules, grants, read-only, mode, clamps."""

import json
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.models.agent import Agent
from app.models.auth import Tenant
from app.tools import permission_rules as prules
from app.tools.policy import (
    authorize_tool_call,
    register_pre_tool_use_hook,
    unregister_pre_tool_use_hook,
)
from app.tools.registry import get_tool_spec


def _tenant(**settings) -> Tenant:
    return Tenant(id=uuid4(), name="T", slug=f"t-{uuid4().hex[:6]}", settings_json=json.dumps(settings))


async def _auth(tenant, name, tool_input=None, agent=None, **kw):
    return await authorize_tool_call(None, tenant, agent, get_tool_spec(name), tool_input=tool_input, **kw)


def test_rule_without_action_denies():
    rule = prules.parse_rule({"tool": "any"})
    assert rule.action == "deny"


def test_rule_validation():
    with pytest.raises(prules.InvalidRule):
        prules.parse_rule({"action": "allow", "tool": "bash"})
    with pytest.raises(prules.InvalidRule):
        prules.parse_rule({"action": "allow", "tool": "mcp", "pattern_mode": "domain"})
    assert prules.parse_rule({"action": "approve", "tool": "AgentMessage"}).tool == "agent_message"


def test_deny_wins_then_ask_then_allow():
    rules = [
        prules.PermissionRule(action="allow", tool="any"),
        prules.PermissionRule(action="ask", tool="category:workspace"),
        prules.PermissionRule(action="deny", tool="tool:write_doc"),
    ]
    assert prules.decide(rules, tool_name="write_doc", category="workspace", tool_input={}).action == "deny"
    assert prules.decide(rules, tool_name="read_doc", category="workspace", tool_input={}).action == "ask"
    assert prules.decide(rules, tool_name="list_tags", category="projects", tool_input={}).action == "allow"


def test_domain_and_mcp_patterns():
    domain = prules.PermissionRule(action="deny", tool="web_fetch", pattern="*.evil.com", pattern_mode="domain")
    assert prules.rule_matches(domain, tool_name="fetch_url", category="", tool_input={"url": "https://a.evil.com/x"})
    assert not prules.rule_matches(domain, tool_name="fetch_url", category="", tool_input={"url": "https://good.com"})
    mcp = prules.PermissionRule(action="allow", tool="mcp", pattern="linear:*")
    assert prules.rule_matches(
        mcp, tool_name="call_mcp_tool", category="", tool_input={"server_name": "linear", "tool_name": "save"}
    )
    assert not prules.rule_matches(
        mcp, tool_name="call_mcp_tool", category="", tool_input={"server_name": "github", "tool_name": "save"}
    )


@pytest.mark.asyncio
async def test_consequential_is_never_widened_but_can_be_denied():
    tenant = _tenant(permission_rules=[{"action": "allow", "tool": "tool:send_reply"}])
    decided = await _auth(tenant, "send_reply")
    assert (decided.mode, decided.reason, decided.stage) == ("ask", "consequential", "rules")

    tenant = _tenant(permission_rules=[{"action": "deny", "tool": "tool:send_reply"}])
    assert (await _auth(tenant, "send_reply")).mode == "deny"


@pytest.mark.asyncio
async def test_category_deny_slider_leaves_ungated_reads_alone():
    tenant = _tenant(tool_allowances={"workspace": "deny"})
    assert (await _auth(tenant, "write_doc")).mode == "deny"
    read = await _auth(tenant, "read_doc")
    assert read.mode == "allow"
    assert read.stage == "read_only"


@pytest.mark.asyncio
async def test_explicit_rule_can_deny_a_read():
    tenant = _tenant(permission_rules=[{"action": "deny", "tool": "tool:read_doc"}])
    assert (await _auth(tenant, "read_doc")).mode == "deny"


@pytest.mark.asyncio
async def test_grant_beats_mode_but_not_an_ask_rule():
    agent = Agent(
        id=uuid4(),
        tenant_id=uuid4(),
        name="A",
        settings_json=json.dumps(
            {"rules": [{"id": "g1", "text": "Write docs", "mode": "autonomous", "kind": "hard", "tool": "write_doc"}]}
        ),
    )
    tenant = _tenant(autonomy_posture="manual")
    decided = await _auth(tenant, "write_doc", agent=agent)
    assert (decided.mode, decided.stage) == ("allow", "grants")

    tenant = _tenant(autonomy_posture="manual", tool_overrides={"write_doc": "ask"})
    decided = await _auth(tenant, "write_doc", agent=agent)
    assert (decided.mode, decided.reason) == ("ask", "tool_override")


@pytest.mark.asyncio
async def test_hooks_deny_and_ask():
    async def deny_hook(*, spec, tool_input, tenant, agent, trust):
        return ("deny", "no docs today") if spec.name == "write_doc" else None

    async def ask_hook(*, spec, tool_input, tenant, agent, trust):
        return ("ask", "check reads") if spec.name == "read_doc" else ("defer", "")

    async def broken_hook(**_):
        raise RuntimeError("boom")

    for hook in (broken_hook, deny_hook, ask_hook):
        register_pre_tool_use_hook(hook)
    try:
        tenant = _tenant(autonomy_posture="autonomous")
        denied = await _auth(tenant, "write_doc")
        assert (denied.mode, denied.stage) == ("deny", "hook")
        asked = await _auth(tenant, "read_doc")
        assert (asked.mode, asked.reason) == ("ask", "hook:check reads")
        assert (await _auth(tenant, "create_task")).mode == "allow"
    finally:
        for hook in (broken_hook, deny_hook, ask_hook):
            unregister_pre_tool_use_hook(hook)


@pytest.mark.asyncio
async def test_untrusted_input_clamps_mutations_only():
    tenant = _tenant(autonomy_posture="autonomous")
    clamped = await _auth(tenant, "write_doc", tainted=True)
    assert (clamped.mode, clamped.reason) == ("ask", "clamp:untrusted_input")
    assert (await _auth(tenant, "read_doc", tainted=True)).mode == "allow"


@pytest.mark.asyncio
async def test_permission_rules_endpoint(client: AsyncClient, session_override):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    bad = await client.put("/api/govern/permission-rules", headers=headers, json={"rules": [{"tool": "bash"}]})
    assert bad.status_code == 422

    rules = [{"action": "deny", "tool": "web_fetch", "pattern": "*.evil.com", "pattern_mode": "domain"}, {"tool": "any"}]
    res = await client.put("/api/govern/permission-rules", headers=headers, json={"rules": rules})
    assert res.status_code == 200, res.text
    stored = res.json()["rules"]
    assert stored[0]["pattern_mode"] == "domain"
    assert stored[1]["action"] == "deny"

    res = await client.get("/api/govern/permission-rules", headers=headers)
    assert len(res.json()["rules"]) == 2
