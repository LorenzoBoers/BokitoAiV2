"""Push notification dispatch for mobile (Expo) and web."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.auth import User
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.models.usage import PushSubscription
from app.services.push import notify_decision, notify_thread_message


from scripts.seed import TEST_EMAIL


@pytest.mark.asyncio
async def test_notify_thread_message_sends_expo_push(client, session_override):
    from app.models.auth import Tenant

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Billing question",
        assigned_user_id=user.id,
        status="open",
    )
    session_override.add(signal)
    await session_override.flush()

    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        direction="inbound",
        body_text="Can you help with my invoice?",
        body_preview="Can you help with my invoice?",
    )
    session_override.add(message)
    session_override.add(
        PushSubscription(
            tenant_id=tenant.id,
            user_id=user.id,
            endpoint="expo:ExponentPushToken[test-token]",
            keys_json='{"provider": "expo"}',
        )
    )
    await session_override.commit()

    with patch("app.services.push._send_expo_push", new_callable=AsyncMock) as mock_expo:
        mock_expo.return_value = True
        sent = await notify_thread_message(session_override, signal, message)

    assert sent == 1
    mock_expo.assert_awaited_once()
    args = mock_expo.await_args.args
    assert args[0] == "ExponentPushToken[test-token]"
    assert args[1] == "Billing question"
    assert args[3]["signal_id"] == str(signal.id)


@pytest.mark.asyncio
async def test_notify_thread_message_skips_outbound(client, session_override):
    from app.models.auth import Tenant

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = Signal(tenant_id=tenant.id, channel="email", subject="Outbound only")
    session_override.add(signal)
    await session_override.flush()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        direction="outbound",
        body_text="Thanks!",
    )
    session_override.add(message)
    await session_override.commit()

    with patch("app.services.push._send_expo_push", new_callable=AsyncMock) as mock_expo:
        sent = await notify_thread_message(session_override, signal, message)

    assert sent == 0
    mock_expo.assert_not_awaited()


@pytest.mark.asyncio
async def test_notify_decision_sends_expo_push(client, session_override):
    from app.models.auth import Tenant

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User).limit(1))).scalar_one()

    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        subject="Agent needs approval",
        assigned_user_id=user.id,
    )
    session_override.add(signal)
    await session_override.flush()

    decision = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=signal.id,
        title="Approve refund",
        summary="Customer requests a full refund",
        status="awaiting_human",
    )
    session_override.add(decision)
    session_override.add(
        PushSubscription(
            tenant_id=tenant.id,
            user_id=user.id,
            endpoint=f"expo:ExponentPushToken[{uuid4()}]",
            keys_json='{"provider": "expo"}',
        )
    )
    await session_override.commit()

    with patch("app.services.push._send_expo_push", new_callable=AsyncMock) as mock_expo:
        mock_expo.return_value = True
        sent = await notify_decision(session_override, decision)

    assert sent == 1
    mock_expo.assert_awaited_once()
    payload = mock_expo.await_args.args[3]
    assert payload["decision_id"] == str(decision.id)
    assert payload["signal_id"] == str(signal.id)
