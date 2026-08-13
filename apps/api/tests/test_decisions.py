"""Tests for unified DecisionRequest-backed workforce messages."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.notification import DecisionRequest
from app.models.platform_change import PlatformChange


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_workforce_messages_from_decisions(client: AsyncClient, session_override):
    from app.models.auth import Tenant

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    session_override.add(
        DecisionRequest(
            tenant_id=tenant.id,
            title="Test decision",
            summary="Approve tool call",
            status="awaiting_human",
            options_json=json.dumps(
                [
                    {
                        "id": "approve",
                        "label": "Approve",
                        "action_type": "create_task",
                        "payload": {"title": "Follow up"},
                    },
                    {"id": "reject", "label": "Reject", "action_type": "reject"},
                ]
            ),
        )
    )
    await session_override.commit()

    headers = await _auth_headers(client)
    listed = await client.get("/api/workforce/messages", headers=headers, params={"status": "awaiting_human"})
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert any(i["subject"] == "Test decision" for i in items)


@pytest.mark.asyncio
async def test_approve_message_executes_tool(client: AsyncClient, session_override):
    from app.models.auth import Tenant

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        title="Task approval",
        summary="Create task",
        status="awaiting_human",
        options_json=json.dumps(
            [
                {
                    "id": "approve",
                    "label": "Approve",
                    "action_type": "create_task",
                    "payload": {"title": "From decision"},
                },
                {"id": "reject", "label": "Reject", "action_type": "reject"},
            ]
        ),
    )
    session_override.add(decision)
    await session_override.commit()
    await session_override.refresh(decision)

    headers = await _auth_headers(client)
    approved = await client.post(f"/api/workforce/messages/{decision.id}/approve", headers=headers)
    assert approved.status_code == 200

    row = (
        await session_override.execute(select(DecisionRequest).where(DecisionRequest.id == decision.id))
    ).scalar_one()
    assert row.status == "approved"


@pytest.mark.asyncio
async def test_always_auto_sets_tool_override(client: AsyncClient, session_override):
    from app.dependencies import tenant_settings
    from app.models.auth import Tenant, User
    from app.services.decisions import resolve_decision_message
    from scripts.seed import TEST_EMAIL

    # Ensure seed ran (client fixture) before reading tenant/user rows.
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        title="Always allow tool",
        summary="Persist override",
        status="awaiting_human",
        options_json=json.dumps(
            [
                {
                    "id": "approve",
                    "label": "Approve",
                    "action_type": "create_task",
                    "payload": {"title": "Once"},
                },
                {
                    "id": "always_auto",
                    "label": "Always allow",
                    "action_type": "create_task",
                    "payload": {"title": "Always"},
                    "always_auto": True,
                },
                {"id": "reject", "label": "Reject", "action_type": "reject"},
            ]
        ),
    )
    session_override.add(decision)
    await session_override.commit()
    await session_override.refresh(decision)

    await resolve_decision_message(
        session_override,
        tenant.id,
        decision.id,
        action="approved",
        user_id=user.id,
        option_id="always_auto",
    )
    await session_override.commit()
    await session_override.refresh(tenant)

    settings = tenant_settings(tenant)
    assert settings.get("tool_overrides", {}).get("create_task") == "allow"
    row = (
        await session_override.execute(select(DecisionRequest).where(DecisionRequest.id == decision.id))
    ).scalar_one()
    assert row.status == "approved"


@pytest.mark.asyncio
async def test_decision_accepts_linked_platform_change(client: AsyncClient, session_override):
    from app.models.auth import Tenant

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    change = PlatformChange(
        tenant_id=tenant.id,
        resource_type="workstream",
        change_kind="create",
        status="pending_review",
        summary="Add workstream",
        after_json=json.dumps({"name": "QA flow"}),
    )
    session_override.add(change)
    await session_override.flush()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        title="Review workstream",
        summary="Add workstream",
        status="awaiting_human",
        platform_change_id=change.id,
        options_json=json.dumps(
            [
                {
                    "id": "approve",
                    "label": "Approve",
                    "action_type": "accept_platform_change",
                    "payload": {"platform_change_id": str(change.id)},
                }
            ]
        ),
    )
    session_override.add(decision)
    await session_override.commit()
    await session_override.refresh(decision)

    headers = await _auth_headers(client)
    res = await client.post(f"/api/notifications/decisions/{decision.id}/approve", headers=headers, json={"option_id": "approve"})
    assert res.status_code == 200

    updated_change = (
        await session_override.execute(select(PlatformChange).where(PlatformChange.id == change.id))
    ).scalar_one()
    assert updated_change.status == "accepted"
