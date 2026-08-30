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
    assert status.status == "sent"
    assert status.body_html is not None
    assert "Het bedrag klopt" in status.body_html
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
    assert status.status == "skipped"
    assert status.body_html is None
    loaded = (
        await session_override.execute(select(Signal).where(Signal.id == signal.id))
    ).scalar_one()
    assert loaded.channel_account_id is None


@pytest.mark.asyncio
async def test_deliver_outbound_includes_signature_in_returned_html(session_override):
    """Timeline callers persist body_html from the delivery result."""
    import json

    tenant = Tenant(slug="outbound-sig", name="Outbound sig")
    session_override.add(tenant)
    await session_override.flush()
    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        address="hello@bokito.test",
        provider="mock",
        is_enabled=True,
        settings_json=json.dumps({"signature_html": "<p>Met vriendelijke groet,<br>Bokito</p>"}),
    )
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="email",
        subject="Hallo",
        contact_email="klant@example.com",
        channel_account_id=None,
    )
    session_override.add(account)
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    result = await deliver_outbound(
        session_override,
        signal,
        body_text="Beste klant,\nHier is het antwoord.",
        signature_html="<p>Groet,<br>Lorenzo</p>",
    )
    assert result.status == "sent"
    assert result.body_html is not None
    assert "Hier is het antwoord" in result.body_html
    assert "Groet,<br>Lorenzo" in result.body_html
    assert "Met vriendelijke groet" not in result.body_html  # override replaces mailbox
