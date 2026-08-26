"""Detect automated / no-reply email so the AI never drafts a pointless reply.

Two detection layers work together:

1. Deterministic heuristics here (sender address patterns + RFC auto-mail
   headers captured during sync). These short-circuit the agent loop entirely,
   so no tokens are spent drafting a reply that must never be sent.
2. A prompt guardrail in the suggest-mode agent: when the model itself judges
   the message to be an automated notification it returns a
   ``NO_REPLY_NEEDED: <summary>`` sentinel instead of a draft, which callers
   convert into an action suggestion via :func:`extract_no_reply_summary`.
"""

from __future__ import annotations

import re

# Local-part patterns that identify unattended sender mailboxes.
_NO_REPLY_LOCAL_PATTERNS = (
    r"^no[-_.]?reply",
    r"^do[-_.]?not[-_.]?reply",
    r"^donotreply",
    r"^notifications?$",
    r"^notification[-_.]",
    r"^notifier",
    r"^alerts?$",
    r"^alert[-_.]",
    r"^mailer[-_.]?daemon",
    r"^postmaster$",
    r"^bounces?([-_.+]|$)",
    r"^newsletters?$",
    r"^auto[-_.]?confirm",
    r"^unattended",
)

_NO_REPLY_RE = re.compile("|".join(_NO_REPLY_LOCAL_PATTERNS), re.IGNORECASE)

# Sentinel the suggest-mode agent returns when it decides no reply is needed.
NO_REPLY_SENTINEL = "NO_REPLY_NEEDED"


def is_no_reply_address(address: str) -> bool:
    """True when the sender address is an unattended (no-reply style) mailbox."""
    addr = (address or "").strip().lower()
    if not addr or "@" not in addr:
        return False
    local = addr.split("@", 1)[0]
    return bool(_NO_REPLY_RE.search(local))


def classify_automated_email(
    sender_address: str,
    headers: dict | None = None,
) -> dict:
    """Classify an inbound email as automated (no reply possible/expected).

    ``headers`` is the small ``auto_headers`` dict captured at sync time
    (lower-cased RFC header names). Returns ``{"automated": bool, "reason": str}``.
    """
    if is_no_reply_address(sender_address):
        return {"automated": True, "reason": "no_reply_address"}

    hdrs = {k.lower(): str(v or "") for k, v in (headers or {}).items()}

    auto_submitted = hdrs.get("auto-submitted", "").strip().lower()
    if auto_submitted and auto_submitted != "no":
        return {"automated": True, "reason": "auto_submitted"}

    precedence = hdrs.get("precedence", "").strip().lower()
    if precedence in ("bulk", "list", "junk", "auto_reply"):
        return {"automated": True, "reason": "bulk_precedence"}

    if hdrs.get("x-auto-response-suppress"):
        return {"automated": True, "reason": "auto_response_suppress"}

    if hdrs.get("list-id") or hdrs.get("list-unsubscribe"):
        return {"automated": True, "reason": "mailing_list"}

    # Null return-path (`<>`) marks bounces / delivery status notifications.
    return_path = hdrs.get("return-path", "").strip()
    if return_path == "<>":
        return {"automated": True, "reason": "null_return_path"}

    return {"automated": False, "reason": ""}


_WS_RE = re.compile(r"\s+")


def clip_with_ellipsis(text: str, max_chars: int = 160) -> str:
    """Collapse whitespace and cut on a word boundary with a trailing ellipsis."""
    cleaned = _WS_RE.sub(" ", (text or "").strip())
    if not cleaned:
        return ""
    if len(cleaned) <= max_chars:
        return cleaned
    slice_ = cleaned[:max_chars]
    at = slice_.rfind(" ")
    clipped = slice_[:at] if at >= 40 else slice_
    clipped = clipped.rstrip(".,;:").rstrip()
    return f"{clipped}..." if clipped else f"{slice_.rstrip()}..."


def extract_no_reply_summary(reply_text: str) -> str | None:
    """Parse the agent's ``NO_REPLY_NEEDED: <summary>`` sentinel.

    Returns the one-line summary when the sentinel is present, else ``None``.
    """
    text = (reply_text or "").strip()
    if not text.upper().startswith(NO_REPLY_SENTINEL):
        return None
    rest = text[len(NO_REPLY_SENTINEL):].lstrip(" :.-\u2014").strip()
    return rest or "Automated notification; no reply needed."
