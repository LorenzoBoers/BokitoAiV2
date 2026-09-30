"""Realtime broker: tenant-scoped topics fanned out to WebSocket subscribers.

In-process by default; when `REDIS_URL` is set, publishes also go through
Redis pub/sub so workers and multiple API processes share one stream.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from bokito.config import get_settings

log = logging.getLogger(__name__)

Event = dict[str, Any]


class Broker:
    def __init__(self) -> None:
        self._subscribers: dict[uuid.UUID, set[asyncio.Queue[Event]]] = {}
        self._redis: Any | None = None
        self._listener: asyncio.Task[None] | None = None

    def _channel(self) -> str:
        return f"{get_settings().redis_prefix}:events"

    async def _get_redis(self) -> Any | None:
        settings = get_settings()
        if not settings.redis_url or settings.environment == "test":
            return None
        if self._redis is None:
            try:
                import redis.asyncio as aioredis

                self._redis = aioredis.from_url(settings.redis_url)
                await self._redis.ping()
            except Exception as exc:  # pragma: no cover - depends on infra
                log.warning("realtime redis unavailable: %s", exc)
                self._redis = None
        return self._redis

    async def start(self) -> None:
        r = await self._get_redis()
        if r is None or self._listener:
            return

        async def _listen() -> None:
            pubsub = r.pubsub()
            await pubsub.subscribe(self._channel())
            async for raw in pubsub.listen():
                if raw.get("type") != "message":
                    continue
                try:
                    data = json.loads(raw["data"])
                    self._deliver(uuid.UUID(data["tenant_id"]), data["event"])
                except Exception:  # pragma: no cover
                    log.exception("bad realtime payload")

        self._listener = asyncio.create_task(_listen())

    async def stop(self) -> None:
        if self._listener:
            self._listener.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listener
            self._listener = None
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    def _deliver(self, tenant_id: uuid.UUID, event: Event) -> None:
        for queue in list(self._subscribers.get(tenant_id, ())):
            if queue.qsize() > 500:
                continue
            queue.put_nowait(event)

    async def publish(self, tenant_id: uuid.UUID, topic: str, payload: Event) -> None:
        event = {"topic": topic, **payload}
        r = await self._get_redis()
        if r is not None:
            try:
                await r.publish(
                    self._channel(), json.dumps({"tenant_id": str(tenant_id), "event": event})
                )
                return
            except Exception as exc:  # pragma: no cover
                log.warning("realtime publish failed, delivering locally: %s", exc)
        self._deliver(tenant_id, event)

    @contextlib.asynccontextmanager
    async def subscribe(self, tenant_id: uuid.UUID) -> AsyncIterator[asyncio.Queue[Event]]:
        queue: asyncio.Queue[Event] = asyncio.Queue()
        self._subscribers.setdefault(tenant_id, set()).add(queue)
        try:
            yield queue
        finally:
            subs = self._subscribers.get(tenant_id)
            if subs:
                subs.discard(queue)
                if not subs:
                    self._subscribers.pop(tenant_id, None)


broker = Broker()


async def publish(tenant_id: uuid.UUID, topic: str, payload: Event) -> None:
    await broker.publish(tenant_id, topic, payload)
