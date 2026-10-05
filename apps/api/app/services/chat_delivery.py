"""Chat-mode delivery to customers: several bubbles, in order, with a typing pause."""

from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal, SignalMessage

MIN_PAUSE_S = 0.6
MAX_PAUSE_S = 2.5


def typing_pause(text: str) -> float:
    """Seconds to "type" ``text`` before it is sent, scaled to its length."""
    return max(MIN_PAUSE_S, min(MAX_PAUSE_S, 0.4 + len(text or "") / 90))


async def pause_before(text: str) -> None:
    await asyncio.sleep(typing_pause(text))


async def conversation_has_disclosure(session: AsyncSession, signal: Signal) -> bool:
    """The AI disclosure is shown once per conversation, on the first agent bubble."""
    row = (
        await session.execute(
            select(SignalMessage.id)
            .where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.role == "assistant",
                SignalMessage.metadata_json.contains('"ai_disclosure"'),
            )
            .limit(1)
        )
    ).first()
    return row is not None


def messages_from_payload(payload: dict) -> list[str]:
    """Bubbles of a reply payload: ``messages`` when present, else one ``body_text``."""
    raw = payload.get("messages")
    if isinstance(raw, list):
        out = [m.strip() for m in raw if isinstance(m, str) and m.strip()]
        if out:
            return out
    body = str(payload.get("body_text") or payload.get("body") or "").strip()
    return [body] if body else []
