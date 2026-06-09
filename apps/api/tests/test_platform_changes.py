import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.blueprint import BlueprintBlock, BlueprintPage
from app.models.platform_change import PlatformChange
from app.services.agent.tools import execute_tool
from app.services.platform_changes import accept_platform_change, propose_platform_change


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_propose_blueprint_change_creates_pending_draft(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()

    change, meta = await propose_platform_change(
        session_override,
        tenant,
        resource_type="blueprint_block",
        change_kind="create",
        after={"page_slug": "overview", "text": "Draft paragraph", "block_type": "paragraph"},
        summary="Add block",
        agent=agent,
        tool_name="write_blueprint",
    )
    assert meta["mode"] == "draft"
    assert change.status == "pending_review"


@pytest.mark.asyncio
async def test_accept_blueprint_change_writes_block(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.models.auth import User
    from app.models.blueprint import BlueprintDoc

    user = (await session_override.execute(select(User).limit(1))).scalar_one()
    doc = BlueprintDoc(tenant_id=tenant.id, title="Doc")
    session_override.add(doc)
    await session_override.flush()
    page = BlueprintPage(doc_id=doc.id, tenant_id=tenant.id, title="Overview", slug="overview", kind="page")
    session_override.add(page)
    await session_override.commit()

    change, _ = await propose_platform_change(
        session_override,
        tenant,
        resource_type="blueprint_block",
        change_kind="create",
        after={"page_slug": "overview", "text": "Accepted text", "block_type": "paragraph"},
        summary="Add block",
        user_id=user.id,
    )
    accepted = await accept_platform_change(session_override, tenant.id, change.id, user.id)
    assert accepted.status == "accepted"
    assert accepted.version == 1

    blocks = (
        await session_override.execute(
            select(BlueprintBlock).where(BlueprintBlock.tenant_id == tenant.id)
        )
    ).scalars().all()
    assert len(blocks) >= 1


@pytest.mark.asyncio
async def test_yolo_policy_applies_immediately(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.models.policy import ActionPolicy
    from app.dependencies import tenant_settings

    policy = (
        await session_override.execute(select(ActionPolicy).where(ActionPolicy.tenant_id == tenant.id))
    ).scalar_one()
    policy.mode = "yolo"
    settings = tenant_settings(tenant)
    settings["platform_apply_modes"] = {
        **settings.get("platform_apply_modes", {}),
        "blueprint_block": "yolo",
    }
    tenant.settings_json = json.dumps(settings)
    await session_override.commit()

    from app.models.blueprint import BlueprintDoc

    doc = BlueprintDoc(tenant_id=tenant.id, title="Doc2")
    session_override.add(doc)
    await session_override.flush()
    session_override.add(
        BlueprintPage(doc_id=doc.id, tenant_id=tenant.id, title="Overview", slug="overview2", kind="page")
    )
    await session_override.commit()

    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()
    change, meta = await propose_platform_change(
        session_override,
        tenant,
        resource_type="blueprint_block",
        change_kind="create",
        after={"page_slug": "overview2", "text": "Yolo text", "block_type": "paragraph"},
        summary="Yolo add",
        agent=agent,
        tool_name="write_blueprint",
    )
    assert meta["mode"] == "yolo"
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
        resource_type="blueprint_block",
        change_kind="create",
        after={"page_slug": "x", "text": "t"},
        summary="Test pending",
        agent=agent,
    )
    res = await client.get("/api/govern/changes", headers=headers, params={"status": "pending_review"})
    assert res.status_code == 200
    assert len(res.json()["items"]) >= 1


@pytest.mark.asyncio
async def test_write_blueprint_tool_uses_draft_path(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.models.blueprint import BlueprintDoc

    doc = BlueprintDoc(tenant_id=tenant.id, title="ToolDoc")
    session_override.add(doc)
    await session_override.flush()
    session_override.add(
        BlueprintPage(doc_id=doc.id, tenant_id=tenant.id, title="Overview", slug="tool-page", kind="page")
    )
    await session_override.commit()
    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "write_blueprint",
        {"page_slug": "tool-page", "text": "From tool"},
        agent=agent,
    )
    assert result.get("change_id") or result.get("status") == "written"
    pending = (
        await session_override.execute(
            select(PlatformChange).where(
                PlatformChange.tenant_id == tenant.id,
                PlatformChange.status.in_(("pending_review", "applied_yolo")),
            )
        )
    ).scalars().all()
    assert len(pending) >= 1
