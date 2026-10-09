"""Inbound worker preflight is shared between interpret and reply paths."""

import pytest
from datetime import datetime, timezone

from app.models.auth import Membership, Tenant, User
from app.models.signal import Signal, SignalMessage
from app.services.auth import hash_password
from app.workers.tasks import _inbound_preflight


@pytest.mark.asyncio
async def test_inbound_preflight_marks_automated_mail(session_override):
    tenant = Tenant(slug="preflight-auto", name="Preflight Auto")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Out of office",
        contact_email="noreply@example.com",
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            direction="inbound",
            role="customer",
            from_address="noreply@example.com",
            body_text="I am away",
            body_preview="I am away",
            metadata_json='{"auto_headers": {"auto-submitted": "auto-replied"}}',
        )
    )
    await session_override.commit()

    preflight = await _inbound_preflight(session_override, tenant.id, signal)
    assert preflight.msg is not None
    assert preflight.classification.get("automated") is True
    assert preflight.is_member is False
    # Interpretation is the channel agent's job; automated mail never gets a
    # silent platform triage pass before the worker skip.
    assert signal.triaged_at is None


@pytest.mark.asyncio
async def test_inbound_preflight_ignores_stale_author_after_deactivation(session_override):
    """Messages stamped with author_user_id before deactivation must get AI again."""
    tenant = Tenant(slug="preflight-ex-member", name="Preflight Ex")
    user = User(
        email="ex@example.com",
        password_hash=hash_password("x"),
        display_name="Ex",
        email_verified=True,
    )
    session_override.add(tenant)
    session_override.add(user)
    await session_override.commit()
    await session_override.refresh(tenant)
    await session_override.refresh(user)
    session_override.add(
        Membership(
            tenant_id=tenant.id,
            user_id=user.id,
            role="member",
            is_active=False,
            deactivated_at=datetime.now(timezone.utc),
        )
    )
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Still external",
        contact_email=user.email,
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            direction="inbound",
            role="customer",
            from_address=user.email,
            body_text="Hello again",
            body_preview="Hello again",
            author_user_id=user.id,  # stamped while they were still a member
        )
    )
    await session_override.commit()

    preflight = await _inbound_preflight(session_override, tenant.id, signal)
    assert preflight.is_member is False
