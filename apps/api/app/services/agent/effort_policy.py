"""How hard one turn thinks.

One value per agent: low, medium or high. Every model call in a turn uses the
same effort. The model decides when to think inside that effort. Two shortcuts
stay: a greeting without an attachment runs on low, and Kong never runs below
high.
"""

from __future__ import annotations

import re

EFFORTS = ("low", "medium", "high")
DEFAULT_EFFORT = "medium"
KONG_SLUG = "bokito-kong"

# Older models without adaptive thinking take a token budget.
EFFORT_BUDGET = {"low": 1024, "medium": 4096, "high": 12000}

# Social lines. "Hoe is het met jou?" is not a how-to.
_SMALL_TALK_RE = re.compile(
    r"^(?:"
    r"hoi|hey|hallo|hello|hi|yo|dag|goedemorgen|goedemiddag|goedenavond|"
    r"thanks|thank you|dank(?:je|jewel)?|top|ok+e?|oké|prima|mooi|goed|"
    r"hoe gaat (?:het|ie)(?: met (?:je|jou|u))?|"
    r"hoe is het(?: met (?:je|jou|u))?|"
    r"how are you|what'?s up|alles goed"
    r")[\s!?.]*$",
    re.IGNORECASE,
)


def normalize_effort(value: object, default: str = DEFAULT_EFFORT) -> str:
    text = str(value or "").strip().lower()
    if text in EFFORTS:
        return text
    if text in ("xhigh", "max"):
        return "high"
    if text in ("minimal", "none", "off"):
        return "low"
    return default


def effort_from_budget(budget: object) -> str:
    """The mapping migration 146 used. For snapshots written before it."""
    try:
        value = int(budget or 0)
    except (TypeError, ValueError):
        value = 0
    if value <= 0:
        return DEFAULT_EFFORT
    if value <= 2048:
        return "low"
    if value <= 8192:
        return "medium"
    return "high"


def turn_is_small_talk(text: str) -> bool:
    """A greeting or thanks. No lookup, no opening line."""
    body = (text or "").strip()
    return bool(body and _SMALL_TALK_RE.match(body))


def turn_effort(
    agent_effort: str,
    *,
    user_text: str,
    has_attachments: bool = False,
    model_slug: str | None = None,
) -> str:
    """Effort for this turn. Set once; every round of the turn uses it."""
    effort = normalize_effort(agent_effort)
    if (model_slug or "").strip().lower() == KONG_SLUG:
        return "high"
    if turn_is_small_talk(user_text) and not has_attachments:
        return "low"
    return effort
