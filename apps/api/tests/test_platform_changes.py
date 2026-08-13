import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.dependencies import tenant_settings
from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.platform_change import PlatformChange
from app.models.workspace import WorkspaceDoc
from app.services.platform_changes import accept_platform_change, propose_platform_change
from app.tools import execute_tool


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_propose_ask_creates_pending_change_and_decision(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()

    change, meta = await propose_platform_change(
        session_override,
        tenant,
        resource_type="workspace_doc",
        change_kind="create",
        after={"path": "docs/draft.md", "content": "Draft paragraph", "mode": "replace"},
        summary="Add doc",
        agent=agent,
        tool_name="write_doc",
        mode="ask",
    )
    assert meta["mode"] == "ask"
    assert change.status == "pending_review"
    assert change.decision_id is not None
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.id == change.decision_id)
        )
    ).scalar_one()
    assert decision.status == "awaiting_human"
    assert decision.signal_id is not None
    assert decision.message_id is not None


@pytest.mark.asyncio
async def test_accept_doc_change_writes_doc(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.models.auth import User

    user = (await session_override.execute(select(User).limit(1))).scalar_one()

    change, _ = await propose_platform_change(
        session_override,
        tenant,
        resource_type="workspace_doc",
        change_kind="create",
        after={"path": "docs/accepted.md", "content": "Accepted text", "mode": "replace"},
        summary="Add doc",
        user_id=user.id,
        mode="ask",
    )
    accepted = await accept_platform_change(session_override, tenant.id, change.id, user.id)
    assert accepted.status == "accepted"
    assert accepted.version == 1

    docs = (
        await session_override.execute(
            select(WorkspaceDoc).where(
                WorkspaceDoc.tenant_id == tenant.id, WorkspaceDoc.path == "docs/accepted.md"
            )
        )
    ).scalars().all()
    assert len(docs) == 1
    assert "Accepted text" in docs[0].content


@pytest.mark.asyncio
async def test_apply_mode_executes_immediately(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()

    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()
    change, meta = await propose_platform_change(
        session_override,
        tenant,
        resource_type="workspace_doc",
        change_kind="create",
        after={"path": "docs/applied.md", "content": "Applied text", "mode": "replace"},
        summary="Direct apply",
        agent=agent,
        tool_name="write_doc",
        mode="apply",
    )
    assert meta["mode"] == "apply"
    assert change.status == "applied_yolo"


@pytest.mark.asyncio
async def test_govern_changes_api(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()
    await propose_platform_change(
        session_override,
        tenant,
        resource_type="workspace_doc",
        change_kind="create",
        after={"path": "docs/x.md", "content": "t"},
        summary="Test pending",
        agent=agent,
        mode="ask",
    )
    res = await client.get("/api/govern/changes", headers=headers, params={"status": "pending_review"})
    assert res.status_code == 200
    assert len(res.json()["items"]) >= 1


@pytest.mark.asyncio
async def test_write_doc_applies_under_assisted_posture(client: AsyncClient, session_override):
    """Workspace category is 'allow' under assisted posture -> applies with audit record."""
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "write_doc",
        {"path": "docs/tool-page.md", "content": "From tool"},
        agent=agent,
    )
    assert not result.get("error")
    applied = (
        await session_override.execute(
            select(PlatformChange).where(
                PlatformChange.tenant_id == tenant.id,
                PlatformChange.status == "applied_yolo",
            )
        )
    ).scalars().all()
    assert len(applied) >= 1


@pytest.mark.asyncio
async def test_write_doc_asks_under_manual_posture(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    settings = tenant_settings(tenant)
    settings["autonomy_posture"] = "manual"
    tenant.settings_json = json.dumps(settings)
    await session_override.commit()
    session_override.expire_all()
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "write_doc",
        {"path": "docs/ask-page.md", "content": "Needs review"},
        agent=agent,
    )
    assert result.get("change_id")
    assert result.get("status") == "pending_review"
