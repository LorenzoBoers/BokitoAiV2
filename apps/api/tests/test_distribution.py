"""Distribution inside teams, learned routing and the Team overview numbers."""

import json
from datetime import datetime
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _owner(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _people(session, count: int, *, online: bool = True) -> list[UUID]:
    from app.models.auth import Membership, Tenant, User
    from app.services.auth import hash_password

    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    ids = []
    for index in range(count):
        user = User(
            email=f"member{index}-{datetime.utcnow().timestamp()}@test.local",
            password_hash=hash_password("pw-123456"),
            display_name=f"Member {index}",
            email_verified=True,
            last_seen_at=datetime.utcnow() if online else None,
        )
        session.add(user)
        await session.flush()
        session.add(Membership(tenant_id=tenant.id, user_id=user.id, role="member"))
        ids.append(user.id)
    await session.commit()
    return ids


async def _team_with_channel(session, user_ids: list[UUID], pickup: str):
    from app.models.auth import Tenant
    from app.models.channel import ChannelAccount
    from app.services.teams import create_team

    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    team = await create_team(
        session,
        tenant.id,
        name=f"Support {pickup}",
        pickup=pickup,
        members=[{"kind": "user", "id": str(uid)} for uid in user_ids],
    )
    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="whatsapp",
        provider="whatsapp_cloud",
        address=f"pn-{team.id.hex[:8]}",
        # Manual keeps the workspace lead agent out, so team pickup decides.
        settings_json=json.dumps(
            {"routing": {"team_id": str(team.id)}, "ai_config": {"ai_handling": "manual"}}
        ),
    )
    session.add(account)
    await session.commit()
    return tenant.id, team.id, account.id


async def _inbound(session, tenant_id, account_id, sender: str):
    from app.channels.base import InboundMessage, ingest_inbound

    signal, _ = await ingest_inbound(
        session,
        tenant_id,
        InboundMessage(
            channel="whatsapp",
            source="whatsapp",
            sender_address=sender,
            sender_name="Customer",
            subject="",
            body_text="Hello",
            external_id=f"wamid.{sender}",
            thread_external_id=sender,
            channel_account_id=account_id,
        ),
    )
    return signal


@pytest.mark.asyncio
async def test_round_robin_takes_turns_and_skips_away(client: AsyncClient, session_override):
    from app.models.audit import AuditEvent
    from app.models.auth import User
    from app.models.signal import SignalEvent

    first, second = await _people(session_override, 2)
    tenant_id, team_id, account_id = await _team_with_channel(session_override, [first, second], "round_robin")

    owners = []
    for sender in ("31600000001", "31600000002", "31600000003"):
        signal = await _inbound(session_override, tenant_id, account_id, sender)
        assert signal.assignee_kind == "user"
        owners.append(signal.assigned_user_id)
    assert owners[0] != owners[1] and owners[2] == owners[0]
    assert set(owners) == {first, second}

    events = (
        await session_override.execute(select(SignalEvent).where(SignalEvent.event_type == "auto_assigned"))
    ).scalars().all()
    assert len(events) == 3
    audits = (
        await session_override.execute(select(AuditEvent).where(AuditEvent.action == "team:auto_assign"))
    ).scalars().all()
    assert len(audits) == 3

    for uid in (first, second):
        user = await session_override.get(User, uid)
        user.away = True
        session_override.add(user)
    await session_override.commit()
    signal = await _inbound(session_override, tenant_id, account_id, "31600000004")
    assert signal.assignee_kind == "team" and signal.assignee_team_id == team_id


@pytest.mark.asyncio
async def test_least_open_picks_lightest_member(client: AsyncClient, session_override):
    busy, free = await _people(session_override, 2)
    tenant_id, _team_id, account_id = await _team_with_channel(session_override, [busy, free], "least_open")
    from app.models.signal import Signal

    session_override.add(
        Signal(tenant_id=tenant_id, channel="email", subject="Busy", status="open", assigned_user_id=busy)
    )
    await session_override.commit()
    signal = await _inbound(session_override, tenant_id, account_id, "31600000010")
    assert signal.assigned_user_id == free


@pytest.mark.asyncio
async def test_people_pickup_keeps_team_owner(client: AsyncClient, session_override):
    (member,) = await _people(session_override, 1)
    tenant_id, team_id, account_id = await _team_with_channel(session_override, [member], "people")
    signal = await _inbound(session_override, tenant_id, account_id, "31600000020")
    assert signal.assignee_kind == "team" and signal.assignee_team_id == team_id


@pytest.mark.asyncio
async def test_learned_routing_proposal_and_rule(client: AsyncClient, session_override):
    from app.models.auth import Tenant, User
    from app.models.notification import DecisionRequest
    from app.models.platform_change import PlatformChange
    from app.models.signal import Signal
    from app.services.addressee import resolve_addressee
    from app.services.notifications import resolve_decision
    from app.services.platform_changes import accept_platform_change
    from app.services.routing_learning import MIN_ANSWERS, routing_rules

    headers = await _owner(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    tenant_id = tenant.id
    owner = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    owner_id = owner.id
    owner.last_seen_at = datetime.utcnow()
    session_override.add(owner)

    decision_ids = []
    for index in range(MIN_ANSWERS):
        signal = Signal(tenant_id=tenant_id, channel="email", subject=f"Invoice {index}", intent="Invoices")
        session_override.add(signal)
        await session_override.flush()
        decision = DecisionRequest(
            tenant_id=tenant_id,
            signal_id=signal.id,
            title="Credit the invoice?",
            options_json=json.dumps([{"id": "approve", "label": "Approve"}]),
        )
        session_override.add(decision)
        await session_override.flush()
        decision_ids.append(decision.id)
    await session_override.commit()

    for decision_id in decision_ids:
        await resolve_decision(session_override, tenant_id, decision_id, "approve", "approved", user_id=owner_id)

    change = (
        await session_override.execute(
            select(PlatformChange).where(PlatformChange.resource_type == "routing_rule")
        )
    ).scalar_one()
    assert change.status == "pending_review"
    assert json.loads(change.after_json)["topic"] == "invoices"
    change_id = change.id

    await accept_platform_change(session_override, tenant_id, change_id, owner_id)
    session_override.expire_all()
    tenant = await session_override.get(Tenant, tenant_id)
    rules = routing_rules(tenant)
    assert rules and rules[0]["user_id"] == str(owner_id)

    fresh = Signal(tenant_id=tenant_id, channel="email", subject="New invoice", intent="invoices")
    session_override.add(fresh)
    await session_override.commit()
    owner = await session_override.get(User, owner_id)
    owner.last_seen_at = datetime.utcnow()
    session_override.add(owner)
    await session_override.commit()
    addressee = await resolve_addressee(session_override, tenant_id, signal=fresh)
    assert addressee.routed_by == "rule" and addressee.user_id == owner_id

    overview = await client.get("/api/teams/overview", headers=headers)
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert all("metrics" in team for team in body["teams"])
    assert all("metrics" in agent for agent in body["agents"])
