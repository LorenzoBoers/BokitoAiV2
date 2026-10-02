"""Generalized agent resource scopes + Govern clamp on channel AI mode."""

import json
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.agent_scopes import (
    agent_scope_allows,
    check_tool_scope,
    list_agent_scopes,
    set_agent_scope,
)
from app.services.ai_handling import resolve_ai_handling


async def _tenant_agent(session: AsyncSession) -> tuple[Tenant, Agent]:
    tenant = Tenant(slug=f"scope-{uuid4().hex[:8]}", name="Scopes")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    agent = Agent(tenant_id=tenant.id, name="Scoped", kind="company")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return tenant, agent


@pytest.mark.asyncio
async def test_no_rows_means_unrestricted(session_override: AsyncSession):
    tenant, agent = await _tenant_agent(session_override)
    assert await agent_scope_allows(
        session_override, tenant.id, agent.id, "project", str(uuid4())
    )
    assert await list_agent_scopes(session_override, tenant.id, agent.id) == {}


@pytest.mark.asyncio
async def test_scope_rows_become_allowlist(session_override: AsyncSession):
    tenant, agent = await _tenant_agent(session_override)
    allowed_project = str(uuid4())
    other_project = str(uuid4())

    await set_agent_scope(
        session_override,
        tenant.id,
        agent.id,
        "project",
        [{"resource_id": allowed_project, "can_write": False}],
    )

    assert await agent_scope_allows(
        session_override, tenant.id, agent.id, "project", allowed_project
    )
    assert not await agent_scope_allows(
        session_override, tenant.id, agent.id, "project", other_project
    )
    # Read-only row: writes denied even on the allowed resource.
    assert not await agent_scope_allows(
        session_override, tenant.id, agent.id, "project", allowed_project, write=True
    )

    # Clearing restores unrestricted access.
    await set_agent_scope(session_override, tenant.id, agent.id, "project", None)
    assert await agent_scope_allows(
        session_override, tenant.id, agent.id, "project", other_project
    )


@pytest.mark.asyncio
async def test_check_tool_scope_denies_out_of_scope_project(
    session_override: AsyncSession,
):
    tenant, agent = await _tenant_agent(session_override)
    inside = str(uuid4())
    outside = str(uuid4())
    await set_agent_scope(
        session_override, tenant.id, agent.id, "project", [{"resource_id": inside}]
    )

    assert (
        await check_tool_scope(
            session_override, tenant.id, agent, {"project_id": inside}
        )
        is None
    )
    error = await check_tool_scope(
        session_override, tenant.id, agent, {"project_id": outside}
    )
    assert error is not None and "scope" in error
    # Human callers (no agent) are never scope-limited.
    assert (
        await check_tool_scope(
            session_override, tenant.id, None, {"project_id": outside}
        )
        is None
    )


def _tenant_with(settings: dict) -> Tenant:
    return Tenant(slug="clamp", name="Clamp", settings_json=json.dumps(settings))


def test_ai_handling_clamped_by_govern_allowance():
    autonomous = {"ai_handling": {"default": {"mode": "autonomous"}}}

    # Messaging "ask" caps autonomous at assisted: Govern always wins.
    asking = _tenant_with({**autonomous, "tool_allowances": {"messaging": "ask"}})
    handling = resolve_ai_handling(asking, scope="workspace")
    assert handling.effective == "assisted"
    assert handling.clamped_by == "govern"

    # Messaging "deny" caps everything at manual.
    denying = _tenant_with({**autonomous, "tool_allowances": {"messaging": "deny"}})
    assert resolve_ai_handling(denying, scope="workspace").effective == "manual"

    # Messaging "allow" keeps the configured mode.
    allowing = _tenant_with({**autonomous, "tool_allowances": {"messaging": "allow"}})
    handling = resolve_ai_handling(allowing, scope="workspace")
    assert handling.effective == "autonomous"
    assert handling.clamped_by is None

    # Manual posture (all ask) also caps at assisted.
    manual = _tenant_with({**autonomous, "autonomy_posture": "manual"})
    assert resolve_ai_handling(manual, scope="workspace").effective == "assisted"
