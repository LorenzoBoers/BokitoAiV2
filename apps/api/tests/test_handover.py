"""Owner routing and agent/people handovers.

The agent owns a conversation while it has the next step: it sends
(autonomous) or prepares a draft and hands the conversation to a person
(assisted). People take it through that handover, escalation or by replying;
the channel routing policy decides what happens after a human reply, on
reopen and after an agent reply.
"""

import json
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Membership, Tenant, User
from app.models.channel import ChannelAccount, Contact
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services import ai_handling
from app.services import channel_registry
from app.services.handover import (
    HANDOVER_EVENT,
    apply_after_human_reply,
    apply_reopen_policy,
    bounce_count,
    escalate_to_human,
    hand_to_agent,
    hand_to_people_after_assist,
)
from app.services.ownership import agent_may_own, route_new_conversation
from app.services.teams import create_team
from app.workers.tasks import autonomous_gate_reason
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


async def _setup(session: AsyncSession, monkeypatch, *, mode: str = "autonomous", routing: dict | None = None):
    """Seeded tenant made autonomous-capable with the lead agent on the mailbox."""
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    agent = (
        await session.execute(select(Agent).where(Agent.tenant_id == tenant.id, Agent.is_lead == True))  # noqa: E712
    ).scalars().first()
    account = (
        await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id, ChannelAccount.channel == "email"
            )
        )
    ).scalars().first()

    block: dict = {"default": {"mode": mode}}
    if routing is not None:
        block["routing"] = routing
    tenant.settings_json = json.dumps({"ai_handling": block, "tool_allowances": {"messaging": "allow"}})
    agent.autonomy_level = "autonomous"
    agent.kind = "company"
    account.default_agent_id = agent.id
    account.is_enabled = True
    user.last_seen_at = datetime.utcnow()
    user.away = False
    session.add_all([tenant, agent, account, user])
    await session.commit()
    # The mock mailbox has no live credentials; ownership only needs the
    # "channel can send" answer, the registry is tested elsewhere.
    monkeypatch.setattr(channel_registry, "account_can_send", lambda account, tenant=None: True)
    return tenant, user, agent, account


async def _thread(session: AsyncSession, tenant, account, *, contact=None) -> Signal:
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Invoice",
        contact_email="customer@example.com",
        channel_account_id=account.id,
        contact_id=contact.id if contact is not None else None,
        status="open",
    )
    session.add(signal)
    await session.flush()
    session.add(
        SignalMessage(
            tenant_id=tenant.id,
            signal_id=signal.id,
            kind="user_message",
            direction="inbound",
            body="Where is my invoice?",
        )
    )
    await session.commit()
    await session.refresh(signal)
    return signal


async def _events(session: AsyncSession, signal: Signal, event_type: str) -> list[dict]:
    rows = (
        await session.execute(
            select(SignalEvent)
            .where(SignalEvent.signal_id == signal.id, SignalEvent.event_type == event_type)
            .order_by(SignalEvent.created_at)
        )
    ).scalars().all()
    return [json.loads(row.payload_json or "{}") for row in rows]


async def _second_member(session: AsyncSession, tenant) -> User:
    other = User(email=f"colleague-{uuid4().hex[:6]}@test.local", password_hash="x", display_name="Colleague")
    session.add(other)
    await session.flush()
    session.add(Membership(tenant_id=tenant.id, user_id=other.id, role="member"))
    other.last_seen_at = datetime.utcnow()
    other.away = False
    await session.commit()
    await session.refresh(other)
    return other


# ---------------------------------------------------------------------------
# Routing of new conversations
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_autonomous_agent_owns_new_conversation(client: AsyncClient, session_override, monkeypatch):
    tenant, _user, agent, account = await _setup(session_override, monkeypatch)
    signal = await _thread(session_override, tenant, account)

    payload = await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()

    assert payload["reason"] == "autonomous"
    assert (signal.assignee_kind, signal.agent_id) == ("agent", agent.id)
    assert signal.turn_kind == "agent"
    assert await agent_may_own(session_override, signal, agent=agent, tenant=tenant)


@pytest.mark.asyncio
async def test_assisted_agent_owns_then_hands_draft_to_people(client: AsyncClient, session_override, monkeypatch):
    """Assisted: the agent owns the conversation while it prepares, then the
    end of its run hands it to a person; the routine handover is no bounce."""
    tenant, _user, agent, account = await _setup(session_override, monkeypatch, mode="assisted")
    signal = await _thread(session_override, tenant, account)

    payload = await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()

    assert payload["reason"] == "assisted"
    assert (signal.assignee_kind, signal.agent_id) == ("agent", agent.id)
    assert await agent_may_own(session_override, signal, agent=agent, tenant=tenant)

    handed = await hand_to_people_after_assist(session_override, signal, agent=agent, reason="draft_ready")
    await session_override.commit()

    assert handed["via"] == "assisted" and handed["reason"] == "draft_ready"
    assert signal.assignee_kind in ("team", "user")
    assert signal.assignee_kind != "agent"
    assert not ai_handling.is_held(signal)
    assert await bounce_count(session_override, signal) == 0
    # Nothing to do when a person already owns it.
    assert await hand_to_people_after_assist(session_override, signal, agent=agent) is None


@pytest.mark.asyncio
async def test_manual_channel_routes_to_team_not_agent(client: AsyncClient, session_override, monkeypatch):
    tenant, _user, agent, account = await _setup(session_override, monkeypatch, mode="manual")
    signal = await _thread(session_override, tenant, account)

    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()

    assert signal.assignee_kind == "team"
    assert signal.assignee_team_id is not None
    assert not await agent_may_own(session_override, signal, agent=agent, tenant=tenant)


@pytest.mark.asyncio
async def test_assisted_owner_reply_returns_to_agent(client: AsyncClient, session_override, monkeypatch):
    """The agent handed the draft to Lisa; Lisa sent. With return_to_agent the
    agent owns the conversation again and waits for the customer."""
    tenant, user, agent, account = await _setup(session_override, monkeypatch, mode="assisted")
    signal = await _thread(session_override, tenant, account)
    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    from app.services.ownership import set_owner

    set_owner(signal, "user", user.id)
    await session_override.commit()

    result = await apply_after_human_reply(session_override, tenant, signal, user.id)
    await session_override.commit()

    assert result["handed_back"] is True
    assert (signal.assignee_kind, signal.agent_id) == ("agent", agent.id)

    # A colleague replying on Lisa's conversation leaves her ownership alone.
    other = await _second_member(session_override, tenant)
    set_owner(signal, "user", user.id)
    await session_override.commit()
    result = await apply_after_human_reply(session_override, tenant, signal, other.id)
    await session_override.commit()
    assert result["handed_back"] is False
    assert (signal.assignee_kind, signal.assigned_user_id) == ("user", user.id)


@pytest.mark.asyncio
async def test_contact_owner_wins_when_agent_cannot_own(client: AsyncClient, session_override, monkeypatch):
    tenant, user, _agent, account = await _setup(session_override, monkeypatch, mode="manual")
    contact = Contact(
        tenant_id=tenant.id,
        address="customer@example.com",
        display_name="Customer",
        owner_kind="user",
        owner_user_id=user.id,
    )
    session_override.add(contact)
    await session_override.commit()
    signal = await _thread(session_override, tenant, account, contact=contact)

    payload = await route_new_conversation(
        session_override, signal, tenant=tenant, account=account, contact=contact
    )
    await session_override.commit()

    assert payload["reason"] == "contact_owner"
    assert (signal.assignee_kind, signal.assigned_user_id) == ("user", user.id)


@pytest.mark.asyncio
async def test_contact_owner_is_remembered_behind_autonomous_agent(
    client: AsyncClient, session_override, monkeypatch
):
    tenant, user, agent, account = await _setup(session_override, monkeypatch)
    contact = Contact(
        tenant_id=tenant.id, address="customer@example.com", owner_kind="user", owner_user_id=user.id
    )
    session_override.add(contact)
    await session_override.commit()
    signal = await _thread(session_override, tenant, account, contact=contact)

    await route_new_conversation(session_override, signal, tenant=tenant, account=account, contact=contact)
    await session_override.commit()

    assert (signal.assignee_kind, signal.agent_id) == ("agent", agent.id)
    assert (signal.last_human_owner_kind, signal.last_human_owner_user_id) == ("user", user.id)

    # Escalation lands with the contact owner, not with the whole team.
    result = await escalate_to_human(session_override, signal, reason="Needs a refund", tenant=tenant)
    await session_override.commit()
    assert result["owner"]["kind"] == "user"
    assert result["owner"]["user_id"] == str(user.id)


# ---------------------------------------------------------------------------
# Escalation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_escalation_holds_routes_and_leaves_note(client: AsyncClient, session_override, monkeypatch):
    tenant, _user, agent, account = await _setup(session_override, monkeypatch)
    signal = await _thread(session_override, tenant, account)
    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()
    assert signal.assignee_kind == "agent"

    result = await escalate_to_human(
        session_override, signal, reason="Customer asks for a person", actor_id=str(agent.id), tenant=tenant
    )
    await session_override.commit()

    assert result["newly_held"] is True
    assert result["bounce_limited"] is False
    assert signal.ai_handling == "manual"
    assert signal.ai_handling_reason == ai_handling.REASON_HANDOFF
    assert signal.assignee_kind in ("user", "team")
    assert signal.has_unread is True

    handovers = await _events(session_override, signal, HANDOVER_EVENT)
    assert len(handovers) == 1
    assert handovers[0]["from"]["kind"] == "agent"
    assert handovers[0]["reason"] == "Customer asks for a person"

    note = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id, SignalMessage.kind == "internal_note"
            )
        )
    ).scalars().first()
    assert note is not None
    assert json.loads(note.metadata_json)["system_note"] is True
    assert "Customer asks for a person" in note.body_text


@pytest.mark.asyncio
async def test_escalation_prefers_last_human_owner(client: AsyncClient, session_override, monkeypatch):
    tenant, user, _agent, account = await _setup(session_override, monkeypatch)
    colleague = await _second_member(session_override, tenant)
    signal = await _thread(session_override, tenant, account)
    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()

    # The colleague answered once and handed back; the agent owns again.
    await apply_after_human_reply(session_override, tenant, signal, colleague.id, handback=False)
    await session_override.commit()
    assert (signal.assignee_kind, signal.assigned_user_id) == ("user", colleague.id)
    assert await hand_to_agent(session_override, tenant, signal, by_user_id=colleague.id)
    await session_override.commit()
    assert signal.assignee_kind == "agent"
    assert signal.last_human_owner_user_id == colleague.id

    result = await escalate_to_human(session_override, signal, reason="Follow-up", tenant=tenant)
    await session_override.commit()
    assert result["owner"]["user_id"] == str(colleague.id)
    assert result["owner"]["user_id"] != str(user.id)


@pytest.mark.asyncio
async def test_bounce_limit_keeps_conversation_with_people(client: AsyncClient, session_override, monkeypatch):
    tenant, user, agent, account = await _setup(
        session_override, monkeypatch, routing={"bounce_limit": 2, "after_human_reply": "return_to_agent"}
    )
    signal = await _thread(session_override, tenant, account)
    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()

    first = await escalate_to_human(session_override, signal, reason="One", tenant=tenant)
    await session_override.commit()
    assert first["bounce_limited"] is False

    # Human replies: policy says return to the agent (second crossing).
    settled = await apply_after_human_reply(session_override, tenant, signal, user.id)
    await session_override.commit()
    assert settled["handed_back"] is True
    assert signal.assignee_kind == "agent"

    # The next escalation reaches the limit: sticky hold, people keep it.
    second = await escalate_to_human(session_override, signal, reason="Two", tenant=tenant)
    await session_override.commit()
    assert second["bounce_limited"] is True
    assert signal.ai_handling_reason == ai_handling.REASON_BOUNCE
    assert signal.assignee_kind != "agent"

    # A plain human reply no longer returns it; only an explicit hand back does.
    settled = await apply_after_human_reply(session_override, tenant, signal, user.id)
    await session_override.commit()
    assert settled["handed_back"] is False
    assert signal.ai_handling == "manual"
    assert signal.assignee_kind == "user"

    settled = await apply_after_human_reply(session_override, tenant, signal, user.id, handback=True)
    await session_override.commit()
    assert settled["handed_back"] is True
    assert signal.ai_handling is None
    assert (signal.assignee_kind, signal.agent_id) == ("agent", agent.id)


# ---------------------------------------------------------------------------
# After a human reply
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_return_to_agent_is_the_default(client: AsyncClient, session_override, monkeypatch):
    tenant, user, agent, account = await _setup(session_override, monkeypatch)
    signal = await _thread(session_override, tenant, account)
    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await escalate_to_human(session_override, signal, reason="Check", tenant=tenant)
    await session_override.commit()
    assert signal.ai_handling == "manual"

    settled = await apply_after_human_reply(session_override, tenant, signal, user.id)
    await session_override.commit()

    assert settled["policy"] == "return_to_agent"
    assert settled["handed_back"] is True
    assert signal.ai_handling is None, "the handoff hold is released by the reply"
    assert (signal.assignee_kind, signal.agent_id) == ("agent", agent.id)
    assert signal.last_human_owner_user_id == user.id


@pytest.mark.asyncio
async def test_keep_with_human_policy_and_channel_override(client: AsyncClient, session_override, monkeypatch):
    tenant, user, _agent, account = await _setup(
        session_override, monkeypatch, routing={"after_human_reply": "return_to_agent"}
    )
    ai_handling.set_account_routing(account, {"after_human_reply": "keep_with_human"})
    session_override.add(account)
    await session_override.commit()

    policy = ai_handling.resolve_routing(tenant, account)
    assert policy.effective["after_human_reply"] == "keep_with_human"
    assert policy.source["after_human_reply"] == "channel"
    assert policy.inherited["after_human_reply"] == "return_to_agent"

    signal = await _thread(session_override, tenant, account)
    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()
    assert signal.assignee_kind == "agent"

    settled = await apply_after_human_reply(session_override, tenant, signal, user.id)
    await session_override.commit()
    assert settled["handed_back"] is False
    assert settled["owner_changed"] is True
    assert (signal.assignee_kind, signal.assigned_user_id) == ("user", user.id)
    assert signal.ai_handling is None, "keeping it is ownership, not a manual hold"

    # Clearing the override follows the workspace again.
    ai_handling.set_account_routing(account, {"after_human_reply": None})
    assert ai_handling.resolve_routing(tenant, account).source["after_human_reply"] == "workspace"


@pytest.mark.asyncio
async def test_ask_policy_follows_explicit_choice(client: AsyncClient, session_override, monkeypatch):
    tenant, user, agent, account = await _setup(
        session_override, monkeypatch, routing={"after_human_reply": "ask"}
    )
    signal = await _thread(session_override, tenant, account)
    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()

    # No choice: stays with the person.
    settled = await apply_after_human_reply(session_override, tenant, signal, user.id)
    await session_override.commit()
    assert settled["handed_back"] is False
    assert signal.assignee_kind == "user"

    settled = await apply_after_human_reply(session_override, tenant, signal, user.id, handback=True)
    await session_override.commit()
    assert settled["handed_back"] is True
    assert (signal.assignee_kind, signal.agent_id) == ("agent", agent.id)


@pytest.mark.asyncio
async def test_take_over_hold_is_sticky(client: AsyncClient, session_override, monkeypatch):
    tenant, user, _agent, account = await _setup(session_override, monkeypatch)
    signal = await _thread(session_override, tenant, account)
    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()

    await ai_handling.set_ai_handling(
        session_override,
        tenant,
        "conversation",
        signal.id,
        "manual",
        actor_type="user",
        actor_id=str(user.id),
        assign_to_me=user.id,
    )
    await session_override.commit()
    assert signal.ai_handling_reason == ai_handling.REASON_TAKEOVER
    assert (signal.assignee_kind, signal.assigned_user_id) == ("user", user.id)

    settled = await apply_after_human_reply(session_override, tenant, signal, user.id)
    await session_override.commit()
    assert settled["handed_back"] is False
    assert signal.ai_handling == "manual", "a take-over survives replies until handed back"


@pytest.mark.asyncio
async def test_reply_api_applies_policy_and_close_after_human_reply(
    client: AsyncClient, session_override, monkeypatch
):
    tenant, user, agent, account = await _setup(
        session_override, monkeypatch, routing={"close_after_human_reply": True}
    )
    signal = await _thread(session_override, tenant, account)
    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    detail = await client.get(f"/api/signals/{signal.id}", headers=headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["routing_policy"]["close_after_human_reply"] is True
    assert body["routing_policy"]["after_human_reply"] == "return_to_agent"
    assert body["last_human_owner"] is None

    # keep_open: the sender decided; the policy does not close.
    r = await client.post(
        f"/api/signals/{signal.id}/reply",
        headers=headers,
        json={"body_text": "Here you go.", "action": "send", "keep_open": True},
    )
    assert r.status_code in (200, 201), r.text
    await session_override.refresh(signal)
    assert signal.status == "open"
    assert (signal.assignee_kind, signal.agent_id) == ("agent", agent.id), "default policy returns to agent"
    assert signal.last_human_owner_user_id == user.id

    r = await client.post(
        f"/api/signals/{signal.id}/reply",
        headers=headers,
        json={"body_text": "Closing this.", "action": "send"},
    )
    assert r.status_code in (200, 201), r.text
    await session_override.refresh(signal)
    assert signal.status == "closed"


@pytest.mark.asyncio
async def test_composing_lock_endpoint(client: AsyncClient, session_override, monkeypatch):
    tenant, _user, agent, account = await _setup(session_override, monkeypatch)
    signal = await _thread(session_override, tenant, account)
    await route_new_conversation(session_override, signal, tenant=tenant, account=account)
    await session_override.commit()
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    r = await client.post(f"/api/signals/{signal.id}/composing", headers=headers, json={"seconds": 60})
    assert r.status_code == 200, r.text
    await session_override.refresh(signal)
    assert signal.human_composing_until is not None
    assert autonomous_gate_reason(signal, agent) == "human_composing"

    r = await client.post(f"/api/signals/{signal.id}/composing", headers=headers, json={"active": False})
    assert r.status_code == 200, r.text
    await session_override.refresh(signal)
    assert signal.human_composing_until is None
    assert autonomous_gate_reason(signal, agent) is None


# ---------------------------------------------------------------------------
# Worker gate
# ---------------------------------------------------------------------------


def test_autonomous_gate_reason():
    agent = Agent(tenant_id=uuid4(), name="Desk", slug="desk")
    agent.id = uuid4()
    other = uuid4()
    now = datetime(2026, 1, 1, 12, 0, 0)

    team_owned = Signal(tenant_id=uuid4(), channel="email", assignee_kind="team")
    assert autonomous_gate_reason(team_owned, agent, now=now) == "not_owner"

    other_agent = Signal(tenant_id=uuid4(), channel="email", assignee_kind="agent", agent_id=other)
    assert autonomous_gate_reason(other_agent, agent, now=now) == "not_owner"

    owned = Signal(tenant_id=uuid4(), channel="email", assignee_kind="agent", agent_id=agent.id)
    assert autonomous_gate_reason(owned, agent, now=now) is None

    owned.human_composing_until = now + timedelta(seconds=30)
    assert autonomous_gate_reason(owned, agent, now=now) == "human_composing"
    owned.human_composing_until = now - timedelta(seconds=1)
    assert autonomous_gate_reason(owned, agent, now=now) is None


# ---------------------------------------------------------------------------
# Reopen and auto-close
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reopen_same_owner_falls_back_when_owner_left(client: AsyncClient, session_override, monkeypatch):
    tenant, _user, _agent, account = await _setup(session_override, monkeypatch, mode="assisted")
    colleague = await _second_member(session_override, tenant)
    signal = await _thread(session_override, tenant, account)
    signal.assigned_user_id = colleague.id
    await session_override.commit()
    assert signal.assignee_kind == "user"

    # Same owner: nothing changes while the colleague is a member.
    assert await apply_reopen_policy(session_override, tenant, signal, account=account, contact=None) is False

    membership = (
        await session_override.execute(select(Membership).where(Membership.user_id == colleague.id))
    ).scalar_one()
    await session_override.delete(membership)
    await session_override.commit()

    changed = await apply_reopen_policy(session_override, tenant, signal, account=account, contact=None)
    await session_override.commit()
    assert changed is True
    assert signal.assignee_kind == "team"
    events = await _events(session_override, signal, "auto_assigned")
    assert events[-1]["reason"] == "reopened"


@pytest.mark.asyncio
async def test_reopen_route_again_gives_it_back_to_agent(client: AsyncClient, session_override, monkeypatch):
    tenant, user, agent, account = await _setup(
        session_override, monkeypatch, routing={"reopen_owner": "route_again"}
    )
    signal = await _thread(session_override, tenant, account)
    signal.assigned_user_id = user.id
    await session_override.commit()

    changed = await apply_reopen_policy(session_override, tenant, signal, account=account, contact=None)
    await session_override.commit()
    assert changed is True
    assert (signal.assignee_kind, signal.agent_id) == ("agent", agent.id)


@pytest.mark.asyncio
async def test_close_after_agent_reply_policy(client: AsyncClient, session_override, monkeypatch):
    from app.services.inbound_agent import close_after_agent_reply

    tenant, _user, agent, account = await _setup(session_override, monkeypatch)
    signal = await _thread(session_override, tenant, account)
    assert await close_after_agent_reply(session_override, tenant.id, signal, agent) is False
    assert signal.status == "open"

    ai_handling.set_account_routing(account, {"close_after_agent_reply": True})
    session_override.add(account)
    await session_override.commit()

    assert await close_after_agent_reply(session_override, tenant.id, signal, agent) is True
    await session_override.commit()
    assert signal.status == "closed"
    events = await _events(session_override, signal, "closed")
    assert events[-1]["via"] == "close_after_agent_reply"


# ---------------------------------------------------------------------------
# Routing settings API
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_routing_settings_api_roundtrip(client: AsyncClient, session_override, monkeypatch):
    tenant, _user, _agent, account = await _setup(session_override, monkeypatch)
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    overview = await client.get("/api/ai-handling", headers=headers)
    assert overview.status_code == 200, overview.text
    assert overview.json()["routing"]["after_human_reply"] == "return_to_agent"
    assert overview.json()["routing"]["bounce_limit"] == 3

    r = await client.put(
        "/api/ai-handling/settings",
        headers=headers,
        json={"routing": {"after_human_reply": "ask", "bounce_limit": 5, "close_after_human_reply": True}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["routing"]["after_human_reply"] == "ask"
    assert r.json()["routing"]["bounce_limit"] == 5
    assert r.json()["routing"]["close_after_human_reply"] is True

    def _own(payload: dict) -> dict:
        return {k: v for k, v in payload["own"].items() if v is not None}

    r = await client.get(f"/api/ai-handling/channel/{account.id}/routing", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["effective"]["after_human_reply"] == "ask"
    assert _own(r.json()) == {}

    r = await client.put(
        f"/api/ai-handling/channel/{account.id}/routing",
        headers=headers,
        json={"after_human_reply": "keep_with_human", "close_after_agent_reply": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert _own(body) == {"after_human_reply": "keep_with_human", "close_after_agent_reply": True}
    assert body["effective"]["after_human_reply"] == "keep_with_human"
    assert body["effective"]["close_after_human_reply"] is True, "inherited from workspace"
    assert body["source"]["close_after_human_reply"] == "workspace"

    r = await client.put(
        f"/api/ai-handling/channel/{account.id}/routing",
        headers=headers,
        json={"after_human_reply": None},
    )
    assert r.status_code == 200, r.text
    assert "after_human_reply" not in _own(r.json())
    assert r.json()["effective"]["after_human_reply"] == "ask"

    await session_override.refresh(tenant)
    assert ai_handling.workspace_settings(tenant)["routing"]["bounce_limit"] == 5
