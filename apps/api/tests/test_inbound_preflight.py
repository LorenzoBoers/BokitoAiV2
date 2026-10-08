"""Inbound worker preflight is shared between interpret and reply paths."""

import pytest
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.workers.tasks import _inbound_preflight, _interpret_inbound_message


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

    # Interpret must skip the LLM for automated mail and still return preflight.
    again = await _interpret_inbound_message(session_override, tenant.id, signal)
    assert again.classification.get("automated") is True
    row = (
        await session_override.execute(select(Signal).where(Signal.id == signal.id))
    ).scalar_one()
    assert row.triaged_at is None
