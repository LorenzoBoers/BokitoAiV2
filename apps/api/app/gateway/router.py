"""Gateway WebSocket endpoint: ``/api/ws``.

Protocol (JSON frames):

Client -> server
  {"type": "connect", "token": "...", "device": "dashboard"}   # if no query token
  {"type": "sub", "topics": ["threads", "run:<id>", "signal:<id>"]}
  {"type": "unsub", "topics": [...]}
  {"type": "ping"}

Server -> client
  {"type": "connected", "session": {...}}
  {"type": "sub_ok", "topics": [...]} / {"type": "sub_denied", "topics": [...]}
  {"type": "event", "event": "message|thread|agent.run|decision|notification|presence|health", ...}
  {"type": "pong"}
  {"type": "error", "message": "..."}

Auth: dashboard JWT (``type=access``) or widget session token
(``type=widget_session``) via ``?access_token=`` or the ``connect`` frame.
Widget principals may only subscribe to ``signal:<id>`` topics for threads
they own (their Contact or their own user).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.gateway.manager import OPERATOR_TOPICS, ConnectionManager, GatewayConnection, manager
from app.gateway.publish import publish_presence
from app.services.livechat_compat import decode_widget_session_token

logger = logging.getLogger(__name__)

router = APIRouter(tags=["gateway"])

CONNECT_TIMEOUT_SECONDS = 10


def _decode_principal(token: str) -> dict | None:
    """Returns {kind, tenant_id, user_id?, customer_id?, staff?} or None."""
    try:
        payload = decode_widget_session_token(token)  # accepts widget_session and access
    except Exception:
        return None
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        return None
    if payload.get("type") == "widget_session":
        return {
            "kind": "widget",
            "tenant_id": str(tenant_id),
            "user_id": payload.get("sub"),
            "customer_id": payload.get("customer_id"),
            "staff": False,
        }
    return {
        "kind": "user",
        "tenant_id": str(tenant_id),
        "user_id": payload.get("sub"),
        "customer_id": None,
        "staff": bool(payload.get("staff", False)),
    }


async def _widget_can_subscribe_signal(
    session: AsyncSession, connection: GatewayConnection, signal_id: str
) -> bool:
    from app.models.channel import Contact
    from app.models.signal import Signal

    try:
        sid = UUID(signal_id)
    except ValueError:
        return False
    result = await session.execute(select(Signal).where(Signal.id == sid))
    signal = result.scalar_one_or_none()
    if not signal or str(signal.tenant_id) != connection.tenant_id:
        return False
    if connection.user_id and signal.owner_user_id and str(signal.owner_user_id) == connection.user_id:
        return True
    if connection.customer_id and signal.contact_id:
        contact_result = await session.execute(select(Contact).where(Contact.id == signal.contact_id))
        contact = contact_result.scalar_one_or_none()
        if contact and contact.address == connection.customer_id:
            return True
    return False


async def _authorize_topics(
    session: AsyncSession, connection: GatewayConnection, topics: list[str]
) -> tuple[list[str], list[str]]:
    allowed: list[str] = []
    denied: list[str] = []
    for topic in topics:
        if not isinstance(topic, str) or not topic:
            continue
        if connection.kind == "user":
            if topic in OPERATOR_TOPICS or topic.startswith(("run:", "signal:")):
                allowed.append(topic)
            else:
                denied.append(topic)
            continue
        # widget principals: only their own signal threads
        if topic.startswith("signal:") and await _widget_can_subscribe_signal(
            session, connection, topic.removeprefix("signal:")
        ):
            allowed.append(topic)
        else:
            denied.append(topic)
    return allowed, denied


@router.websocket("/ws")
async def gateway_websocket(
    websocket: WebSocket,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    await websocket.accept()

    token = (
        websocket.query_params.get("access_token")
        or websocket.query_params.get("token")
        or ""
    ).strip()
    device = (websocket.query_params.get("device") or "").strip()

    principal = None
    if token:
        principal = _decode_principal(token)
    else:
        # Allow a connect frame carrying the token (clients that cannot set query params).
        try:
            first = await asyncio.wait_for(websocket.receive_json(), timeout=CONNECT_TIMEOUT_SECONDS)
        except (asyncio.TimeoutError, WebSocketDisconnect):
            await websocket.close(code=4401)
            return
        if isinstance(first, dict) and first.get("type") == "connect":
            principal = _decode_principal(str(first.get("token") or ""))
            device = str(first.get("device") or device)
    if principal is None:
        try:
            await websocket.send_json({"type": "error", "message": "unauthorized"})
        except Exception:
            pass
        await websocket.close(code=4401)
        return

    connection = GatewayConnection(
        websocket,
        tenant_id=principal["tenant_id"],
        kind=principal["kind"],
        user_id=principal.get("user_id"),
        customer_id=principal.get("customer_id"),
        device=device,
        is_staff=principal.get("staff", False),
    )
    manager.register(connection)
    await websocket.send_json(
        {
            "type": "connected",
            "session": {
                "connection_id": connection.id,
                "tenant_id": connection.tenant_id,
                "kind": connection.kind,
                "user_id": connection.user_id,
                "device": connection.device,
            },
        }
    )
    if connection.kind == "user" and connection.user_id:
        await publish_presence(
            connection.tenant_id,
            user_id=UUID(connection.user_id),
            device=device or "dashboard",
            online=True,
        )

    try:
        while True:
            frame = await websocket.receive_json()
            if not isinstance(frame, dict):
                continue
            frame_type = frame.get("type")
            if frame_type == "ping":
                await websocket.send_json({"type": "pong"})
            elif frame_type == "sub":
                topics = frame.get("topics") or []
                allowed, denied = await _authorize_topics(session, connection, topics)
                connection.topics.update(allowed)
                response: dict = {"type": "sub_ok", "topics": allowed}
                if denied:
                    response["denied"] = denied
                await websocket.send_json(response)
            elif frame_type == "unsub":
                for topic in frame.get("topics") or []:
                    connection.topics.discard(topic)
                await websocket.send_json({"type": "unsub_ok"})
            elif frame_type == "connect":
                # Already connected; ignore re-auth frames.
                continue
            else:
                await websocket.send_json({"type": "error", "message": "unknown frame type"})
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("gateway connection error", exc_info=True)
    finally:
        manager.unregister(connection)
        if connection.kind == "user" and connection.user_id:
            try:
                await publish_presence(
                    connection.tenant_id,
                    user_id=UUID(connection.user_id),
                    device=device or "dashboard",
                    online=False,
                )
            except Exception:
                pass


__all__ = ["router", "manager", "ConnectionManager"]
