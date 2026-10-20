"""Conversation list titles: a fast provisional label, then one AI refine.

The first user message used to become the subject verbatim (truncated). That
reads like a cut-off sentence in the list. Modern assistants name the thread
from intent instead. We still write a short heuristic title immediately so the
list is never blank, then one cheap LLM call replaces it when the subject is
still that provisional (or a placeholder). A manual rename is never overwritten.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from uuid import UUID

PLACEHOLDER_SUBJECTS = frozenset(
    {
        "new conversation",
        "website chat",
        "(no subject)",
        "",
    }
)

_GREETING = re.compile(
    r"^(hi|hey|hello|hoi|hallo|goedemorgen|goedemiddag|goedenavond)[,!.:\s]+",
    re.IGNORECASE,
)
_SPACE = re.compile(r"\s+")
_QUOTES = re.compile(r'^[\s"\'“”‘’«»]+|[\s"\'“”‘’«»]+$')
_TITLE_PROMPT_MARKER = "Name this conversation in at most 6 words"

_TITLE_PROMPT = """\
{marker}. No quotes, no emoji, no trailing punctuation. Match the language of
the message. Summarize the topic as a short label a person would scan in a
list; do not copy the opening words of the message.

Message:
{message}
"""

logger = logging.getLogger(__name__)


def is_placeholder_subject(subject: str | None) -> bool:
    return (subject or "").strip().lower() in PLACEHOLDER_SUBJECTS


def intent_title(user_text: str, *, max_words: int = 7, max_len: int = 48) -> str:
    """Short provisional label for the list. Never copies a long first message."""
    first = (user_text or "").strip().split("\n", 1)[0].strip()
    first = _GREETING.sub("", first).strip()
    first = _SPACE.sub(" ", first)
    if not first:
        return ""
    words = first.split(" ")
    if len(first) <= max_len and len(words) <= max_words:
        title = first
    else:
        title = " ".join(words[:max_words])
    title = title.rstrip(".,;: ").strip()
    if len(title) > max_len:
        title = title[: max_len - 1].rstrip() + "…"
    return title


def normalize_ai_title(raw: str, *, max_len: int = 48) -> str:
    """Clean a model title into a safe list label."""
    from app.services.agent.style import strip_emoji

    title = strip_emoji(raw or "")
    title = title.split("\n", 1)[0].strip()
    title = _QUOTES.sub("", title).strip()
    title = _SPACE.sub(" ", title).rstrip(".,;: ").strip()
    if not title:
        return ""
    if len(title) > max_len:
        title = title[: max_len - 1].rstrip() + "…"
    return title


def maybe_apply_intent_title(signal: Any, user_text: str) -> str | None:
    """Set subject once while it is still the placeholder.

    Returns the provisional title when written, else None.
    """
    if not is_placeholder_subject(getattr(signal, "subject", None)):
        return None
    title = intent_title(user_text)
    if not title:
        return None
    signal.subject = title
    return title


def schedule_ai_title(signal_id: UUID, *, provisional: str, seed_text: str) -> None:
    """Fire-and-forget: refine the list title once the request has committed."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(
        refine_ai_title(signal_id, provisional=provisional, seed_text=seed_text),
        name=f"conversation-title:{signal_id}",
    )


def apply_title_once(signal: Any, user_text: str) -> None:
    """Heuristic title now; schedule one AI refine when the subject was blank."""
    provisional = maybe_apply_intent_title(signal, user_text)
    if provisional is None:
        return
    signal_id = getattr(signal, "id", None)
    if signal_id is None:
        return
    schedule_ai_title(signal_id, provisional=provisional, seed_text=user_text)


async def refine_ai_title(
    signal_id: UUID,
    *,
    provisional: str,
    seed_text: str,
) -> str | None:
    """Replace the provisional subject with an AI label when still upgradable."""
    # Give the request that scheduled us time to commit.
    await asyncio.sleep(0.35)
    try:
        from app.db.session import async_session_factory
        from app.gateway.publish import publish_thread_update
        from app.models.signal import Signal
        from app.services.agent.llm import get_chat_provider
        from app.services.model_resolution import record_usage, resolve_model_call

        async with async_session_factory() as session:
            signal = await session.get(Signal, signal_id)
            if signal is None:
                return None
            current = (signal.subject or "").strip()
            if current != provisional and not is_placeholder_subject(current):
                return None
            seed = (seed_text or "").strip()
            if not seed:
                return None

            resolved = await resolve_model_call(session, signal.tenant_id, kind="chat")
            llm = get_chat_provider(
                resolved.provider_type, resolved.api_key, resolved.base_url or None
            )
            prompt = _TITLE_PROMPT.format(
                marker=_TITLE_PROMPT_MARKER,
                message=seed[:1500],
            )
            response = await llm.chat(
                [{"role": "user", "content": prompt}],
                model=resolved.model_id,
                max_tokens=40,
            )
            usage = response.get("usage") or {}
            await record_usage(
                session,
                signal.tenant_id,
                resolved,
                tokens_in=int(usage.get("input_tokens") or 0),
                tokens_out=int(usage.get("output_tokens") or 0),
                scope="chat",
                scope_id=str(signal.id),
                call_type="conversation_title",
            )
            raw = "\n".join(
                block["text"]
                for block in response.get("content") or []
                if isinstance(block, dict) and block.get("type") == "text"
            )
            title = normalize_ai_title(raw)
            if not title or title.lower() == current.lower():
                await session.commit()
                return None
            # Re-check after the LLM wait: operator may have renamed.
            await session.refresh(signal)
            current = (signal.subject or "").strip()
            if current != provisional and not is_placeholder_subject(current):
                await session.commit()
                return None
            signal.subject = title
            session.add(signal)
            await session.commit()
            await session.refresh(signal)
            await publish_thread_update(signal)
            return title
    except Exception:  # noqa: BLE001 — title refine must never break chat
        logger.debug("conversation title refine failed signal=%s", signal_id, exc_info=True)
        return None
