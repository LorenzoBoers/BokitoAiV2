"""One-shot conversation titles from intent, not a dump of the first message."""

from __future__ import annotations

import re
from typing import Any

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


def is_placeholder_subject(subject: str | None) -> bool:
    return (subject or "").strip().lower() in PLACEHOLDER_SUBJECTS


def intent_title(user_text: str, *, max_words: int = 7, max_len: int = 48) -> str:
    """Short label for the list. Never copies a long first message verbatim."""
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


def maybe_apply_intent_title(signal: Any, user_text: str) -> bool:
    """Set subject once while it is still the placeholder. Returns True if written."""
    if not is_placeholder_subject(getattr(signal, "subject", None)):
        return False
    title = intent_title(user_text)
    if not title:
        return False
    signal.subject = title
    return True
