"""Split raw LLM suggestion output into a clean customer-facing draft + internal note.

The suggest prompt asks the model to return only the customer-facing body and
to put anything meant for the team after a literal ``INTERNAL_NOTE:`` sentinel.
Models don't always comply, so this module also strips legacy leak patterns
observed in production:

- a research/meta preamble before the first greeting (with or without a
  ``---`` divider),
- ``**Interne notitie:**`` / ``Internal note:`` blocks,
- trailing sign-offs ("Met vriendelijke groet, Bokito Assistent") — the
  signature system appends exactly one signature server-side, so a model
  sign-off would stack on top of it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Sentinel the suggest prompt asks the model to use for team-facing remarks.
_SENTINEL_RE = re.compile(r"^[ \t>*_-]*INTERNAL_NOTE:\s*", re.IGNORECASE | re.MULTILINE)

# Legacy internal note headings the model produced before the sentinel existed.
_LEGACY_NOTE_RE = re.compile(
    r"^[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*"
    r"(?:interne notitie|interne noot|internal note|note interne)"
    r"[ \t]*:?[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*:?[ \t]*$"
    r"|^[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*"
    r"(?:interne notitie|interne noot|internal note|note interne)"
    r"[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*:[ \t]*",
    re.IGNORECASE,
)

_DIVIDER_RE = re.compile(r"^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$")

# Greetings that mark the start of an actual letter body (NL/EN/DE/FR/ES).
_GREETING_RE = re.compile(
    r"^[ \t>*_]*"
    r"(?:hallo|hoi|hey|hi|hello|dear|beste|geachte|dag|goedemorgen|goedemiddag|"
    r"goedenavond|good morning|good afternoon|good evening|bonjour|hola|"
    r"sehr geehrte|liebe[rs]?)\b",
    re.IGNORECASE,
)

# Closing formulas the model must not write (signatures are appended server-side).
_CLOSING_RE = re.compile(
    r"^[ \t>*_]*"
    r"(?:met vriendelijke groet(?:en)?|vriendelijke groet(?:en)?|met hartelijke groet(?:en)?|"
    r"hartelijke groet(?:en)?|groet(?:en|jes)?|"
    r"kind regards|best regards|warm regards|warmest regards|regards|"
    r"sincerely(?: yours)?|yours sincerely|best wishes|all the best|best|cheers|"
    r"thanks(?:,? and best)?|thank you|many thanks|"
    r"cordialement|bien cordialement|mit freundlichen gr(?:ü|u)(?:ß|ss)en|"
    r"un saludo|saludos)"
    r"[ \t]*[,.!]?[ \t]*[*_]*$",
    re.IGNORECASE,
)

# After a closing formula, at most this many short name/role lines are stripped.
_MAX_SIGNOFF_NAME_LINES = 3
_MAX_SIGNOFF_NAME_LEN = 64

# Operator / invoke-agent instructions the model sometimes echoes into the draft.
_OPERATOR_PROMPT_RE = re.compile(
    r"^(?:"
    r"A teammate asked you to draft a reply to the customer in this thread\.\s*"
    r"(?:Return only the reply body text \(no meta-commentary\)\.\s*)?"
    r"(?:Teammate's request:\s*[^\n]*\n*)?"
    r"|Draft a concise, professional reply to the latest customer message in this thread\.\s*"
    r"(?:Return only the reply body text \(no meta-commentary\)\.\s*)?"
    r"(?:Operator guidance:\s*[^\n]*\n*)?"
    r"|A teammate invoked you on this conversation\.[^\n]*\n?"
    r")",
    re.IGNORECASE | re.DOTALL,
)

_REVIEWER_NOTE_RE = re.compile(
    r"^> Note for the reviewer:.*$",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass(frozen=True)
class SuggestionParts:
    """Clean customer-facing body plus optional team-facing internal note."""

    body: str
    internal_note: str


def _collapse_blank_lines(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _strip_operator_prompt(text: str) -> str:
    """Drop echoed invoke/draft instructions and reviewer-note quotes."""
    cleaned = _OPERATOR_PROMPT_RE.sub("", text).strip()
    cleaned = _REVIEWER_NOTE_RE.sub("", cleaned).strip()
    return cleaned


def _extract_sentinel_note(text: str) -> tuple[str, str]:
    match = _SENTINEL_RE.search(text)
    if not match:
        return text, ""
    return text[: match.start()], text[match.end() :].strip()


def _extract_legacy_note(text: str) -> tuple[str, str]:
    """Strip a legacy '**Interne notitie:**' block (heading to end of text)."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if _LEGACY_NOTE_RE.match(line):
            note_head = _LEGACY_NOTE_RE.sub("", line, count=1).strip()
            note_rest = "\n".join(lines[i + 1 :]).strip()
            note = "\n".join(part for part in (note_head, note_rest) if part).strip()
            return "\n".join(lines[:i]).rstrip(), note
    return text, ""


def _strip_preamble(text: str) -> tuple[str, str]:
    """Drop a meta preamble that precedes the actual customer-facing letter.

    Handles two production leak shapes:

    1. Research commentary, then ``---``, then a greeting-opened draft.
    2. Research commentary directly above a greeting with no divider
       (e.g. "Het company doc is een stub…\\n\\nHoi Sjaak,…").

    Conservative: without a greeting later in the text, nothing is peeled.
    """
    lines = text.splitlines()
    divider_idx = None
    first_greeting_idx = None
    for i, line in enumerate(lines):
        if first_greeting_idx is None and _GREETING_RE.match(line):
            first_greeting_idx = i
        if divider_idx is None and _DIVIDER_RE.match(line):
            divider_idx = i

    # Divider + greeting after it: classic leak pattern.
    if divider_idx is not None and divider_idx > 0:
        rest = lines[divider_idx + 1 :]
        for line in rest:
            if not line.strip():
                continue
            if _GREETING_RE.match(line):
                preamble = "\n".join(lines[:divider_idx]).strip()
                return "\n".join(rest).strip(), preamble
            break
    elif divider_idx == 0:
        # Leading divider with no preamble text: just drop the divider.
        return "\n".join(lines[1:]).lstrip("\n"), ""

    # Greeting after non-empty meta lines (no divider required).
    if first_greeting_idx is not None and first_greeting_idx > 0:
        before = "\n".join(lines[:first_greeting_idx]).strip()
        if before:
            return "\n".join(lines[first_greeting_idx:]).strip(), before

    return text, ""


def _strip_dividers(text: str) -> str:
    """Remove standalone horizontal rules; they read as email formatting noise."""
    lines = [line for line in text.splitlines() if not _DIVIDER_RE.match(line)]
    return "\n".join(lines)


def _strip_signoff(text: str) -> str:
    """Remove a trailing closing formula + short name lines.

    The signature system appends exactly one signature server-side; any
    model-written sign-off ("Met vriendelijke groet, Bokito Assistent")
    would stack on top of it.
    """
    lines = text.rstrip().splitlines()
    # Walk upward past short name/role lines to find a closing formula.
    idx = len(lines) - 1
    name_lines = 0
    while idx >= 0:
        line = lines[idx].strip()
        if not line:
            idx -= 1
            continue
        if _CLOSING_RE.match(line):
            # Guard: never strip when the closing is (nearly) the whole draft.
            remaining = [part for part in lines[:idx] if part.strip()]
            if not remaining:
                return text
            return "\n".join(lines[:idx]).rstrip()
        # Handle single-line "Met vriendelijke groet, Naam".
        single = re.match(
            r"^(?P<closing>[^,]{2,40}),\s*(?P<name>[^,]{1,64})$", line
        )
        if single and _CLOSING_RE.match(single.group("closing").strip() + ","):
            remaining = [part for part in lines[:idx] if part.strip()]
            if not remaining:
                return text
            return "\n".join(lines[:idx]).rstrip()
        if (
            name_lines < _MAX_SIGNOFF_NAME_LINES
            and len(line) <= _MAX_SIGNOFF_NAME_LEN
            and not line.endswith((".", "?", "!", ":"))
        ):
            name_lines += 1
            idx -= 1
            continue
        break
    return text


def split_suggestion(text: str) -> SuggestionParts:
    """Parse raw model output into a clean draft body + internal note.

    Defensive by design: applies the ``INTERNAL_NOTE:`` contract first, then
    legacy leak patterns. Falls back to the original text when cleaning would
    leave an empty body, so a draft is never silently lost.
    """
    raw = (text or "").strip()
    if not raw:
        return SuggestionParts(body="", internal_note="")

    working = _strip_operator_prompt(raw) or raw
    body, sentinel_note = _extract_sentinel_note(working)
    body, legacy_note = _extract_legacy_note(body)
    body, preamble = _strip_preamble(body)
    body = _strip_dividers(body)
    body = _strip_signoff(body)
    body = _collapse_blank_lines(body)

    note_parts = [part for part in (preamble, sentinel_note, legacy_note) if part]
    internal_note = _collapse_blank_lines("\n\n".join(note_parts)) if note_parts else ""

    if not body:
        # Cleaning removed everything: keep the original so nothing is lost.
        return SuggestionParts(body=raw, internal_note="")
    return SuggestionParts(body=body, internal_note=internal_note)
