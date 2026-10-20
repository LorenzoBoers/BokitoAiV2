"""Platform skills: fixed skills in the prompt by tool; operators see only a name."""

from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.services.platform_skills import catalog, platform_skills_block, platform_skills_for


def test_labels_skill_follows_the_label_tools():
    assert [s.slug for s in platform_skills_for(["set_thread_tags"])] == ["labels"]
    assert platform_skills_for(["send_reply", "list_threads"]) == []
    block = platform_skills_block([{"name": "record_thread_read"}])
    assert "propose_label_plan" in block
    assert platform_skills_block([{"name": "send_reply"}]) == ""


def test_catalog_has_no_body():
    rows = catalog("nl")
    labels = next(r for r in rows if r["slug"] == "labels")
    assert labels["locked"] is True
    assert labels["name"] and labels["description"]
    assert set(labels) == {"slug", "name", "description", "locked"}


@pytest.mark.asyncio
async def test_api_lists_names_only(client: AsyncClient, session_override):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    res = await client.get("/api/workspace/platform-skills?lang=en", headers=headers)
    assert res.status_code == 200, res.text
    skills = res.json()["skills"]
    assert any(s["slug"] == "labels" for s in skills)
    assert "propose_label_plan" not in res.text


@pytest.mark.asyncio
async def test_prompt_carries_the_skill_for_label_tools(session_override):
    from app.models.agent import Agent
    from app.models.auth import Tenant
    from app.services.agent.loop import AgentLoop

    tenant = Tenant(slug=f"skills-{uuid4().hex[:6]}", name="Acme")
    session_override.add(tenant)
    await session_override.flush()
    agent = Agent(tenant_id=tenant.id, name="Ava", system_prompt="You help.")
    session_override.add(agent)
    await session_override.flush()
    loop = AgentLoop(session_override, tenant.id, None, agent=agent)
    loop.tools = [{"name": "set_thread_tags"}]
    prompt = await loop._build_system_prompt()
    assert "## Skill: labels" in prompt
    loop.tools = [{"name": "send_reply"}]
    prompt = await loop._build_system_prompt()
    assert "## Skill: labels" not in prompt
