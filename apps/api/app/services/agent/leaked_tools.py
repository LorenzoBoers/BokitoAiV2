"""Turn a pasted ``<propose_action>`` tag into a real tool call.

Some models write the tool as markup in the reply instead of calling it.
The operator then sees raw XML and no approval buttons. The turn strips
the tag and runs propose_action so the card lands under the question.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any

_OPEN = "<propose_action"
_SPACE = re.compile(r"\s+")


def lift_propose_action_markup(text: str) -> tuple[str, list[dict[str, Any]]]:
    """Return speech without the tags, and one propose_action input per tag."""
    if not text or _OPEN not in text.lower():
        return text or "", []
    calls: list[dict[str, Any]] = []
    kept: list[str] = []
    i = 0
    lower = text.lower()
    while i < len(text):
        start = lower.find(_OPEN, i)
        if start < 0:
            kept.append(text[i:])
            break
        kept.append(text[i:start])
        end, raw_attrs = _read_tag(text, start)
        if end is None:
            kept.append(text[start:])
            break
        preceding = _SPACE.sub(" ", "".join(kept)).strip()
        call = _call_from_attrs(raw_attrs, preceding)
        if call is None:
            kept.append(text[start:end])
        else:
            calls.append(call)
        i = end
    clean = re.sub(r"\n{3,}", "\n\n", "".join(kept)).strip()
    return clean, calls


def _read_tag(text: str, start: int) -> tuple[int | None, str]:
    """Read from ``<propose_action`` to the closing ``>``, honoring quotes."""
    i = start + len(_OPEN)
    quote: str | None = None
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
        elif ch == ">":
            raw = text[start + len(_OPEN) : i].strip()
            if raw.endswith("/"):
                raw = raw[:-1].strip()
            return i + 1, raw
        i += 1
    return None, ""


def _attrs(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    i = 0
    n = len(raw)
    while i < n:
        while i < n and raw[i].isspace():
            i += 1
        name_start = i
        while i < n and (raw[i].isalnum() or raw[i] in ("_", "-")):
            i += 1
        name = raw[name_start:i]
        while i < n and raw[i].isspace():
            i += 1
        if not name or i >= n or raw[i] != "=":
            i += 1
            continue
        i += 1
        while i < n and raw[i].isspace():
            i += 1
        if i >= n:
            break
        if raw[i] in ("'", '"'):
            quote = raw[i]
            i += 1
            value_start = i
            while i < n and raw[i] != quote:
                i += 1
            out[name] = raw[value_start:i]
            if i < n:
                i += 1
        else:
            value_start = i
            while i < n and not raw[i].isspace():
                i += 1
            out[name] = raw[value_start:i]
    return out


def _call_from_attrs(raw: str, preceding: str) -> dict[str, Any] | None:
    attrs = _attrs(raw)
    question = (attrs.get("question") or "").strip() or preceding
    question = _SPACE.sub(" ", question).strip()
    if not question:
        question = (attrs.get("approve_label") or "").strip()
    if not question:
        return None
    payload: Any = attrs.get("payload") or {}
    if isinstance(payload, str):
        stripped = payload.strip()
        if stripped[:1] in ("{", "["):
            try:
                payload = json.loads(stripped)
            except json.JSONDecodeError:
                payload = {}
        else:
            payload = {}
    if not isinstance(payload, dict):
        payload = {}
    tool_input: dict[str, Any] = {
        "question": question[:600],
        "action": (attrs.get("action") or "").strip(),
        "payload": payload,
    }
    for key in ("approve_label", "reject_label", "title", "summary", "selection"):
        value = (attrs.get(key) or "").strip()
        if value:
            tool_input[key] = value
    return {
        "id": f"leaked-{uuid.uuid4().hex[:8]}",
        "name": "propose_action",
        "input": tool_input,
    }
