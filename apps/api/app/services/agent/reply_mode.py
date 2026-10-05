"""How an agent reply is shaped: one structured email, or several chat messages.

- ``mail``: email threads. One complete, structured message (HTML at send).
- ``chat``: every conversation that is not email (inline/assistant chat,
  internal threads, sessions, WhatsApp, website chat, Slack, future DMs).
  The agent sends several short messages with minimal formatting.
- ``document``: runs without a conversation (triggers, workstreams). Output is
  a result, not a reply, so structured markdown stays allowed.

``split_chat_messages`` is mirrored in the dashboard
(``apps/dashboard/src/lib/chatMessages.ts``); keep both in sync.
"""

from __future__ import annotations

import re

MAIL = "mail"
CHAT = "chat"
DOCUMENT = "document"

MAX_CHAT_MESSAGES = 5
MIN_MESSAGE_CHARS = 3

MAIL_CHANNELS = frozenset({"email"})
# Chat channels whose replies leave the workspace (a customer reads them).
CUSTOMER_CHAT_CHANNELS = frozenset({"whatsapp", "widget", "slack", "instagram", "messenger"})
# Channels where nothing reaches a customer: delivery labels never apply.
INTERNAL_CHANNELS = frozenset({"assistant", "internal", "team"})


def reply_mode_for(channel: str | None) -> str:
    if not channel:
        return DOCUMENT
    if channel in MAIL_CHANNELS:
        return MAIL
    return CHAT


def is_customer_channel(channel: str | None) -> bool:
    return bool(channel) and channel not in INTERNAL_CHANNELS


_FENCE_RE = re.compile(r"^\s*```")


def _blocks(text: str) -> list[str]:
    """Split on blank lines, keeping fenced code blocks whole."""
    blocks: list[str] = []
    current: list[str] = []
    in_fence = False
    for line in text.replace("\r\n", "\n").split("\n"):
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            current.append(line)
            continue
        if not in_fence and not line.strip():
            if current:
                blocks.append("\n".join(current).strip())
                current = []
            continue
        current.append(line)
    if current:
        blocks.append("\n".join(current).strip())
    return [b for b in blocks if b]


def split_chat_messages(text: str, max_messages: int = MAX_CHAT_MESSAGES) -> list[str]:
    """Blank line = new message (as on WhatsApp). Lists and code stay together.

    Fragments shorter than ``MIN_MESSAGE_CHARS`` join the previous message;
    anything past ``max_messages`` merges into the last one.
    """
    merged: list[str] = []
    for block in _blocks(text or ""):
        if merged and len(block) < MIN_MESSAGE_CHARS:
            merged[-1] = f"{merged[-1]}\n{block}"
            continue
        merged.append(block)
    if max_messages > 0 and len(merged) > max_messages:
        head = merged[: max_messages - 1]
        tail = "\n\n".join(merged[max_messages - 1 :])
        merged = [*head, tail]
    return merged


_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_STRIKE_RE = re.compile(r"~~(.+?)~~")
_HEADING_RE = re.compile(r"^#{1,6}\s+(.+)$", re.MULTILINE)
_RULE_RE = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$", re.MULTILINE)


def format_for_channel(text: str, channel: str | None) -> str:
    """Convert the shared chat syntax to what the channel renders natively."""
    if not text or channel in MAIL_CHANNELS:
        return text
    out = _RULE_RE.sub("", text)
    if channel == "whatsapp":
        out = _HEADING_RE.sub(r"*\1*", out)
        out = _BOLD_RE.sub(r"*\1*", out)
        out = _STRIKE_RE.sub(r"~\1~", out)
        out = _MD_LINK_RE.sub(lambda m: f"{m.group(1)}: {m.group(2)}", out)
    elif channel == "slack":
        out = _HEADING_RE.sub(r"*\1*", out)
        out = _BOLD_RE.sub(r"*\1*", out)
        out = _STRIKE_RE.sub(r"~\1~", out)
        out = _MD_LINK_RE.sub(lambda m: f"<{m.group(2)}|{m.group(1)}>", out)
    else:
        out = _HEADING_RE.sub(r"**\1**", out)
    return re.sub(r"\n{3,}", "\n\n", out).strip()
