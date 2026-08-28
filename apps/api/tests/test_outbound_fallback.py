"""Email replies fall back to a workspace mailbox when the thread has none."""

import pytest
from sqlalchemy import select

from app.channels.outbound import deliver_outbound
from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.models.signal import Signal


@pytest.mark.asyncio
async def test_email_reply_uses_workspace_mailbox_when_thread_has_none(session_override):
    tenant = Tenant(slug="outbound-fb", name="Outbound fallback")
    session_override.add(tenant)
    await session_override.flush()
    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        address="hello@bokito.test",
        provider="mock",
        is_enabled=True,
    )
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="email",
        subject="Vraag over factuur 4821",
        contact_email="sanne@klant.nl",
        contact_name="Sanne de Vries",
    )
    session_override.add(account)
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    status = await deliver_outbound(session_override, signal, body_text="Het bedrag klopt.")
    assert status == "sent"
    await session_override.refresh(signal)
    assert signal.channel_account_id == account.id


@pytest.mark.asyncio
async def test_email_reply_stays_skipped_without_any_mailbox(session_override):
    tenant = Tenant(slug="outbound-empty", name="Outbound empty")
    session_override.add(tenant)
    await session_override.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="email",
        subject="Offerte",
        contact_email="prospect@example.com",
    )
    session_override.add(signal)
    await session_override.commit()

    status = await deliver_outbound(session_override, signal, body_text="Graag gedaan.")
    assert status == "skipped"
    loaded = (
        await session_override.execute(select(Signal).where(Signal.id == signal.id))
    ).scalar_one()
    assert loaded.channel_account_id is None
