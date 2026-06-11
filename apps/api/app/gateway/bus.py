"""Tenant-scoped gateway event bus with optional Redis pub/sub fanout.

Single-process deployments (dev, tests) dispatch in-memory. When Redis is
reachable, every published envelope is also broadcast on a Redis channel so
web workers and ARQ workers can reach WebSocket clients held by other
processes. Envelopes carry the publishing node id so a node skips its own
messages when they echo back from Redis.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Awaitable, Callable

from app.config import get_settings

logger = logging.getLogger(__name__)

REDIS_CHANNEL = "bokito:gateway:events"

EnvelopeHandler = Callable[[dict[str, Any]], Awaitable[None]]


class EventBus:
    def __init__(self) -> None:
        self.node_id = uuid.uuid4().hex
        self._handlers: list[EnvelopeHandler] = []
        self._redis: Any = None
        self._reader_task: asyncio.Task | None = None
        self._redis_unavailable = False

    # -- local subscribers (the connection manager) --

    def add_handler(self, handler: EnvelopeHandler) -> None:
        if handler not in self._handlers:
            self._handlers.append(handler)

    def remove_handler(self, handler: EnvelopeHandler) -> None:
        if handler in self._handlers:
            self._handlers.remove(handler)

    # -- lifecycle --

    async def start(self) -> None:
        """Begin listening for envelopes from other processes (web workers)."""
        if self._reader_task is not None:
            return
        redis = await self._get_redis()
        if redis is None:
            return
        self._reader_task = asyncio.create_task(self._reader_loop())

    async def stop(self) -> None:
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass
            self._reader_task = None
        if self._redis is not None:
            try:
                await self._redis.aclose()
            except Exception:
                pass
            self._redis = None

    # -- publishing --

    async def publish(
        self,
        tenant_id: Any,
        topics: list[str],
        event: str,
        data: dict[str, Any],
    ) -> None:
        envelope = {
            "node": self.node_id,
            "tenant_id": str(tenant_id),
            "topics": topics,
            "event": event,
            "data": data,
            "ts": datetime.utcnow().isoformat() + "Z",
        }
        await self._dispatch_local(envelope)
        await self._publish_redis(envelope)

    async def _dispatch_local(self, envelope: dict[str, Any]) -> None:
        for handler in list(self._handlers):
            try:
                await handler(envelope)
            except Exception:
                logger.exception("gateway handler failed")

    # -- redis fanout --

    async def _get_redis(self) -> Any:
        if self._redis is not None or self._redis_unavailable:
            return self._redis
        try:
            from redis.asyncio import Redis

            client = Redis.from_url(get_settings().redis_url, socket_connect_timeout=2)
            await client.ping()
            self._redis = client
        except Exception:
            self._redis_unavailable = True
            logger.info("gateway: redis unavailable, using in-process fanout only")
        return self._redis

    async def _publish_redis(self, envelope: dict[str, Any]) -> None:
        redis = await self._get_redis()
        if redis is None:
            return
        try:
            await redis.publish(REDIS_CHANNEL, json.dumps(envelope, default=str))
        except Exception:
            logger.warning("gateway: redis publish failed", exc_info=True)

    async def _reader_loop(self) -> None:
        redis = await self._get_redis()
        if redis is None:
            return
        pubsub = redis.pubsub()
        await pubsub.subscribe(REDIS_CHANNEL)
        try:
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    envelope = json.loads(message["data"])
                except (TypeError, ValueError):
                    continue
                if envelope.get("node") == self.node_id:
                    continue  # already dispatched locally at publish time
                await self._dispatch_local(envelope)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("gateway: redis reader stopped", exc_info=True)
        finally:
            try:
                await pubsub.unsubscribe(REDIS_CHANNEL)
                await pubsub.aclose()
            except Exception:
                pass


event_bus = EventBus()
