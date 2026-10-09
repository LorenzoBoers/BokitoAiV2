"""Gateway control plane: WS auth, topic fanout, and domain event publishing."""

import uuid
from datetime import datetime, timedelta

from jose import jwt
from starlette.testclient import TestClient

from app.config import get_settings
from app.gateway.bus import event_bus
from app.gateway.manager import GatewayConnection, manager
from app.gateway.router import _decode_principal
from app.services.livechat_compat import create_widget_session_token

settings = get_settings()


def _access_token(tenant_id: str, user_id: str, staff: bool = False) -> str:
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "type": "access",
        "staff": staff,
        "exp": datetime.utcnow() + timedelta(hours=1),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


class FakeWebSocket:
    def __init__(self) -> None:
        self.frames: list[dict] = []

    async def send_json(self, frame: dict) -> None:
        self.frames.append(frame)


def test_decode_principal_access_and_widget_tokens():
    tenant_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    user_principal = _decode_principal(_access_token(tenant_id, user_id))
    assert user_principal == {
        "kind": "user",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "customer_id": None,
        "staff": False,
    }

    widget_token = create_widget_session_token(
        tenant_id=uuid.UUID(tenant_id), customer_id="visitor-1"
    )
    widget_principal = _decode_principal(widget_token)
    assert widget_principal["kind"] == "widget"
    assert widget_principal["tenant_id"] == tenant_id
    assert widget_principal["customer_id"] == "visitor-1"

    assert _decode_principal("not-a-token") is None


async def test_bus_dispatches_to_matching_connections_only():
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())

    ws_a = FakeWebSocket()
    conn_a = GatewayConnection(ws_a, tenant_id=tenant_a, kind="user", user_id="u1")
    conn_a.topics = {"threads"}

    ws_b = FakeWebSocket()
    conn_b = GatewayConnection(ws_b, tenant_id=tenant_b, kind="user", user_id="u2")
    conn_b.topics = {"threads"}

    ws_c = FakeWebSocket()
    conn_c = GatewayConnection(ws_c, tenant_id=tenant_a, kind="user", user_id="u3")
    conn_c.topics = {"runs"}  # subscribed to a different topic

    manager.register(conn_a)
    manager.register(conn_b)
    manager.register(conn_c)
    try:
        await event_bus.publish(tenant_a, ["threads"], "thread", {"thread": {"signal_id": "x"}})
    finally:
        manager.unregister(conn_a)
        manager.unregister(conn_b)
        manager.unregister(conn_c)

    assert len(ws_a.frames) == 1
    assert ws_a.frames[0]["type"] == "event"
    assert ws_a.frames[0]["event"] == "thread"
    assert ws_b.frames == []
    assert ws_c.frames == []


async def test_signal_message_publish_reaches_thread_subscribers(client, session_override):
    """append_signal_chat_message publishes a `message` event on the bus."""
    from app.models.auth import Tenant
    from app.models.signal import Signal
    from app.services.assistant_threads import append_signal_chat_message
    from sqlalchemy import select

    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    signal = Signal(tenant_id=tenant.id, channel="assistant", source="chat", subject="Test")
    session_override.add(signal)
    await session_override.flush()

    ws = FakeWebSocket()
    conn = GatewayConnection(ws, tenant_id=str(tenant.id), kind="user", user_id="u1")
    conn.topics = {f"signal:{signal.id}"}
    manager.register(conn)
    try:
        await append_signal_chat_message(session_override, signal, role="user", content="hello")
    finally:
        manager.unregister(conn)

    assert len(ws.frames) == 1
    frame = ws.frames[0]
    assert frame["event"] == "message"
    assert frame["data"]["message"]["body_text"] == "hello"
    # Events carry the canonical REST thread row so clients can upsert directly.
    assert frame["data"]["thread"]["id"] == str(signal.id)
    assert frame["data"]["audience"] == "all"


async def _seed_thread(session, *, kind: str, body: str):
    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.models.signal import Signal, SignalMessage

    tenant = (await session.execute(select(Tenant))).scalars().first()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="outlook",
        subject="Order 42",
        contact_email="k@x.nl",
    )
    session.add(signal)
    await session.flush()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind=kind,
        direction="internal" if kind == "internal_note" else "inbound",
        role="user",
        body_text=body,
        body_preview=body[:200],
        created_at=datetime.utcnow(),
    )
    session.add(message)
    await session.flush()
    return tenant, signal, message


async def test_message_event_carries_canonical_payloads(client, session_override):
    """Events reuse the REST serializers so clients can upsert/append directly."""
    from app.gateway.publish import publish_signal_message
    from app.services.signal_threads import serialize_message, serialize_thread

    tenant, signal, message = await _seed_thread(
        session_override, kind="user_message", body="Waar blijft mijn order?"
    )

    operator_ws, widget_ws = FakeWebSocket(), FakeWebSocket()
    operator = GatewayConnection(operator_ws, tenant_id=str(tenant.id), kind="user", user_id="u1")
    operator.topics = {"threads", f"signal:{signal.id}"}
    widget = GatewayConnection(
        widget_ws, tenant_id=str(tenant.id), kind="widget", customer_id="k@x.nl"
    )
    widget.topics = {f"signal:{signal.id}"}
    manager.register(operator)
    manager.register(widget)
    try:
        await publish_signal_message(signal, message)
    finally:
        manager.unregister(operator)
        manager.unregister(widget)

    # Operator: a light list frame on `threads` plus the full message frame.
    assert len(operator_ws.frames) == 2
    list_frame = next(f for f in operator_ws.frames if "threads" in f["topics"])
    full_frame = next(f for f in operator_ws.frames if f"signal:{signal.id}" in f["topics"])
    assert list_frame["data"]["audience"] == "operator"
    assert list_frame["data"]["thread"] == serialize_thread(signal)
    assert "body_text" not in list_frame["data"]["message"]  # preview only
    assert full_frame["data"]["audience"] == "all"
    assert full_frame["data"]["message"] == serialize_message(message)

    # Widget: only the customer-visible full message frame; the operator list
    # feed never reaches visitor connections.
    assert len(widget_ws.frames) == 1
    assert widget_ws.frames[0]["data"]["message"]["body_text"] == "Waar blijft mijn order?"


async def test_internal_notes_never_reach_widget_connections(client, session_override):
    from app.gateway.publish import publish_signal_message, publish_thread_update

    tenant, signal, note = await _seed_thread(
        session_override, kind="internal_note", body="Klant belt vaak; eerst factuur checken."
    )

    operator_ws, widget_ws = FakeWebSocket(), FakeWebSocket()
    operator = GatewayConnection(operator_ws, tenant_id=str(tenant.id), kind="user", user_id="u1")
    operator.topics = {"threads", f"signal:{signal.id}"}
    widget = GatewayConnection(
        widget_ws, tenant_id=str(tenant.id), kind="widget", customer_id="k@x.nl"
    )
    widget.topics = {f"signal:{signal.id}"}
    manager.register(operator)
    manager.register(widget)
    try:
        await publish_signal_message(signal, note)
        await publish_thread_update(signal)
    finally:
        manager.unregister(operator)
        manager.unregister(widget)

    # Operator sees the note and the triage row; the visitor sees nothing.
    assert any(f["event"] == "message" for f in operator_ws.frames)
    assert any(f["event"] == "thread" for f in operator_ws.frames)
    assert widget_ws.frames == []


def test_websocket_connect_subscribe_ping():
    from app.main import app

    tenant_id = str(uuid.uuid4())
    token = _access_token(tenant_id, str(uuid.uuid4()))
    with TestClient(app) as client:
        with client.websocket_connect(f"/api/ws?access_token={token}&device=test") as ws:
            connected = ws.receive_json()
            assert connected["type"] == "connected"
            assert connected["session"]["tenant_id"] == tenant_id
            assert connected["session"]["kind"] == "user"

            ws.send_json({"type": "sub", "topics": ["threads", "decisions", "bogus-topic"]})
            sub = ws.receive_json()
            assert sub["type"] == "sub_ok"
            assert set(sub["topics"]) == {"threads", "decisions"}
            assert sub["denied"] == ["bogus-topic"]

            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"


def test_websocket_rejects_invalid_token():
    from app.main import app

    with TestClient(app) as client:
        with client.websocket_connect("/api/ws?access_token=invalid") as ws:
            frame = ws.receive_json()
            assert frame["type"] == "error"
            assert frame["message"] == "unauthorized"


def test_websocket_connect_frame_auth():
    from app.main import app

    tenant_id = str(uuid.uuid4())
    token = _access_token(tenant_id, str(uuid.uuid4()))
    with TestClient(app) as client:
        with client.websocket_connect("/api/ws") as ws:
            ws.send_json({"type": "connect", "token": token, "device": "mobile"})
            connected = ws.receive_json()
            assert connected["type"] == "connected"
            assert connected["session"]["device"] == "mobile"


async def test_set_read_publishes_thread_update(client, session_override, monkeypatch):
    """Mark-read must fan out so other operators see the unread badge drop."""
    from app.models.auth import Tenant, User
    from app.models.signal import Signal
    from app.services import signal_threads as svc
    from sqlalchemy import select

    calls: list[str] = []

    async def fake_publish(signal, **_kwargs):
        calls.append(str(signal.id))

    monkeypatch.setattr(svc, "publish_thread_update", fake_publish)

    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    user = (await session_override.execute(select(User))).scalars().first()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="outlook",
        subject="Unread mail",
        contact_email="k@x.nl",
        has_unread=True,
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    row = await svc.set_read(
        session_override,
        tenant.id,
        user.id,
        1,
        signal.id,
        read=True,
    )
    assert row is not None
    assert row["has_unread"] is False
    assert calls == [str(signal.id)]


async def test_send_email_publishes_message_and_thread(client, session_override, monkeypatch):
    """Outbound compose must push the new message so open threads update live."""
    from types import SimpleNamespace

    from app.models.auth import Tenant, User
    from app.models.channel import ChannelAccount
    from app.models.signal import Signal
    from app.routers import email as email_router
    from sqlalchemy import select

    published: list[tuple[str, str]] = []

    async def fake_message(signal, message, **_kwargs):
        published.append(("message", str(message.id)))

    async def fake_thread(signal, **_kwargs):
        published.append(("thread", str(signal.id)))

    monkeypatch.setattr("app.gateway.publish.publish_signal_message", fake_message)
    monkeypatch.setattr("app.gateway.publish.publish_thread_update", fake_thread)

    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    user = (await session_override.execute(select(User))).scalars().first()
    account = (
        await session_override.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id,
                ChannelAccount.channel == "email",
            )
        )
    ).scalars().first()
    if account is None:
        account = ChannelAccount(
            tenant_id=tenant.id,
            channel="email",
            address="desk@test.local",
            provider="mock",
            credentials_json='{"mock": true}',
            is_enabled=True,
        )
        session_override.add(account)
        await session_override.commit()
        await session_override.refresh(account)

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source=account.provider,
        subject="Compose reply",
        contact_email="k@x.nl",
        channel_account_id=account.id,
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    auth = SimpleNamespace(tenant=tenant, user=user)
    body = email_router.SendEmailRequest(
        body_text="Thanks for the update.",
        thread_id=signal.id,
    )
    result = await email_router.send_email(body, auth, session_override)
    assert result["ok"] is True
    assert ("message", result["id"]) in published
    assert ("thread", str(signal.id)) in published
