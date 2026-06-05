import pytest
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.learning import EvalScore, Feedback
from app.models.signal import Signal, SignalEvent, SignalMessage


@pytest.mark.asyncio
async def test_signal_roundtrip(session_override):
    tenant = Tenant(slug="sig", name="Sig")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    sig = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="gmail",
        subject="Hello there",
        contact_email="a@b.com",
    )
    session_override.add(sig)
    await session_override.commit()
    await session_override.refresh(sig)

    session_override.add(
        SignalMessage(signal_id=sig.id, tenant_id=tenant.id, direction="inbound", body_text="hi")
    )
    session_override.add(SignalEvent(signal_id=sig.id, tenant_id=tenant.id, event_type="created"))
    session_override.add(
        Feedback(tenant_id=tenant.id, subject_type="signal", subject_id=str(sig.id), score=5)
    )
    session_override.add(
        EvalScore(tenant_id=tenant.id, scope="tenant", metric="autonomy_rate", value=0.8, sample_size=10)
    )
    await session_override.commit()

    rows = (
        await session_override.execute(select(Signal).where(Signal.tenant_id == tenant.id))
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].status == "open"
    assert rows[0].priority == "normal"
    assert rows[0].certainty is None  # not yet triaged

    msgs = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == sig.id)
        )
    ).scalars().all()
    assert len(msgs) == 1
