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

# Parcel carriers: their mail is always track-and-trace, never a conversation.
_SHIPPER_DOMAINS = (
    "postnl.nl",
    "postnl.com",
    "dhl.com",
    "dhl.nl",
    "dhl.de",
    "dhlparcel.nl",
    "ups.com",
    "dpd.nl",
    "dpd.com",
    "dpd.de",
    "gls-netherlands.com",
    "gls-group.eu",
    "gls-group.com",
    "fedex.com",
    "bpost.be",
    "budbee.com",
    "trunkrs.nl",
    "homerr.com",
    "sendcloud.com",
    "sendcloud.sc",
    "parcelpanel.com",
    "aftership.com",
)

# Shipment-status subjects (NL/EN). Replies ("Re:", "Fw:") are conversations.
_PARCEL_SUBJECT_RE = re.compile(
    r"\b("
    r"je pakket|jouw pakket|uw pakket|pakket(je)? (is|komt|van)|pakketnummer|"
    r"afgeleverd|onderweg met|bezorgmoment|bezorgd|track ?(&|and|en) ?trace|"
    r"your (parcel|package|order|shipment) (is|has|was)|out for delivery|"
    r"has been delivered|shipment (update|notification)|tracking number"
    r")\b",
    re.IGNORECASE,
)
_REPLY_PREFIX_RE = re.compile(r"^\s*(re|fw|fwd|antw|wg)\s*:", re.IGNORECASE)


def is_shipper_address(address: str) -> bool:
    addr = (address or "").strip().lower()
    if "@" not in addr:
        return False
    domain = addr.rsplit("@", 1)[1]
    return any(domain == d or domain.endswith(f".{d}") for d in _SHIPPER_DOMAINS)


def is_parcel_notification_subject(subject: str) -> bool:
    text = (subject or "").strip()
    if not text or _REPLY_PREFIX_RE.match(text):
        return False
    return bool(_PARCEL_SUBJECT_RE.search(text))

# Sentinel the suggest-mode agent returns when it decides no reply is needed.
NO_REPLY_SENTINEL = "NO_REPLY_NEEDED"

# DecisionRequest.title for tip cards on automated / no-reply mail. Attention
# badges and the Decisions queue exclude these — they are soft guidance on the
# thread, not items that block agents.
NO_REPLY_DECISION_TITLE = "No reply needed"


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
    subject: str = "",
) -> dict:
    """Classify an inbound email as automated (no reply possible/expected).

    ``headers`` is the small ``auto_headers`` dict captured at sync time
    (lower-cased RFC header names). Returns ``{"automated": bool, "reason": str}``.
    """
    if is_no_reply_address(sender_address):
        return {"automated": True, "reason": "no_reply_address"}

    if is_shipper_address(sender_address):
        return {"automated": True, "reason": "shipping_notification"}
    if is_parcel_notification_subject(subject):
        return {"automated": True, "reason": "shipping_notification"}

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


_SENTINEL_LINE_RE = re.compile(
    r"^\s*(?:[*_`#>\-]+\s*)?" + re.escape(NO_REPLY_SENTINEL) + r"\b(.*)$",
    re.IGNORECASE,
)


def extract_no_reply_summary(reply_text: str) -> str | None:
    """Parse the agent's ``NO_REPLY_NEEDED: <summary>`` sentinel.

    Models sometimes think out loud first ("Dit is een inkomende e-mail van
    ...") and only then write the sentinel line. The sentinel counts wherever
    it appears on its own line; the preamble is dropped so it never becomes a
    customer draft. Returns the one-line summary when the sentinel is present,
    else ``None``.
    """
    text = (reply_text or "").strip()
    if not text:
        return None
    for line in text.splitlines():
        match = _SENTINEL_LINE_RE.match(line)
        if not match:
            continue
        rest = match.group(1).lstrip(" :.-\u2014").strip().rstrip("*_`")
        return rest or "Automated notification; no reply needed."
    return None


def mentions_no_reply_sentinel(text: str | None) -> bool:
    """True when the sentinel appears anywhere (even mid-sentence)."""
    return NO_REPLY_SENTINEL in (text or "").upper()
