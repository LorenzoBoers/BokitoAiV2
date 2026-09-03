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


@pytest.mark.asyncio
async def test_acknowledge_action_resolves_without_tool(client: AsyncClient, session_override):
    """Human-owned options with invented action_types must not 422."""
    from app.models.auth import Tenant, User
    from app.models.signal import Signal
    from scripts.seed import TEST_EMAIL

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Escalate please",
        status="open",
        ai_paused=False,
    )
    session_override.add(signal)
    await session_override.flush()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        title="Escalatie",
        summary="Human should take over",
        status="awaiting_human",
        signal_id=signal.id,
        options_json=json.dumps(
            [
                {
                    "id": "call_back",
                    "label": "Ik bel zelf terug",
                    "action_type": "acknowledge",
                },
                {"id": "reject", "label": "Reject", "action_type": "reject"},
            ]
        ),
    )
    session_override.add(decision)
    await session_override.commit()
    await session_override.refresh(decision)
    decision_id = decision.id
    signal_id = signal.id

    res = await client.post(
        f"/api/notifications/decisions/{decision_id}/approve",
        headers=headers,
        json={"option_id": "call_back"},
    )
    assert res.status_code == 200, res.text

    row = (
        await session_override.execute(select(DecisionRequest).where(DecisionRequest.id == decision_id))
    ).scalar_one()
    assert row.status == "approved"
    sig = (await session_override.execute(select(Signal).where(Signal.id == signal_id))).scalar_one()
    assert sig.ai_paused is True
    assert sig.assigned_user_id == user.id


@pytest.mark.asyncio
async def test_decision_provenance_and_deep_link_payload(client: AsyncClient, session_override):
    """A decision keeps its source, and the bell payload points at the card."""
    from app.models.agent import Agent, AgentRun
    from app.models.auth import Tenant
    from app.models.notification import Notification
    from app.models.orchestration import AgentTask
    from app.models.project import Project
    from app.services.signal_decisions import create_decision, decision_provenance

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()

    project = Project(tenant_id=tenant.id, name="Provenance", slug="provenance")
    session_override.add(project)
    await session_override.flush()

    task = AgentTask(tenant_id=tenant.id, project_id=project.id, title="Do the thing")
    run = AgentRun(tenant_id=tenant.id, agent_id=agent.id, status="running")
    session_override.add(task)
    session_override.add(run)
    await session_override.flush()

    decision, message = await create_decision(
        session_override,
        tenant.id,
        title="Ship it?",
        summary="Queue item needs a call",
        agent_id=agent.id,
        project_id=project.id,
        agent_task_id=task.id,
        run_id=run.id,
        notification_payload={"kind": "queue_item"},
    )
    await session_override.commit()

    assert decision.agent_task_id == task.id
    assert decision.run_id == run.id
    # The queue item wins over the plain project link: it is the concrete source.
    assert decision_provenance(decision) == {
        "type": "agent_task",
        "id": str(task.id),
        "project_id": str(project.id),
    }

    notification = (
        await session_override.execute(
            select(Notification).where(Notification.id == decision.notification_id)
        )
    ).scalar_one()
    payload = json.loads(notification.payload_json)
    assert payload["kind"] == "queue_item"
    assert payload["decision_id"] == str(decision.id)
    assert payload["signal_id"] == str(decision.signal_id)
    assert payload["message_id"] == str(message.id)

    headers = await _auth_headers(client)
    listed = await client.get("/api/notifications/decisions", headers=headers)
    assert listed.status_code == 200
    row = next(d for d in listed.json() if d["id"] == str(decision.id))
    assert row["message_id"] == str(message.id)
    assert row["source"]["type"] == "agent_task"

    detail = await client.get(f"/api/signals/{decision.signal_id}", headers=headers)
    assert detail.status_code == 200
    card = next(m for m in detail.json()["messages"] if m["kind"] == "decision_request")
    assert card["payload"]["decision"]["source"]["type"] == "agent_task"
