"""Per-turn reasoning decision.

Native model reasoning costs seconds and tokens. A greeting or a one-line
lookup does not need it; a multi-step request, a "why", or anything that
changes the workspace does. The loop asks this module once per turn and passes
the resulting budget to the provider (Anthropic extended thinking, Mistral
``reasoning_effort``).

Kong is the heavier tier: it always reasons, with a larger budget.
"""

from __future__ import annotations

import re

KONG_SLUG = "bokito-kong"
KONG_MIN_BUDGET = 4096

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


def turn_is_action_request(text: str) -> bool:
    """Whether the latest message asks the agent to do something, not to explain."""
    body = (text or "").strip()
    if not body or not _ACTION_REQUEST.search(body):
        return False
    if _EXPLAIN_REQUEST.search(body):
        return False
    return True


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
    """The budget for this turn; 0 means no reasoning.

    ``configured`` is the agent's own budget or the global chat default.
    ``agent_pinned`` means the agent set its budget explicitly: always reason.
    """
    budget = max(0, int(configured or 0))
    if (model_slug or "").strip().lower() == KONG_SLUG:
        return max(budget, KONG_MIN_BUDGET)
    if budget <= 0:
        return 0
    if agent_pinned:
        return budget
    return budget if turn_needs_reasoning(user_text, has_attachments=has_attachments) else 0
