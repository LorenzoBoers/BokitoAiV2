"""Ops alerts: run/channel failures create admin notifications with dedupe."""

import json
from datetime import datetime, timedelta

from sqlalchemy import select

from app.models.auth import Membership, Tenant, User
from app.models.notification import Notification, UserNotificationPreference
from app.services.ops_alerts import (
    OPS_CHANNEL_DISCONNECT,
    OPS_RUN_FAILED,
    alert_run_failure,
    notify_tenant_admins,
)


async def _tenant_with_admins(session, *, members: int = 0):
    tenant = Tenant(slug="ops-test", name="Ops Test")
    owner = User(email="owner@ops.test", password_hash="x", display_name="Owner")
    admin = User(email="admin@ops.test", password_hash="x", display_name="Admin")
    member = User(email="member@ops.test", password_hash="x", display_name="Member")
    session.add_all([tenant, owner, admin, member])
    await session.commit()
    session.add_all(
        [
            Membership(tenant_id=tenant.id, user_id=owner.id, role="owner"),
            Membership(tenant_id=tenant.id, user_id=admin.id, role="admin"),
            Membership(tenant_id=tenant.id, user_id=member.id, role="member"),
        ]
    )
    await session.commit()
    return tenant, owner, admin, member


async def _notifications(session, tenant_id):
    result = await session.execute(
        select(Notification).where(
            Notification.tenant_id == tenant_id, Notification.kind == "ops_alert"
        )
    )
    return list(result.scalars().all())


async def test_ops_alert_targets_owners_and_admins_only(session_override):
    session = session_override
    tenant, owner, admin, member = await _tenant_with_admins(session)

    created = await notify_tenant_admins(
        session,
        tenant.id,
        category=OPS_RUN_FAILED,
        title="Run failed: test",
        body="boom",
    )
    assert created == 2

    rows = await _notifications(session, tenant.id)
    targeted = {row.user_id for row in rows}
    assert targeted == {owner.id, admin.id}
    assert member.id not in targeted
    payload = json.loads(rows[0].payload_json)
    assert payload["category"] == OPS_RUN_FAILED


async def test_ops_alert_dedupes_within_cooldown(session_override):
    session = session_override
    tenant, *_ = await _tenant_with_admins(session)

    first = await notify_tenant_admins(
        session, tenant.id, category=OPS_RUN_FAILED, title="Run failed: dup", body="a"
    )
    second = await notify_tenant_admins(
        session, tenant.id, category=OPS_RUN_FAILED, title="Run failed: dup", body="b"
    )
    assert first == 2
    assert second == 0
    assert len(await _notifications(session, tenant.id)) == 2

    # A different title is a different problem: alerts again.
    third = await notify_tenant_admins(
        session, tenant.id, category=OPS_RUN_FAILED, title="Run failed: other", body="c"
    )
    assert third == 2


async def test_ops_alert_alerts_again_after_cooldown(session_override):
    session = session_override
    tenant, *_ = await _tenant_with_admins(session)

    await notify_tenant_admins(
        session, tenant.id, category=OPS_RUN_FAILED, title="Run failed: aged", body="a"
    )
    # Age the existing notifications past the cooldown window.
    for row in await _notifications(session, tenant.id):
        row.created_at = datetime.utcnow() - timedelta(hours=2)
        session.add(row)
    await session.commit()

    again = await notify_tenant_admins(
        session, tenant.id, category=OPS_RUN_FAILED, title="Run failed: aged", body="b"
    )
    assert again == 2


async def test_ops_alert_respects_disabled_desktop_pref(session_override):
    session = session_override
    tenant, owner, admin, _ = await _tenant_with_admins(session)

    session.add(
        UserNotificationPreference(
            tenant_id=tenant.id,
            user_id=owner.id,
            prefs_json=json.dumps(
                [
                    {
                        "id": OPS_RUN_FAILED,
                        "label": "x",
                        "channels": {"desktop": False, "email": False, "mobile": False},
                    }
                ]
            ),
        )
    )
    await session.commit()

    created = await notify_tenant_admins(
        session, tenant.id, category=OPS_RUN_FAILED, title="Run failed: prefs", body="a"
    )
    assert created == 1
    rows = await _notifications(session, tenant.id)
    assert {row.user_id for row in rows} == {admin.id}


async def test_alert_run_failure_builds_payload(session_override):
    session = session_override
    tenant, *_ = await _tenant_with_admins(session)

    created = await alert_run_failure(
        session,
        tenant.id,
        subject="Email: order question",
        error=RuntimeError("model timeout"),
    )
    assert created == 2
    rows = await _notifications(session, tenant.id)
    assert rows[0].title == "Run failed: Email: order question"
    assert "model timeout" in rows[0].body


async def test_channel_disconnect_alert_via_sync_error(session_override):
    session = session_override
    from app.models.channel import ChannelAccount
    from app.services.email_sync import _record_sync_error

    tenant, *_ = await _tenant_with_admins(session)
    account = ChannelAccount(
        tenant_id=tenant.id, channel="email", address="inbox@ops.test", provider="outlook"
    )
    session.add(account)
    await session.commit()

    # Auth expiry alerts immediately.
    await _record_sync_error(session, account, "Authentication expired.", kind="auth_expired")
    rows = await _notifications(session, tenant.id)
    assert len(rows) == 2
    assert "inbox@ops.test" in rows[0].title
    payload = json.loads(rows[0].payload_json)
    assert payload["category"] == OPS_CHANNEL_DISCONNECT

    # Repeat within 24h: suppressed by the per-account cooldown.
    await _record_sync_error(session, account, "Authentication expired.", kind="auth_expired")
    assert len(await _notifications(session, tenant.id)) == 2


async def test_generic_sync_errors_alert_after_three_failures(session_override):
    session = session_override
    from app.models.channel import ChannelAccount
    from app.services.email_sync import _record_sync_error

    tenant, *_ = await _tenant_with_admins(session)
    account = ChannelAccount(
        tenant_id=tenant.id, channel="email", address="flaky@ops.test", provider="gmail"
    )
    session.add(account)
    await session.commit()

    await _record_sync_error(session, account, "Sync failed: timeout")
    await _record_sync_error(session, account, "Sync failed: timeout")
    assert len(await _notifications(session, tenant.id)) == 0

    await _record_sync_error(session, account, "Sync failed: timeout")
    rows = await _notifications(session, tenant.id)
    assert len(rows) == 2
    settings = json.loads(account.settings_json)
    assert settings["sync_error_count"] == 3
    assert settings.get("last_ops_alert_at")
