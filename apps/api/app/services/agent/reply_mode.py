"""How an agent reply is shaped: a document, one email, or several chat messages.

- ``mail``: email threads. One complete, structured message (HTML at send).
- ``chat``: a reply the customer reads on a chat channel (WhatsApp, widget,
  Slack, Instagram, Messenger), and a reply in a team room. Several short
  messages, one paragraph each. A list is cards on the bubble, not lines of text.
- ``document``: the agent's answer in a direct chat with the operator
  (``assistant``, including sessions) and runs without a conversation
  (triggers, workstreams). One prose answer. Structured markdown stays allowed.
  The operator's own messages and team rooms stay chat bubbles in the UI.

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
    # No channel: a trigger or flow run, written as one document.
    # Assistant (and the sessions on that channel): the agent writing to the operator.
    # Team rooms and customer chat stay short bubbles.
    if not channel or channel == "assistant":
        return DOCUMENT
    if channel in MAIL_CHANNELS:
        return MAIL
    return CHAT


def is_customer_channel(channel: str | None) -> bool:
    return bool(channel) and channel not in INTERNAL_CHANNELS


_FENCE_RE = re.compile(r"^\s*```")
_VISIBLE_RE = re.compile(r"[^\W_]")
_LIST_LINE_RE = re.compile(r"^(?:[-*+]|\d+[.)])\s+\S")
_LIST_MARKER_RE = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+")
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


def _paragraphs(block: str) -> list[str]:
    """One paragraph per bubble. A markdown list becomes separate sentences.

    Fenced code stays one bubble. Email never reaches this function.
    """
    if block.lstrip().startswith("```"):
        return [block]
    prose: list[str] = []
    out: list[str] = []

    def flush() -> None:
        text = " ".join(part.strip() for part in prose if part.strip())
        prose.clear()
        if text:
            out.append(text)

    for line in block.split("\n"):
        if _LIST_LINE_RE.match(line.strip()):
            flush()
            item = _LIST_MARKER_RE.sub("", line).strip()
            if item:
                out.append(item)
            continue
        prose.append(line)
    flush()
    return out


def split_chat_messages(
    text: str,
    max_messages: int = MAX_CHAT_MESSAGES,
    *,
    settle: bool = True,
) -> list[str]:
    """Blank line = new message (as on WhatsApp). One paragraph per bubble.

    Fragments shorter than ``MIN_MESSAGE_CHARS`` join the previous message.
    A short previous opener that the next block restarts (``Je`` then
    ``Je dashboard…``) is replaced so a stream stutter is not two bubbles.
    A short previous that is not a restart joins forward into the next block.
    A markdown list is not a bubble: each item becomes its own sentence, and
    the cards for a real list hang on the bubble via ``attach_items``.
    While the reply is still streaming (``settle=False``) the open tail stays
    exactly as the model wrote it, so the reveal only grows.
    Anything past ``max_messages`` joins the last bubble as one paragraph,
    without a blank line.
    """
    raw_blocks = []
    for raw in _blocks(text or ""):
        block = _strip_heartbeat(raw)
        if block and _VISIBLE_RE.search(block):
            raw_blocks.append(block)
    open_tail = None
    if not settle and raw_blocks:
        open_tail = raw_blocks.pop()
    merged: list[str] = []
    for block in raw_blocks:
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
        merged.extend(_paragraphs(block))
    if open_tail:
        if merged and len(open_tail) < MIN_MESSAGE_CHARS:
            merged[-1] = f"{merged[-1]}\n{open_tail}"
        elif merged and len(merged[-1]) < MIN_MESSAGE_CHARS:
            prev = merged[-1]
            merged[-1] = open_tail if open_tail.startswith(prev) else f"{prev}\n{open_tail}"
        else:
            merged.append(open_tail)
    if max_messages > 0 and len(merged) > max_messages:
        head = merged[: max_messages - 1]
        tail = " ".join(merged[max_messages - 1 :])
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
