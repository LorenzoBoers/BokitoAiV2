"""Agent definition: denylist, capability mode, prompt mode, skills, MCP inheritance, personas."""

import json
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services import agent_definition as ad
from app.tools.registry import filter_tools_for_agent, get_tool_definitions


def _agent(**kw) -> Agent:
    return Agent(id=uuid4(), tenant_id=uuid4(), name="A", **kw)


def _names(agent) -> set[str]:
    return {t["name"] for t in filter_tools_for_agent(get_tool_definitions(), agent)}


def test_denylist_beats_allowlist():
    agent = _agent(tools_json=json.dumps(["read_doc", "write_doc"]), disallowed_tools_json=json.dumps(["write_doc"]))
    assert _names(agent) == {"read_doc"}
    assert ad.tool_permitted(agent, "write_doc") == (False, "disallowed_tools")


def test_capability_modes():
    read_only = _names(_agent(capability_mode="read-only"))
    assert "read_doc" in read_only and "write_doc" not in read_only and "send_reply" not in read_only
    read_write = _names(_agent(capability_mode="read-write"))
    assert "write_doc" in read_write and "send_reply" not in read_write
    assert "send_reply" in _names(_agent(capability_mode="all"))


def test_mcp_inheritance():
    assert ad.mcp_server_allowed(_agent(), "linear")
    named = _agent(mcp_inheritance_json=json.dumps({"mode": "named", "servers": ["Linear"]}))
    assert ad.mcp_server_allowed(named, "linear") and not ad.mcp_server_allowed(named, "github")
    excluded = _agent(mcp_inheritance_json=json.dumps({"mode": "except", "servers": ["github"]}))
    assert ad.mcp_server_allowed(excluded, "linear") and not ad.mcp_server_allowed(excluded, "github")
    assert not ad.mcp_server_allowed(_agent(mcp_inheritance_json='{"mode": "none"}'), "linear")


def test_skills_block_and_completion_requirement():
    agent = _agent(
        skills_json=json.dumps(["playbooks/refunds.md"]),
        completion_requirement_json=json.dumps({"tool": "note_no_reply"}),
    )
    assert "playbooks/refunds.md" in ad.skills_block(agent)
    assert ad.completion_requirement(agent) == {"any_of": ["note_no_reply"], "reminder": ""}


def test_persona_model_resolution_order():
    tenant = Tenant(
        id=uuid4(),
        name="T",
        slug="t",
        settings_json=json.dumps(
            {
                "subagent_personas": {"researcher": {"instructions": "Find sources.", "model": "persona-model"}},
                "subagent_roles": {"reviewer": {"model": "role-model", "default_capability_mode": "read-only"}},
            }
        ),
    )
    parent = _agent(model="parent-model")
    seat = ad.resolve_subagent_seat(tenant, None, parent, persona_name="researcher")
    assert seat.model == "persona-model" and seat.persona.description == "Find sources."
    seat = ad.resolve_subagent_seat(tenant, None, parent, persona_name="researcher", role_name="reviewer")
    assert (seat.model, seat.capability_mode) == ("role-model", "read-only")
    seat = ad.resolve_subagent_seat(tenant, None, parent, explicit_model="x", role_name="reviewer")
    assert seat.model == "x"
    assert ad.resolve_subagent_seat(tenant, None, parent).model == "parent-model"
    with pytest.raises(ValueError):
        ad.resolve_subagent_seat(tenant, None, parent, persona_name="missing")


@pytest.mark.asyncio
async def test_definition_endpoints(client: AsyncClient, session_override):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    created = await client.post(
        "/api/workforce/agents", headers=headers, json={"name": "Def", "job_title": "Tester"}
    )
    assert created.status_code == 200, created.text
    agent_id = created.json()["agent"]["id"]
    url = f"/api/workforce/agents/{agent_id}/definition"

    assert (await client.put(url, headers=headers, json={"capability_mode": "execute"})).status_code == 422
    res = await client.put(
        url,
        headers=headers,
        json={
            "disallowed_tools": ["send_reply"],
            "capability_mode": "read-write",
            "prompt_mode": "full",
            "mcp_inheritance": {"mode": "named", "servers": ["linear"]},
        },
    )
    assert res.status_code == 200, res.text
    body = (await client.get(url, headers=headers)).json()
    assert body["disallowed_tools"] == ["send_reply"]
    assert body["capability_mode"] == "read-write"
    assert body["mcp_inheritance"] == {"mode": "named", "servers": ["linear"]}

    bad = await client.put(
        "/api/workforce/subagent-catalog", headers=headers, json={"personas": {"x": {"description": "no"}}}
    )
    assert bad.status_code == 422
    ok = await client.put(
        "/api/workforce/subagent-catalog",
        headers=headers,
        json={"personas": {"researcher": {"instructions": "Find sources.\n\nCite them."}}},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["personas"]["researcher"]["description"] == "Find sources."
