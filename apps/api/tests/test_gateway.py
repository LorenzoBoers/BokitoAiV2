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
    assert frame["data"]["thread"]["signal_id"] == str(signal.id)


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
