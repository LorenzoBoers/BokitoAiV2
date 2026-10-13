"""WebSocket connection registry and topic-based fanout."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from fastapi import WebSocket

from app.gateway.bus import event_bus

logger = logging.getLogger(__name__)


def _log_send_failure(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.debug("gateway send failed: %s", exc)


# Topics dashboard/operator clients may subscribe to without extra checks.
OPERATOR_TOPICS = ("threads", "runs", "decisions", "notifications", "presence", "agents", "entities")


class GatewayConnection:
    """One authenticated WebSocket client."""

    def __init__(
        self,
        websocket: WebSocket,
        *,
        tenant_id: str,
        kind: str,  # "user" | "widget"
        user_id: str | None = None,
        customer_id: str | None = None,
        device: str = "",
        is_staff: bool = False,
    ) -> None:
        self.id = uuid.uuid4().hex
        self.websocket = websocket
        self.tenant_id = tenant_id
        self.kind = kind
        self.user_id = user_id
        self.customer_id = customer_id
        self.device = device
        self.is_staff = is_staff
        self.topics: set[str] = set()

    def matches(self, envelope: dict[str, Any]) -> bool:
        if envelope.get("tenant_id") != self.tenant_id:
            return False
        # Operator-audience frames (internal notes, thread triage state, list
        # feed rows) must never reach widget (visitor) connections.
        if self.kind == "widget":
            data = envelope.get("data")
            if isinstance(data, dict) and data.get("audience") == "operator":
                return False
        topics = envelope.get("topics") or []
        return any(t in self.topics for t in topics)

    async def send(self, frame: dict[str, Any]) -> None:
        await self.websocket.send_json(frame)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, GatewayConnection] = {}
        self._registered = False

    @property
    def connections(self) -> list[GatewayConnection]:
        return list(self._connections.values())

    def user_ids(self, tenant_id: str) -> set[str]:
        return {
            connection.user_id
            for connection in self._connections.values()
            if connection.kind == "user" and connection.tenant_id == tenant_id and connection.user_id
        }

    def register(self, connection: GatewayConnection) -> None:
        self._connections[connection.id] = connection
        if not self._registered:
            event_bus.add_handler(self.dispatch)
            self._registered = True

    def unregister(self, connection: GatewayConnection) -> None:
        self._connections.pop(connection.id, None)

    async def _safe_send(self, connection: GatewayConnection, frame: dict[str, Any]) -> None:
        try:
            await connection.send(frame)
        except Exception:
            self.unregister(connection)

    async def dispatch(self, envelope: dict[str, Any]) -> None:
        """Fan out without waiting on a slow WebSocket.

        ``event_bus.publish`` awaits this handler. A full client buffer used
        to block chat prepare, health, and every other request on this worker.
        """
        frame = {
            "type": "event",
            "event": envelope.get("event"),
            "topics": envelope.get("topics") or [],
            "data": envelope.get("data") or {},
            "ts": envelope.get("ts"),
        }
        tasks = [
            asyncio.create_task(self._safe_send(connection, frame))
            for connection in list(self._connections.values())
            if connection.matches(envelope)
        ]
        if not tasks:
            return
        _done, pending = await asyncio.wait(tasks, timeout=0.25)
        for task in pending:
            task.add_done_callback(_log_send_failure)


manager = ConnectionManager()
