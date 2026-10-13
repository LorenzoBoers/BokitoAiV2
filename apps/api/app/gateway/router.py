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
OFFLINE_GRACE_SECONDS = 15

_pending_offline: dict[str, asyncio.Task] = {}


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


async def _user_can_subscribe_resource(
    session: AsyncSession, connection: GatewayConnection, topic: str
) -> bool:
    """Resource topics must belong to the caller's tenant (defense-in-depth;
    event delivery is additionally filtered on envelope tenant_id)."""
    from app.models.agent import AgentRun
    from app.models.signal import Signal

    kind, _, raw_id = topic.partition(":")
    try:
        resource_id = UUID(raw_id)
    except ValueError:
        return False
    model = Signal if kind == "signal" else AgentRun
    result = await session.execute(
        select(model.id).where(
            model.id == resource_id, model.tenant_id == UUID(connection.tenant_id)
        )
    )
    return result.scalar_one_or_none() is not None


async def _authorize_topics(
    session: AsyncSession, connection: GatewayConnection, topics: list[str]
) -> tuple[list[str], list[str]]:
    allowed: list[str] = []
    denied: list[str] = []
    for topic in topics:
        if not isinstance(topic, str) or not topic:
            continue
        if connection.kind == "user":
            if topic in OPERATOR_TOPICS:
                allowed.append(topic)
            elif topic.startswith(("run:", "signal:")) and await _user_can_subscribe_resource(
                session, connection, topic
            ):
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


def _connected_user_ids(tenant_id: str) -> set[str]:
    return manager.user_ids(tenant_id)


def _cancel_pending_offline(user_id: str | None) -> None:
    if not user_id:
        return
    task = _pending_offline.pop(user_id, None)
    if task and not task.done():
        task.cancel()


def _schedule_offline(user_id: str, tenant_id: str, device: str) -> None:
    _cancel_pending_offline(user_id)

    async def _run() -> None:
        try:
            await asyncio.sleep(OFFLINE_GRACE_SECONDS)
            if user_id in _connected_user_ids(tenant_id):
                return
            from app.db.session import async_session_factory
            from app.services.presence import mark_offline, visible_user_status
            from app.models.auth import User

            async with async_session_factory() as session:
                await mark_offline(session, UUID(user_id))
                if user_id in _connected_user_ids(tenant_id):
                    return
                user = await session.get(User, UUID(user_id))
                status = visible_user_status(user, connected=False) if user else "offline"
            await publish_presence(
                tenant_id,
                user_id=UUID(user_id),
                device=device,
                online=False,
                status=status,
            )
        except asyncio.CancelledError:
            return
        except Exception:
            logger.debug("delayed presence offline failed", exc_info=True)
        finally:
            current = _pending_offline.get(user_id)
            if current is asyncio.current_task():
                _pending_offline.pop(user_id, None)

    _pending_offline[user_id] = asyncio.create_task(_run())


async def _touch_presence(session: AsyncSession, connection: GatewayConnection, *, force: bool = False) -> bool:
    from app.services.presence import touch

    try:
        return await touch(session, UUID(connection.user_id), force=force)
    except Exception:
        logger.debug("presence touch failed", exc_info=True)
        await session.rollback()
        return False


async def _presence_status(session: AsyncSession, connection: GatewayConnection) -> str | None:
    from app.models.auth import User
    from app.services.presence import visible_user_status

    try:
        user = await session.get(User, UUID(connection.user_id))
        if user is None:
            return None
        await session.refresh(user)
    except Exception:
        return None
    connected = connection.user_id in _connected_user_ids(connection.tenant_id)
    return visible_user_status(user, connected=connected)


async def _send_presence_snapshot(
    session: AsyncSession,
    connection: GatewayConnection,
    *,
    include_people: bool,
    include_agents: bool,
) -> None:
    """Replay current status onto this socket. Connect publishes too early to be heard."""
    from app.services.presence import presence_snapshot

    try:
        tenant_id = UUID(connection.tenant_id)
    except ValueError:
        return
    try:
        events = await presence_snapshot(
            session,
            tenant_id,
            connected_user_ids=_connected_user_ids(connection.tenant_id),
            include_people=include_people,
            include_agents=include_agents,
        )
    except Exception:
        logger.debug("presence snapshot failed", exc_info=True)
        await session.rollback()
        return
    for event, data in events:
        topics = ["presence"] if event == "presence" else ["presence", "agents"]
        try:
            await connection.send(
                {"type": "event", "event": event, "topics": topics, "data": data}
            )
        except Exception:
            return


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
    is_operator = connection.kind == "user" and bool(connection.user_id)
    if is_operator:
        _cancel_pending_offline(connection.user_id)
        await _touch_presence(session, connection, force=True)
        await publish_presence(
            connection.tenant_id,
            user_id=UUID(connection.user_id),
            device=device or "dashboard",
            online=True,
            status=await _presence_status(session, connection),
        )

    try:
        while True:
            frame = await websocket.receive_json()
            if not isinstance(frame, dict):
                continue
            frame_type = frame.get("type")
            if frame_type == "ping":
                await websocket.send_json({"type": "pong"})
                if is_operator:
                    await _touch_presence(session, connection)
                    await publish_presence(
                        connection.tenant_id,
                        user_id=UUID(connection.user_id),
                        device=device or "dashboard",
                        online=True,
                        status=await _presence_status(session, connection),
                    )
            elif frame_type == "sub":
                topics = frame.get("topics") or []
                allowed, denied = await _authorize_topics(session, connection, topics)
                connection.topics.update(allowed)
                response: dict = {"type": "sub_ok", "topics": allowed}
                if denied:
                    response["denied"] = denied
                await websocket.send_json(response)
                if is_operator and ("presence" in allowed or "agents" in allowed):
                    await _send_presence_snapshot(
                        session,
                        connection,
                        include_people="presence" in allowed,
                        include_agents="presence" in allowed or "agents" in allowed,
                    )
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
        if is_operator:
            try:
                still_connected = connection.user_id in _connected_user_ids(connection.tenant_id)
                if still_connected:
                    status = await _presence_status(session, connection)
                    await publish_presence(
                        connection.tenant_id,
                        user_id=UUID(connection.user_id),
                        device=device or "dashboard",
                        online=True,
                        status=status,
                    )
                elif connection.user_id:
                    _schedule_offline(
                        connection.user_id,
                        connection.tenant_id,
                        device or "dashboard",
                    )
            except Exception:
                pass


__all__ = ["router", "manager", "ConnectionManager"]
