"""Preview items on agent proposals: resolver per type and policy refs."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Membership, Tenant
from app.models.channel import Contact
from app.models.notification import DecisionRequest
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.signal import Signal, SignalMessage, SignalTag
from app.models.trash import TrashEntry
from app.models.trigger import Trigger
from app.services.proposal_items import (
    MAX_ITEMS,
    normalize_item_type,
    policy_item_refs,
    resolve_items,
    stash_attach_items,
    take_attach_items,
)


async def _login(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


def test_policy_refs_for_restore_and_tags():
    assert policy_item_refs("restore_trash_item", {"id": "abc"}) == [{"type": "trash_entry", "id": "abc"}]
    refs = policy_item_refs("set_thread_tags", {"tags": ["billing", " "]})
    assert refs == [{"type": "tag", "name": "billing"}]
    current = uuid4()
    assert policy_item_refs("close_thread", {"signal_id": str(current)}, current_signal_id=current) == []
    assert policy_item_refs("update_agent", {"agent_id": "a1"}) == [{"type": "agent", "id": "a1"}]


@pytest.mark.asyncio
async def test_resolver_returns_a_snapshot_per_type(client: AsyncClient, session_override):
    await _login(client)
    tenant = await _tenant(session_override)
    session = session_override
    agent = (await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars().first()
    member = (
        await session.execute(select(Membership).where(Membership.tenant_id == tenant.id))
    ).scalars().first()
    signal = Signal(tenant_id=tenant.id, channel="email", source="test", subject="Invoice 12", contact_name="Ana")
    trash = TrashEntry(
        tenant_id=tenant.id,
        resource_type="signal",
        resource_id=uuid4(),
        title="Old thread",
        preview="Hello there",
        purge_after=datetime.utcnow() + timedelta(days=30),
        batch_id=uuid4(),
    )
    trigger = Trigger(tenant_id=tenant.id, name="Weekly check", kind="cron", instructions="Look at the queue")
    tag = SignalTag(tenant_id=tenant.id, name="billing")
    flow = Workstream(tenant_id=tenant.id, name="returns")
    project = Project(tenant_id=tenant.id, name="Website", slug="website")
    contact = Contact(tenant_id=tenant.id, address="ana@example.com", display_name="Ana", company="Acme")
    session.add_all([signal, trash, trigger, tag, flow, project, contact])
    await session.flush()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="email",
        role="user",
        body_text="See attached",
        attachments_json=json.dumps(
            [{"name": "photo.png", "content_type": "image/png", "url": "/api/files/photo.png"}]
        ),
    )
    session.add(message)
    await session.flush()

    items = await resolve_items(
        session,
        tenant.id,
        [
            {"type": "signal", "id": str(signal.id)},
            {"type": "trash_entry", "id": str(trash.id)},
            {"type": "agenda", "id": str(trigger.id)},
            {"type": "file", "message_id": str(message.id), "name": "photo.png"},
            {"type": "member", "id": str(member.user_id)},
            {"type": "agent", "id": str(agent.id)},
        ],
    )
    by_type = {item["type"]: item for item in items}
    assert by_type["conversation"]["title"] == "Invoice 12"
    assert by_type["trash_entry"]["kind"] == "signal"
    assert by_type["trigger"]["title"] == "Weekly check"
    assert by_type["file"]["image_url"] == "/api/files/photo.png"
    assert by_type["user"]["title"]
    assert by_type["agent"]["title"] == agent.name
    assert not any(item.get("missing") for item in items)

    more = await resolve_items(
        session,
        tenant.id,
        [
            {"type": "tag", "name": "#Billing"},
            {"type": "workstream", "id": str(flow.id)},
            {"type": "project", "id": str(project.id)},
            {"type": "contact", "id": str(contact.id)},
            {"type": "project", "id": str(uuid4())},
            {"type": "nonsense", "id": "x"},
        ],
    )
    assert [i["type"] for i in more] == ["tag", "flow", "project", "contact", "project"]
    assert more[0]["title"] == "#billing"
    assert more[1]["title"] == "#returns"
    assert more[3]["subtitle"] == "Acme · ana@example.com"
    assert more[4]["missing"] is True


@pytest.mark.asyncio
async def test_resolver_stays_inside_the_tenant(client: AsyncClient, session_override):
    await _login(client)
    other = Tenant(name="Other", slug=f"other-{uuid4().hex[:6]}")
    session_override.add(other)
    await session_override.flush()
    project = Project(tenant_id=other.id, name="Secret", slug="secret")
    session_override.add(project)
    await session_override.flush()
    tenant = await _tenant(session_override)
    items = await resolve_items(session_override, tenant.id, [{"type": "project", "id": str(project.id)}])
    assert items[0]["missing"] is True
    assert items[0]["title"] == ""


@pytest.mark.asyncio
async def test_restore_policy_decision_carries_the_trash_entry(client: AsyncClient, session_override):
    from app.tools.executor import _create_policy_decision
    from app.tools.registry import ToolContext

    await _login(client)
    tenant = await _tenant(session_override)
    agent = (await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars().first()
    signal = Signal(tenant_id=tenant.id, channel="assistant", source="test", subject="Bin", status="open")
    trash = TrashEntry(
        tenant_id=tenant.id,
        resource_type="signal",
        resource_id=uuid4(),
        title="Agent session",
        purge_after=datetime.utcnow() + timedelta(days=30),
        batch_id=uuid4(),
    )
    session_override.add_all([signal, trash])
    await session_override.flush()
    ctx = ToolContext(session=session_override, tenant_id=tenant.id, user_id=None, agent=agent, signal_id=signal.id)
    result = await _create_policy_decision(ctx, "restore_trash_item", {"id": str(trash.id)})
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.id == UUID(result["decision_request_id"]))
        )
    ).scalar_one()
    card = (
        await session_override.execute(select(SignalMessage).where(SignalMessage.id == decision.message_id))
    ).scalar_one()
    items = json.loads(card.metadata_json)["proposal_items"]
    assert items[0]["type"] == "trash_entry"
    assert items[0]["title"] == "Agent session"


def test_attach_items_stash_and_take_roundtrip():
    from app.services.proposal_items import stash_attach_items, take_attach_items

    signal_id = uuid4()
    stash_attach_items(
        signal_id,
        [
            {"type": "project", "id": "a", "title": "A"},
            {"type": "project", "id": "a", "title": "dup"},
            {"type": "tag", "id": "b", "title": "#b"},
        ],
    )
    taken = take_attach_items(signal_id)
    assert [i["id"] for i in taken] == ["a", "b"]
    assert take_attach_items(signal_id) == []
