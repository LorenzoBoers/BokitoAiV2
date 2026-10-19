"""Per-turn reasoning decision.

Native model reasoning costs seconds and tokens. Each turn picks one pace:

- ``reply`` — a fast answer is enough. No reasoning.
- ``reply_then_think`` — say yes in one line, then reason while doing the work.
- ``think`` — the answer itself needs reasoning before the first word.

A pinned agent budget or Kong only raises the budget when the pace is not
``reply``. A greeting never thinks.
"""

from __future__ import annotations

import re

KONG_SLUG = "bokito-kong"
KONG_MIN_BUDGET = 4096

PACE_REPLY = "reply"
PACE_REPLY_THEN_THINK = "reply_then_think"
PACE_THINK = "think"

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

# Longer than this, a message usually carries context worth reasoning over.
_LONG_MESSAGE_CHARS = 160
_MANY_WORDS = 24

# Task and analysis cues (EN + NL). Prefix match on word starts.
_CUE_PATTERN = re.compile(
    r"\b("
    r"why|how (?:do|does|can|should|to|would)|explain|analy[sz]|compar|plan|design|debug|fix|bug|error|"
    r"create|build|set ?up|configure|change|update|delete|remove|move|"
    r"summari[sz]|draft|write|step|workflow|flow|rule|automat|"
    r"waarom|hoe (?:kan|kun|moet|werkt|doe|zet|maak|stel)|leg uit|uitleg|analyse|vergelijk|ontwerp|fout|"
    r"maak|bouw|stel in|instellen|configureer|wijzig|verander|pas aan|"
    r"verwijder|verplaats|vat samen|samenvatting|schrijf|stappen|regel|automatiseer"
    r")",
    re.IGNORECASE,
)
_CODE_OR_LINK = re.compile(r"```|https?://|\{|\}|=>|\bdef\b|\bSELECT\b", re.IGNORECASE)

# A colleague asking the agent to act. The first model call skips reasoning so
# the short "yes, I'll do that" can land before tools. Explanations still reason.
_ACTION_REQUEST = re.compile(
    r"\b("
    r"can you|could you|would you|will you|please|"
    r"kan je|kun je|kunnen jullie|wil je|zou je|"
    r"schakel|inschakel|zet (?:aan|uit)|maak |stuur |nodig |wijs |"
    r"turn on|enable |disable |invite |assign "
    r")",
    re.IGNORECASE,
)
_EXPLAIN_REQUEST = re.compile(
    r"\b(waarom|why|leg uit|explain|how (?:do|does|can)|hoe (?:werkt|kan ik|doe ik|moet ik))\b",
    re.IGNORECASE,
)

# Polite lookup / "what do you know" — not an action. Keep pace at reply so a
# short contact or thread question does not burn a full thinking budget.
_LOOKUP_REQUEST = re.compile(
    r"(?:"
    r"\b(?:wat|what)\b.+\b(?:kan|kun|can|could)\b.+\b(?:je|jullie|you)\b.+\b"
    r"(?:vinden|vertellen|zeggen|zien|weten|find|tell|say|see|know)\b|"
    r"\b(?:vertel|tell)\b.+\b(?:me|ons|us)?\b.+\b(?:over|about)\b|"
    r"\b(?:wie|wat|who|what)\s+is\s+(?:dit|deze|dat|this|that|het)\b|"
    r"\b(?:wat weet je|what do you know)\b.+\b(?:over|about)\b"
    r")",
    re.IGNORECASE,
)


def turn_is_small_talk(text: str) -> bool:
    """A greeting or thanks. No lookup, no opening line."""
    body = (text or "").strip()
    return bool(body and _SMALL_TALK_RE.match(body))


def turn_is_lookup_request(text: str) -> bool:
    """Whether the message only asks to look something up or summarise it."""
    body = (text or "").strip()
    return bool(body and _LOOKUP_REQUEST.search(body))


def turn_is_action_request(text: str) -> bool:
    """Whether the latest message asks the agent to do something, not to explain."""
    body = (text or "").strip()
    if not body or not _ACTION_REQUEST.search(body):
        return False
    if _EXPLAIN_REQUEST.search(body):
        return False
    if turn_is_lookup_request(body):
        return False
    return True


def turn_pace(text: str, *, has_attachments: bool = False) -> str:
    """Which of the three paces this message gets."""
    body = (text or "").strip()
    if body and _SMALL_TALK_RE.match(body) and not has_attachments:
        return PACE_REPLY
    # Lookups stay fast even when they contain "kan je" / "can you".
    if turn_is_lookup_request(body) and not has_attachments:
        return PACE_REPLY
    if turn_is_action_request(body):
        return PACE_REPLY_THEN_THINK
    if turn_needs_reasoning(body, has_attachments=has_attachments):
        return PACE_THINK
    return PACE_REPLY


def turn_needs_reasoning(text: str, *, has_attachments: bool = False) -> bool:
    """Whether the latest operator or customer message deserves model reasoning."""
    if has_attachments:
        return True
    body = (text or "").strip()
    if not body:
        return False
    if len(body) >= _LONG_MESSAGE_CHARS or len(body.split()) >= _MANY_WORDS:
        return True
    if body.count("?") >= 2 or body.count("\n") >= 2:
        return True
    if _CODE_OR_LINK.search(body):
        return True
    return bool(_CUE_PATTERN.search(body))


def turn_thinking_budget(
    configured: int,
    *,
    model_slug: str | None,
    user_text: str,
    has_attachments: bool = False,
    agent_pinned: bool = False,
) -> int:
    """The budget once this turn is allowed to reason. 0 means speak directly.

    ``configured`` is the agent's own budget or the global chat default.
    ``agent_pinned`` is accepted for callers and does not override the pace:
    a greeting stays at 0. Kong only lifts the budget on a think pace.
    """
    del agent_pinned
    pace = turn_pace(user_text, has_attachments=has_attachments)
    if pace == PACE_REPLY:
        return 0
    budget = max(0, int(configured or 0))
    if (model_slug or "").strip().lower() == KONG_SLUG:
        budget = max(budget, KONG_MIN_BUDGET)
    return budget
