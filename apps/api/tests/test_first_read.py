"""The first read of an inbound message: one outcome, one notice, a free floor."""

import json
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services import notify
from app.services.inbound_agent import (
    SUPERSEDED_BY_NEWER_READ,
    create_action_suggestion,
    create_reply_suggestion,
    fold_run_events,
)
from app.workers.tasks import settle_inbound
from scripts.seed import TEST_EMAIL


async def _seed(session: AsyncSession):
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    from app.services.lead_agent import get_lead_agent

    agent = await get_lead_agent(session, tenant.id)
    return tenant, user, agent


async def _thread(session: AsyncSession, tenant, *, owner=None, pending: bool = True):
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Leerpad AI",
        contact_email="marijke@example.com",
        contact_name="Marijke van Dorp",
        status="open",
    )
    if owner is not None:
        signal.assigned_user_id = owner.id
    session.add(signal)
    await session.flush()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="user_message",
        direction="inbound",
        role="user",
        from_address="marijke@example.com",
        subject="Leerpad AI",
        body_text="Nieuwsbrief",
    )
    if pending:
        notify.mark_notice_pending(message)
    session.add(message)
    await session.commit()
    await session.refresh(signal)
    await session.refresh(message)
    return signal, message


async def _inbound_rows(session: AsyncSession, signal_id):
    return (
        await session.execute(
            select(Notification).where(
                Notification.signal_id == signal_id, Notification.kind == "new_message"
            )
        )
    ).scalars().all()


@pytest.mark.asyncio
async def test_settle_frees_the_floor_after_a_tool_outcome(client: AsyncClient, session_override: AsyncSession):
    tenant, _user, agent = await _seed(session_override)
    signal, message = await _thread(session_override, tenant, pending=False)
    signal.active_turn_json = json.dumps(
        {"kind": "agent", "ref_id": str(agent.id), "name": agent.name, "nonce": f"chip:{agent.id}"}
    )
    session_override.add(signal)
    await session_override.commit()

    await settle_inbound(
        session_override,
        tenant.id,
        {"signal_id": signal.id, "agent_id": agent.id, "message_id": message.id},
        {"delivery": "no_reply_needed"},
    )
    await session_override.refresh(signal)
    assert json.loads(signal.active_turn_json or "{}") == {}


@pytest.mark.asyncio
async def test_settle_frees_the_floor_after_a_failed_run(client: AsyncClient, session_override: AsyncSession):
    tenant, _user, agent = await _seed(session_override)
    signal, _message = await _thread(session_override, tenant, pending=False)
    signal.active_turn_json = json.dumps({"kind": "agent", "ref_id": str(agent.id), "nonce": "chip"})
    session_override.add(signal)
    await session_override.commit()

    await settle_inbound(
        session_override, tenant.id, {"signal_id": signal.id, "agent_id": agent.id}, {"delivery": "run_failed"}
    )
    await session_override.refresh(signal)
    assert json.loads(signal.active_turn_json or "{}") == {}


@pytest.mark.asyncio
async def test_two_no_reply_calls_in_one_run_leave_one_card(client: AsyncClient, session_override: AsyncSession):
    tenant, _user, agent = await _seed(session_override)
    signal, _message = await _thread(session_override, tenant)
    run_id = uuid4()

    first = await create_action_suggestion(
        session_override, tenant.id, signal, agent, summary="Nieuwsbrief", reason="agent_judgement", run_id=run_id
    )
    second = await create_action_suggestion(
        session_override,
        tenant.id,
        signal,
        agent,
        summary="Nieuwsbrief over AI-leerlijn",
        reason="agent_judgement",
        run_id=run_id,
    )

    assert second["updated"] is True
    assert second["decision_id"] == first["decision_id"]
    cards = (
        await session_override.execute(select(DecisionRequest).where(DecisionRequest.signal_id == signal.id))
    ).scalars().all()
    assert len(cards) == 1
    assert cards[0].summary == "Nieuwsbrief over AI-leerlijn"
    rows = (
        await session_override.execute(select(Notification).where(Notification.signal_id == signal.id))
    ).scalars().all()
    # The card keeps its anchor row, read and quiet: no workspace broadcast.
    assert all(row.status != "unread" for row in rows)


@pytest.mark.asyncio
async def test_a_draft_replaces_the_no_reply_card(client: AsyncClient, session_override: AsyncSession):
    tenant, _user, agent = await _seed(session_override)
    signal, _message = await _thread(session_override, tenant)
    run_id = uuid4()

    noted = await create_action_suggestion(
        session_override, tenant.id, signal, agent, summary="Nieuwsbrief", run_id=run_id
    )
    drafted = await create_reply_suggestion(
        session_override,
        tenant.id,
        signal,
        agent,
        reply_text="Hallo Marijke,\n\nDank voor je bericht.",
        run_id=run_id,
        announce=False,
    )

    assert drafted["delivery"] == "pending_approval"
    old = await session_override.get(DecisionRequest, UUID(noted["decision_id"]))
    assert old.status == "deferred"
    assert old.chosen_option_id == SUPERSEDED_BY_NEWER_READ
    open_cards = (
        await session_override.execute(
            select(DecisionRequest).where(
                DecisionRequest.signal_id == signal.id, DecisionRequest.status == "awaiting_human"
            )
        )
    ).scalars().all()
    assert [card.title for card in open_cards] == ["Suggested reply"]


@pytest.mark.asyncio
async def test_first_read_sends_one_quiet_notice_to_the_owner(client: AsyncClient, session_override: AsyncSession):
    tenant, user, _agent = await _seed(session_override)
    signal, message = await _thread(session_override, tenant, owner=user)

    sent = await notify.notify_first_read(
        session_override,
        tenant.id,
        signal,
        message,
        {"delivery": "no_reply_needed", "summary": "Nieuwsbrief over AI"},
    )
    again = await notify.notify_first_read(
        session_override, tenant.id, signal, message, {"delivery": "no_reply_needed"}
    )
    late = await notify.notify_inbound_fallback(session_override, tenant.id, signal, message)

    assert len(sent) == 1 and again == [] and late == []
    rows = await _inbound_rows(session_override, signal.id)
    assert len(rows) == 1
    row = rows[0]
    assert row.user_id == user.id
    assert row.title == "Marijke van Dorp"
    assert "Nieuwsbrief over AI" in row.body
    payload = json.loads(row.payload_json)
    assert payload["announce"] is False
    assert payload["outcome"] == "no_reply"
    assert row.tier == notify.TIER_LATER


@pytest.mark.asyncio
async def test_a_draft_notice_interrupts(client: AsyncClient, session_override: AsyncSession):
    tenant, user, _agent = await _seed(session_override)
    signal, message = await _thread(session_override, tenant, owner=user)

    await notify.notify_first_read(
        session_override, tenant.id, signal, message, {"delivery": "pending_approval"}
    )
    rows = await _inbound_rows(session_override, signal.id)
    assert len(rows) == 1
    assert rows[0].tier == notify.TIER_NOW
    assert "announce" not in json.loads(rows[0].payload_json)


@pytest.mark.asyncio
async def test_fallback_sends_the_plain_notice_once(client: AsyncClient, session_override: AsyncSession):
    tenant, user, _agent = await _seed(session_override)
    signal, message = await _thread(session_override, tenant, owner=user)

    first = await notify.notify_inbound_fallback(session_override, tenant.id, signal, message)
    later = await notify.notify_first_read(
        session_override, tenant.id, signal, message, {"delivery": "no_reply_needed"}
    )

    assert len(first) == 1 and later == []
    rows = await _inbound_rows(session_override, signal.id)
    assert len(rows) == 1
    assert rows[0].title.endswith("Marijke van Dorp")


@pytest.mark.asyncio
async def test_fallback_waits_for_a_newer_pending_message(client: AsyncClient, session_override: AsyncSession):
    tenant, user, _agent = await _seed(session_override)
    signal, older = await _thread(session_override, tenant, owner=user)
    newer = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="user_message",
        direction="inbound",
        role="user",
        from_address="marijke@example.com",
        body_text="Nog een vraag",
        created_at=older.created_at + timedelta(seconds=5),
    )
    notify.mark_notice_pending(newer)
    session_override.add(newer)
    await session_override.commit()

    assert await notify.notify_inbound_fallback(session_override, tenant.id, signal, older) == []
    await notify.notify_first_read(session_override, tenant.id, signal, newer, {"delivery": "pending_approval"})
    await session_override.refresh(older)
    assert notify._notice_state(older) == notify.NOTICE_SENT
    assert len(await _inbound_rows(session_override, signal.id)) == 1


@pytest.mark.asyncio
async def test_stale_read_leaves_the_notice_to_the_newer_message(client: AsyncClient, session_override: AsyncSession):
    tenant, user, _agent = await _seed(session_override)
    signal, message = await _thread(session_override, tenant, owner=user)

    sent = await notify.notify_first_read(
        session_override, tenant.id, signal, message, {"delivery": "skipped_stale"}
    )
    assert sent == []
    await session_override.refresh(message)
    assert notify._notice_state(message) == notify.NOTICE_PENDING


@pytest.mark.asyncio
async def test_collapse_key_rewrites_the_unread_row(client: AsyncClient, session_override: AsyncSession):
    tenant, user, _agent = await _seed(session_override)
    signal, _message = await _thread(session_override, tenant, owner=user, pending=False)

    first = await notify.notify_new_inbound(session_override, tenant.id, signal, sender="Marijke", subject="Een")
    second = await notify.notify_new_inbound(session_override, tenant.id, signal, sender="Marijke", subject="Twee")

    assert first[0].id == second[0].id
    rows = await _inbound_rows(session_override, signal.id)
    assert len(rows) == 1
    assert rows[0].body == "Twee"


@pytest.mark.asyncio
async def test_folded_events_stay_out_of_the_timeline(client: AsyncClient, session_override: AsyncSession):
    from app.services.signal_threads import get_thread

    tenant, user, agent = await _seed(session_override)
    signal, _message = await _thread(session_override, tenant, pending=False)
    run_id = uuid4()
    event = SignalEvent(
        signal_id=signal.id,
        tenant_id=tenant.id,
        event_type="thread_updated",
        actor_type="agent",
        actor_id=str(agent.id),
        payload_json=json.dumps({"tags_added": ["nieuwsbrief"], "run_id": str(run_id)}),
        created_at=datetime.utcnow(),
    )
    session_override.add(event)
    await session_override.commit()
    outcome = await create_action_suggestion(
        session_override, tenant.id, signal, agent, summary="Nieuwsbrief", run_id=run_id
    )

    assert await fold_run_events(session_override, signal.id, run_id, UUID(outcome["message_id"])) == 1
    await session_override.commit()

    detail = await get_thread(session_override, tenant.id, user.id, signal.id)
    assert str(event.id) not in {str(e.get("id")) for e in detail["events"]}
