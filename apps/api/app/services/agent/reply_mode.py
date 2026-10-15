"""How an agent reply is shaped: one structured email, or several chat messages.

- ``mail``: email threads. One complete, structured message (HTML at send).
- ``chat``: every conversation that is not email (inline/assistant chat,
  internal threads, sessions, WhatsApp, website chat, Slack, future DMs).
  The agent sends several short messages with minimal formatting.
- ``document``: runs without a conversation (triggers, workstreams). Output is
  a result, not a reply, so structured markdown stays allowed.

``split_chat_messages`` is mirrored in ``@bokito/shared``
(``packages/shared/src/chat-messages.ts``; dashboard and chat-widget import
that). Keep both in sync.
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
_VISIBLE_RE = re.compile(r"[^\W_]")
_LIST_LINE_RE = re.compile(r"^(?:[-*+]|\d+[.)])\s+\S")
_HEARTBEAT_PREFIX_RE = re.compile(r"^\s*HEARTBEAT_OK\b\s*[—–\-:]?\s*", re.IGNORECASE)


def _blocks(text: str) -> list[str]:
    """Split on blank lines, keeping fenced code blocks whole.

    Blocks without a letter or digit (a lone ``---`` rule, ``**``) are dropped:
    on their own they render as an empty bubble.
    """
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
    return [b for b in blocks if _VISIBLE_RE.search(b)]


def _strip_heartbeat(block: str) -> str:
    """A wake token is not a chat line. Drop a leading HEARTBEAT_OK."""
    return _HEARTBEAT_PREFIX_RE.sub("", block).strip()


def _is_list_block(block: str) -> bool:
    """A markdown list, including one we already joined under a short lead-in."""
    lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
    while lines and not _LIST_LINE_RE.match(lines[0]) and (
        lines[0].startswith("#") or (lines[0].endswith(":") and len(lines[0]) <= 80)
    ):
        lines = lines[1:]
    return bool(lines) and all(_LIST_LINE_RE.match(ln) for ln in lines)


def _is_list_lead(block: str) -> bool:
    """A one-line label that only exists to introduce the list after it."""
    text = block.strip()
    if not text or "\n" in text or text.startswith("```"):
        return False
    if text.startswith("#") and len(text) <= 80:
        return True
    return text.endswith(":") and len(text) <= 80


def split_chat_messages(text: str, max_messages: int = MAX_CHAT_MESSAGES) -> list[str]:
    """Blank line = new message (as on WhatsApp). Lists and code stay together.

    Fragments shorter than ``MIN_MESSAGE_CHARS`` join the previous message.
    A short previous opener that the next block restarts (``Je`` then
    ``Je dashboard…``) is replaced so a stream stutter is not two bubbles.
    A short previous that is not a restart joins forward into the next block.
    Numbered or bulleted blocks join each other, and a short lead-in
    (``Besluitpunten:``) joins the list that follows, so an enumeration is
    one bubble. Anything past ``max_messages`` merges into the last one.
    """
    merged: list[str] = []
    for raw in _blocks(text or ""):
        block = _strip_heartbeat(raw)
        if not block or not _VISIBLE_RE.search(block):
            continue
        if merged and len(block) < MIN_MESSAGE_CHARS:
            merged[-1] = f"{merged[-1]}\n{block}"
            continue
        if merged and len(merged[-1]) < MIN_MESSAGE_CHARS:
            prev = merged[-1]
            # Model restarted after a blank line: drop the false start.
            if block.startswith(prev):
                merged[-1] = block
            else:
                merged[-1] = f"{prev}\n{block}"
            continue
        if merged and _is_list_block(block) and (_is_list_block(merged[-1]) or _is_list_lead(merged[-1])):
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
