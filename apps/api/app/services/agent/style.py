"""Platform-wide response style for every LLM surface.

Single source of truth so agents, triage, compaction, and any future prompt
builder produce consistent user-facing text: clean markdown, no emoji, the
user's language. Import RESPONSE_STYLE for full prompts, PLAIN_STYLE for
short structured outputs (classifications, summaries), and strip_emoji as a
defensive net on short generated strings (titles, headlines).
"""

from __future__ import annotations

import re

RESPONSE_STYLE = (
    "## Response style\n"
    "Write clean, well-structured markdown: short paragraphs, headings only "
    "when they help, bullet lists for enumerations, and tables only for truly "
    "tabular data. Never use emoji or emoticons. "
    "Be concise and concrete; skip filler and repeated horizontal rules.\n"
    "When pointing the user to a Bokito screen, use a markdown link with the "
    "in-app path and a short action label — for example "
    "[Automation rules](/settings/channels#automation-rules) or "
    "[Channels](/settings/channels). Never write plain breadcrumbs like "
    "\"Inbox > Automation rules\" or \"Settings > Channels\". Prefer paths "
    "returned by tools (confirm_path, setup_path, /learn/{slug}) when present."
)

# For prompts that produce short structured output rather than prose.
PLAIN_STYLE = "Plain text only. Never use emoji or emoticons."

# Appended only when the call resolves to a Bokito virtual model (provider
# "bokito" in model_resolution). Agents on BYOK/real models never get this.
BOKITO_MODEL_IDENTITY = (
    "## Model identity\n"
    "You run on Bokito AI 3.1, Bokito's own model. Never state or imply that "
    "you are Claude, Anthropic, or any other third-party model or vendor. If "
    "asked which model you are, answer: Bokito AI 3.1."
)

# Emoji and pictograph ranges plus variation selectors and the zero-width
# joiner that glues emoji sequences together.
_EMOJI_PATTERN = re.compile(
    "["
    "\U0001f000-\U0001faff"  # emoji, symbols, pictographs, extended-A
    "\u2600-\u27bf"  # misc symbols + dingbats
    "\u2b00-\u2bff"  # arrows/symbols block used by some emoji
    "\ufe0e\ufe0f"  # variation selectors
    "\u200d"  # zero-width joiner
    "]+"
)


def strip_emoji(text: str) -> str:
    """Remove emoji from short generated copy (titles, summaries).

    Only meant for AI-generated strings; never run it on customer or
    operator content.
    """
    cleaned = _EMOJI_PATTERN.sub("", text)
    # Collapse doubled spaces left behind by removed characters.
    return re.sub(r"  +", " ", cleaned).strip()
