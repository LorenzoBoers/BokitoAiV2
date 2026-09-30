"""WebSocket gateway: `GET /api/ws?token=...` with topic subscriptions.

Client -> server: {"op": "subscribe", "topics": ["conversations", "conversation:<id>"]}
Server -> client: {"topic": "...", "event": "...", ...} and {"op": "pong"}.
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError

from bokito.db import get_session_factory
from bokito.domain.identity import User
from bokito.realtime.broker import broker
from bokito.services import identity

router = APIRouter()


async def _authenticate(token: str) -> uuid.UUID | None:
    try:
        payload = identity.decode_access_token(token)
    except Exception:
        return None
    if not payload.get("tid"):
        return None
    tenant_id = uuid.UUID(payload["tid"])
    async with get_session_factory()() as session:
        user = await session.get(User, uuid.UUID(payload["sub"]))
        if not user:
            return None
        membership = await identity.membership_for(session, user.id, tenant_id)
        if not membership and not user.is_staff:
            return None
    return tenant_id


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    token = ws.query_params.get("token", "")
    tenant_id = None
    with contextlib.suppress(JWTError):
        tenant_id = await _authenticate(token)
    if tenant_id is None:
        await ws.close(code=4401)
        return
    await ws.accept()
    topics: set[str] = {"conversations", "decisions", "notifications"}

    async with broker.subscribe(tenant_id) as queue:

        async def pump() -> None:
            while True:
                event = await queue.get()
                topic = str(event.get("topic", ""))
                if topic in topics or any(
                    topic.startswith(t.rstrip("*")) for t in topics if t.endswith("*")
                ):
                    await ws.send_json(event)

        pump_task = asyncio.create_task(pump())
        try:
            while True:
                data = await ws.receive_json()
                op = data.get("op")
                if op == "subscribe":
                    topics.update(str(t) for t in data.get("topics", []))
                elif op == "unsubscribe":
                    topics.difference_update(str(t) for t in data.get("topics", []))
                elif op == "ping":
                    await ws.send_json({"op": "pong"})
        except WebSocketDisconnect:
            pass
        finally:
            pump_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await pump_task
