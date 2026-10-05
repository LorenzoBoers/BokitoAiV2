"""Platform-wide response style for every LLM surface.

Single source of truth so agents, triage, compaction, and any future prompt
builder produce consistent user-facing text: no emoji, the user's language.
``style_for_reply_mode`` picks the style for a reply mode (see
``reply_mode.py``): CHAT_STYLE for conversations, MAIL_STYLE for email,
DOCUMENT_STYLE for runs without a conversation. PLAIN_STYLE is for short
structured outputs (classifications, summaries); strip_emoji is a defensive
net on short generated strings (titles, headlines).
"""

from __future__ import annotations

import re

_IN_APP_LINKS = (
    "When pointing someone to a Bokito screen, use a markdown link with the "
    "in-app path and a short action label, for example "
    "[Automation rules](/settings/channels#automation-rules). Never write plain "
    "breadcrumbs like \"Settings > Channels\". Prefer paths returned by tools "
    "(confirm_path, setup_path, /learn/{slug}) when present."
)

CHAT_STYLE = (
    "## Response style: chat\n"
    "You are in a chat. Write like a person on WhatsApp, not like a report.\n"
    "- Send short messages. A blank line starts a new message bubble; usually "
    "1 to 3 bubbles per answer, never more than 5.\n"
    "- Before longer work (looking things up, several tools), first say in one "
    "short line what you are going to do, then do it.\n"
    "- Plain text. Use **bold**, _italic_ or ~~strike~~ only where it really "
    "helps, and links when useful. A short list of a few lines is fine.\n"
    "- No headings, no tables, no horizontal rules, no long bullet reports.\n"
    "- Never use emoji or emoticons.\n" + _IN_APP_LINKS
)

MAIL_STYLE = (
    "## Response style: email\n"
    "You are writing one complete email, not chat messages. Write a single "
    "well-structured message: a greeting, short paragraphs, and a list only "
    "when it helps. Do not split the answer into fragments and do not narrate "
    "what you are about to do. Never use emoji or emoticons. Be concise and "
    "concrete."
)

DOCUMENT_STYLE = (
    "## Response style\n"
    "Write clean, well-structured markdown: short paragraphs, headings only "
    "when they help, bullet lists for enumerations, and tables only for truly "
    "tabular data. Never use emoji or emoticons. "
    "Be concise and concrete; skip filler and repeated horizontal rules.\n"
    + _IN_APP_LINKS
)


def style_for_reply_mode(mode: str) -> str:
    from app.services.agent.reply_mode import CHAT, MAIL

    if mode == CHAT:
        return CHAT_STYLE
    if mode == MAIL:
        return MAIL_STYLE
    return DOCUMENT_STYLE

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
