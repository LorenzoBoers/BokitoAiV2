"""Action-credit matrix for estimated time saved."""

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest
from app.models.orchestra import WorkstreamRun
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.time_saved import DEFAULT_ACTION_MINUTES, compute_time_saved
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

ACTION_MINUTES = DEFAULT_ACTION_MINUTES


@pytest.mark.asyncio
async def test_compute_time_saved_sums_action_credits(client: AsyncClient, session_override):
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200, login.text
    session = session_override
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    now = datetime.utcnow()

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="test",
        subject="Time saved",
        status="open",
    )
    session.add(signal)
    await session.flush()

    session.add_all(
        [
            SignalMessage(
                signal_id=signal.id,
                tenant_id=tenant.id,
                role="assistant",
                direction="outbound",
                body_text="Auto",
                auto_sent=True,
                created_at=now,
            ),
            SignalMessage(
                signal_id=signal.id,
                tenant_id=tenant.id,
                role="user",
                direction="outbound",
                kind="user_message",
                body_text="Human reply",
                auto_sent=False,
                author_user_id=user.id,
                created_at=now,
            ),
            DecisionRequest(
                tenant_id=tenant.id,
                signal_id=signal.id,
                title="Suggested reply",
                status="approved",
                chosen_option_id="send",
                created_at=now - timedelta(hours=2),
                resolved_at=now - timedelta(hours=1),
            ),
            DecisionRequest(
                tenant_id=tenant.id,
                signal_id=signal.id,
                title="Suggested reply",
                status="approved",
                chosen_option_id="edit",
                created_at=now - timedelta(hours=3),
                resolved_at=now - timedelta(hours=2),
            ),
            DecisionRequest(
                tenant_id=tenant.id,
                signal_id=signal.id,
                title="Suggested reply",
                status="deferred",
                chosen_option_id="human_replied",
                created_at=now - timedelta(hours=4),
                resolved_at=now - timedelta(hours=3),
            ),
            DecisionRequest(
                tenant_id=tenant.id,
                signal_id=signal.id,
                title="Suggested reply",
                status="deferred",
                chosen_option_id="superseded_by_external_reply",
                created_at=now - timedelta(hours=5),
                resolved_at=now - timedelta(hours=4),
            ),
            DecisionRequest(
                tenant_id=tenant.id,
                signal_id=signal.id,
                title="Suggested reply",
                status="deferred",
                chosen_option_id="dismissed",
                created_at=now - timedelta(hours=6),
                resolved_at=now - timedelta(hours=5),
            ),
            DecisionRequest(
                tenant_id=tenant.id,
                signal_id=signal.id,
                title="Suggested reply",
                status="rejected",
                chosen_option_id="send",
                created_at=now - timedelta(hours=7),
                resolved_at=now - timedelta(hours=6),
            ),
            DecisionRequest(
                tenant_id=tenant.id,
                signal_id=signal.id,
                title="No reply needed",
                status="approved",
                chosen_option_id="close",
                created_at=now - timedelta(hours=2),
                resolved_at=now - timedelta(hours=1),
            ),
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant.id,
                event_type="category_set",
                actor_type="agent",
                created_at=now,
            ),
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant.id,
                event_type="category_set",
                actor_type="triage",
                created_at=now,
            ),
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant.id,
                event_type="category_set",
                actor_type="user",
                created_at=now,
            ),
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant.id,
                event_type="no_reply_noted",
                actor_type="system",
                created_at=now,
            ),
            WorkstreamRun(
                tenant_id=tenant.id,
                status="completed",
                completed_at=now,
            ),
            WorkstreamRun(
                tenant_id=tenant.id,
                status="awaiting_gate",
                completed_at=None,
            ),
        ]
    )
    await session.commit()

    result = await compute_time_saved(session, tenant.id, days=7)
    by_action = {row["action"]: row for row in result["by_action"]}

    assert by_action["autonomous_reply"]["count"] == 1
    assert by_action["assisted_draft_unchanged"]["count"] == 1
    assert by_action["assisted_draft_edited"]["count"] == 1
    assert by_action["assisted_draft_human_continued"]["count"] == 2
    assert by_action["no_reply_confirmed"]["count"] == 1
    assert by_action["no_reply_triaged"]["count"] == 1
    assert by_action["ticket_filed_by_agent"]["count"] == 2
    assert by_action["flow_run_completed"]["count"] == 1
    assert by_action["manual_reply"]["count"] == 1

    expected = (
        ACTION_MINUTES["autonomous_reply"]
        + ACTION_MINUTES["assisted_draft_unchanged"]
        + ACTION_MINUTES["assisted_draft_edited"]
        + ACTION_MINUTES["assisted_draft_human_continued"] * 2
        + ACTION_MINUTES["no_reply_confirmed"]
        + ACTION_MINUTES["no_reply_triaged"]
        + ACTION_MINUTES["ticket_filed_by_agent"] * 2
        + ACTION_MINUTES["flow_run_completed"]
    )
    # Manual replies weigh the mix pie but do not inflate time saved.
    assert result["minutes"] == expected
    assert result["days"] == 7
    by_mode = {row["mode"]: row for row in result["by_mode"]}
    assert by_mode["manual"]["count"] == 1
    assert by_mode["manual"]["minutes"] == ACTION_MINUTES["manual_reply"]
    assert by_mode["autonomous"]["count"] >= 1
    assert by_mode["assisted"]["count"] >= 1

    token = login.json()["access_token"]
    summary = await client.get(
        "/api/cockpit/summary",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["time_saved_minutes_week"] >= expected
    assert isinstance(body.get("time_saved_breakdown"), list)
    assert len(body["time_saved_breakdown"]) == len(ACTION_MINUTES)
    assert isinstance(body.get("action_mix"), list)
    assert {row["mode"] for row in body["action_mix"]} == {"autonomous", "assisted", "manual"}
