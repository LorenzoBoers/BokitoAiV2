"""Outbound delivery dispatch and the Art. 50 disclosure rule.

Each channel module registers a `Deliverer` for its `Channel`. Internal,
widget and api conversations need no transport: the message in the thread is
the delivery (the widget polls or streams it).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.base import utcnow
from bokito.domain.connection import Connection
from bokito.domain.conversation import Channel, Conversation, Message, SendStatus
from bokito.domain.govern import Policy

log = logging.getLogger(__name__)

Deliverer = Callable[
    [AsyncSession, Connection | None, Conversation, Message], Awaitable[dict[str, Any]]
]

_deliverers: dict[Channel, Deliverer] = {}

DEFAULT_DISCLOSURE = {
    "en": "This reply was written with the help of an AI assistant.",
    "nl": "Dit antwoord is geschreven met hulp van een AI-assistent.",
}


def register(channel: Channel, fn: Deliverer) -> None:
    _deliverers[channel] = fn


def disclosure_line(policy: Policy | None, language: str) -> str:
    if policy and policy.disclosure_text:
        return policy.disclosure_text
    return DEFAULT_DISCLOSURE.get((language or "en")[:2], DEFAULT_DISCLOSURE["en"])


def apply_disclosure(
    body: str,
    *,
    ai_generated: bool,
    connection: Connection | None,
    policy: Policy | None,
    language: str,
) -> str:
    """Append the disclosure for AI-written outbound messages when the connection has it on."""
    if not ai_generated:
        return body
    if connection is not None and not connection.disclosure_enabled:
        return body
    line = disclosure_line(policy, language)
    if line and line not in body:
        return f"{body.rstrip()}\n\n{line}"
    return body


async def deliver(
    session: AsyncSession, connection: Connection | None, conv: Conversation, msg: Message
) -> Message:
    fn = _deliverers.get(conv.channel)
    if fn is None:
        msg.send_status = SendStatus.sent
        msg.sent_at = utcnow()
        await session.flush()
        return msg
    try:
        result = await fn(session, connection, conv, msg)
    except Exception as exc:
        log.exception("delivery failed on %s", conv.channel)
        msg.send_status = SendStatus.failed
        msg.send_error = str(exc)[:500]
        await session.flush()
        return msg
    msg.send_status = SendStatus.sent
    msg.sent_at = utcnow()
    if result.get("external_id"):
        msg.external_id = str(result["external_id"])
    msg.meta = {**(msg.meta or {}), **{k: v for k, v in result.items() if k != "external_id"}}
    await session.flush()
    return msg
