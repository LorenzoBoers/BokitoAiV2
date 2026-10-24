"""One job card for a spoken or delegated request.

The card is built from the current sentence. A name from an earlier guess is
not a slot. Missing slots stop the turn. A colleague receives the card, not
the rest of the lane.
"""

from __future__ import annotations

import difflib
import json
import re
from typing import Any

SLOTTED = ("invoice", "contact", "folder", "sheet")
LOOKUP = SLOTTED

_ANAPHORA = re.compile(
    r"(?i)\b(die|deze|dezelfde|daarvan|die klant|die factuur|dat gesprek|de sheet|het dashboard)\b"
)
_INVOICE_NO = re.compile(r"(?i)\b(?:factuur\s*)?#?\d{3,}-\d{2,}\b")
_PERIOD = re.compile(
    r"(?i)\b(deze maand|vorige maand|vorige week|dit jaar|vorig jaar|q[1-4]|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\b"
)
_WORD = r"[A-Z][\w'’-]{1,}"
_NAME_SPAN = re.compile(
    rf"\b[A-Z][\w'’-]{{2,}}(?:\s+(?:[Dd]e|[Vv]an|[Dd]en|[Dd]er|[Hh]et)\s+{_WORD}|\s+{_WORD})+"
)
_OF = re.compile(
    rf"\b(?:[Vv]an|[Vv]oor|[Bb]ij|[Oo]ver)\s+({_NAME_SPAN.pattern[2:]}|[A-Z][\w'’-]{{2,}})"
)
_STOP = {
    "ik", "je", "jij", "we", "wij", "de", "het", "een", "van", "voor", "met", "bij",
    "oké", "oke", "okay", "crm", "bokito", "intercom", "lotty", "boekito",
    "the", "and", "this", "that", "what", "which",
}

QUESTIONS = {
    "invoice": {"nl": "Welke klant of welk factuurnummer?", "en": "Which customer or invoice number?"},
    "contact": {"nl": "Over wie gaat het?", "en": "Who is it about?"},
    "folder": {"nl": "Hoe moet de map heten?", "en": "What should the folder be called?"},
    "sheet": {"nl": "Welke sheet?", "en": "Which sheet?"},
}

TOOLS: dict[str, tuple[str, ...]] = {
    "contact": ("list_contacts", "get_contact"),
    "folder": ("list_folders", "create_folder"),
    "sheet": (
        "list_canvases",
        "get_folder_canvas",
        "create_canvas",
        "edit_canvas",
        "finish_canvas",
        "restore_canvas",
    ),
    "help": ("search_product_help",),
    "thread": ("list_threads", "get_ticket"),
    "web": ("web_search", "fetch_url"),
    "conversation": ("start_conversation", "file_ticket", "list_threads"),
    "status": ("list_threads", "get_ticket", "get_tenant_overview"),
    "email": (),
    "answer": (),
    "invoice": (),
}

EVENT_TOOLS = frozenset({
    "list_threads",
    "get_ticket",
    "search_product_help",
    "post_internal_note",
    "list_tags",
})

MARK = "[[job]]"
LOOKUP_TOOLS = frozenset({"list_contacts", "get_contact", "list_folders", "list_canvases"})


def _question(job: str, language: str) -> str:
    row = QUESTIONS.get(job) or QUESTIONS["invoice"]
    return row.get(language) or row["nl"]


def _names(text: str) -> list[str]:
    found: list[str] = []
    for match in _OF.finditer(text or ""):
        found.append(" ".join(match.group(1).split()))
    for match in _NAME_SPAN.finditer(text or ""):
        span = " ".join(match.group(0).split())
        if span.casefold() in _STOP:
            continue
        if span not in found:
            found.append(span)
    return found


def _customer(text: str) -> str:
    names = _names(text)
    return names[0] if names else ""


# A title they quote is the title, whatever its capitals: 'Trends bakkerij'.
_QUOTED = re.compile(r"(?:^|[\s:])[\"'\u201c\u2018]([^\"'\u201d\u2019]{2,80})[\"'\u201d\u2019]")


# The word right after the noun names it, whatever its capitals: "de map krediteuren".
_NOT_A_NAME = {
    "met", "voor", "aan", "en", "in", "op", "van", "de", "het", "een", "die", "dat", "waar",
    "waarin", "om", "te", "is", "nog", "ook", "bij", "over", "als", "erin", "naar", "uit",
    "with", "for", "on", "of", "the", "a", "an", "to", "and", "called", "named", "about",
}


def _named(text: str, nouns: str) -> str:
    pattern = (
        rf"\b(?i:{nouns})\s+(?:(?i:met de (?:naam|titel)|genaamd|getiteld|called|named|titled)\s+)?"
        rf"([\w'’-]{{2,}}(?:\s+(?:[Dd]e|[Vv]an|[Dd]en|[Dd]er|[Hh]et)\s+{_WORD}|\s+{_WORD})*)"
    )
    for match in re.finditer(pattern, text or ""):
        if match.group(1).split()[0].casefold() not in _NOT_A_NAME:
            return " ".join(match.group(1).split())
    return ""


def _title(text: str, nouns: str = "") -> str:
    quoted = _QUOTED.search(text or "")
    if quoted:
        return " ".join(quoted.group(1).split())
    return (_named(text, nouns) if nouns else "") or _customer(text)


def classify(text: str, language: str = "nl") -> dict[str, Any]:
    """Read the job and its slots from this sentence only."""
    raw = " ".join((text or "").split())
    raw.lower()
    anaphora = _ANAPHORA.search(raw) is not None
    slots: dict[str, str] = {}
    job = "answer"
    if re.search(r"(?i)\b(stuur|verstuur)\b.{0,60}\b(e-?mail|mail)\b", raw) or re.search(
        r"(?i)\b(e-?mail|stuur .+ mail)\b", raw
    ):
        job = "email"
    elif re.search(r"(?i)\bfactuur", raw):
        job = "invoice"
        number = _INVOICE_NO.search(raw)
        period = _PERIOD.search(raw)
        customer = _customer(raw)
        if number:
            slots["number"] = number.group(0)
        if period:
            slots["period"] = period.group(0)
        if customer:
            slots["customer"] = customer
    elif re.search(r"(?i)\b(telefoon\w*|notities?|debiteur\w*|contacten|nummer van)\b", raw):
        job = "contact"
        customer = _customer(raw)
        if customer:
            slots["customer"] = customer
    elif re.search(r"(?i)\b(map|folder)\b", raw) and not re.search(
        r"(?i)\b(dashboard|canvas|sheet)\b", raw
    ):
        job = "folder"
        customer = _title(raw, "map|folder")
        if customer:
            slots["name"] = customer
    elif re.search(r"(?i)\b(dashboard|canvas|sheet)\b", raw):
        # "de sheet X in de map Y" is about the sheet; the map is where it lives.
        job = "sheet"
        customer = _title(raw, "dashboard|canvas|sheet")
        if customer:
            slots["title"] = customer
    elif re.search(
        r"(?i)\b(openstaand\w*|wat staat er|staat er open|welk werk|wat hebben we open)\b",
        raw,
    ):
        job = "status"
    elif re.search(r"(?i)\b(hoe |verplaats|nakijk|leg .+ uit)\b", raw):
        job = "help"
    elif re.search(r"(?i)\b(volgende stap|blijft open|kijk wat erin)\b", raw):
        job = "thread"
    elif re.search(r"(?i)\b(internet|google|web)\b", raw):
        job = "web"
    elif re.search(r"(?i)\b(gesprek|ticket)\b", raw):
        job = "conversation"
    missing = _missing(job, slots, anaphora)
    card = {
        "job": job,
        "slots": slots,
        "missing": missing,
        "anaphora": anaphora,
        "language": language if language in ("nl", "en") else "nl",
        "status": "open" if missing else "ready",
    }
    card["question"] = _question(job, card["language"]) if missing else ""
    card["brief"] = brief_for(card, raw)
    return card


def _missing(job: str, slots: dict[str, str], anaphora: bool) -> list[str]:
    if job == "invoice":
        if slots.get("customer") or slots.get("number") or slots.get("period"):
            return []
        if anaphora:
            return ["customer"]
        return ["customer"]
    if job == "contact" and not slots.get("customer"):
        return ["customer"]
    if job == "folder" and not slots.get("name"):
        return ["name"]
    if job == "sheet" and not slots.get("title") and not anaphora:
        return ["title"]
    return []


def brief_for(card: dict[str, Any], sentence: str = "") -> str:
    slots = card.get("slots") or {}
    job = card.get("job") or "answer"
    language = card.get("language") or "nl"
    rendered = ", ".join(f"{key}: {value}" for key, value in slots.items())
    if job == "invoice" and rendered:
        if language == "nl":
            return (
                f"Zoek de factuur. Gebruik alleen deze gegevens: {rendered}. "
                "Geen andere klant. Antwoord in één of twee zinnen met wat je vond."
            )
        return (
            f"Look up the invoice. Use only these details: {rendered}. "
            "No other customer. Answer in one or two sentences with what you found."
        )
    if job in SLOTTED and rendered:
        return f"{sentence.strip()} ({rendered})"[:500]
    return sentence.strip()[:500]


def resolve(text: str, open_job: dict[str, Any] | None, language: str = "nl") -> dict[str, Any]:
    """Merge a follow-up into an open card, or start a new one."""
    card = classify(text, language)
    if not open_job or open_job.get("status") != "open":
        return card
    # Only a short reply right after the question answers it; the caller passes
    # no card once the person has spoken since. A longer sentence or another job
    # is a new request: the open question expires and is never merged into it.
    if len((text or "").split()) > 8 or card["job"] not in (open_job.get("job"), "answer"):
        return card
    name = _customer(text)
    fills = bool(name) and card["job"] == "answer"
    merged_slots = dict(open_job.get("slots") or {})
    merged_slots.update(card["slots"])
    if fills and open_job.get("job") == "invoice" and "customer" not in merged_slots:
        merged_slots["customer"] = name
    if fills and open_job.get("job") == "contact" and "customer" not in merged_slots:
        merged_slots["customer"] = name
    if fills and open_job.get("job") in ("folder", "sheet"):
        key = "name" if open_job.get("job") == "folder" else "title"
        merged_slots.setdefault(key, name)
    anaphora = card["anaphora"] or bool(open_job.get("anaphora"))
    missing = _missing(str(open_job.get("job") or card["job"]), merged_slots, anaphora and not fills)
    if anaphora and merged_slots:
        missing = [item for item in missing if item not in merged_slots]
    out = {
        "job": open_job.get("job") or card["job"],
        "slots": merged_slots,
        "missing": missing,
        "anaphora": anaphora,
        "language": language if language in ("nl", "en") else "nl",
        "status": "open" if missing else "ready",
    }
    out["question"] = _question(out["job"], out["language"]) if missing else ""
    out["brief"] = brief_for(out, text if not fills else f"{open_job.get('job')} {name}")
    return out


def should_ask(card: dict[str, Any]) -> bool:
    return bool(card.get("missing")) and card.get("job") in SLOTTED


def delegation_block(text: str, language: str = "nl") -> str | None:
    """Refuse to hand off a lookup that still misses a slot."""
    card = classify(text, language)
    if card["job"] in SLOTTED and card["missing"]:
        ask = card["question"]
        if language == "nl":
            return f"{ask} Vraag het de persoon. Geef het niet door."
        return f"{ask} Ask the person. Do not delegate."
    return None


def pack(visible: str, card: dict[str, Any]) -> str:
    payload = {
        key: card.get(key)
        for key in ("job", "slots", "missing", "language", "status", "sentence", "question")
    }
    return f"{(visible or '').rstrip()}\n\n{MARK}\n{json.dumps(payload, ensure_ascii=False)}"


def unpack(prompt: str) -> tuple[str, dict[str, Any] | None]:
    if MARK not in (prompt or ""):
        return prompt or "", None
    visible, raw = (prompt or "").split(MARK, 1)
    raw = raw.strip()
    try:
        card = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        card = None
    if not isinstance(card, dict):
        return visible.strip(), None
    return visible.strip(), card


def tools_for(card: dict[str, Any] | None) -> tuple[str, ...] | None:
    """None means the caller keeps its own tool list."""
    if not card:
        return None
    job = str(card.get("job") or "")
    if job == "invoice" and card.get("status") == "ready":
        return ("accounting",)
    if job in TOOLS:
        return TOOLS[job]
    return None


def query_in_bounds(query: str, sentence: str, slots: dict[str, str] | None) -> bool:
    """A lookup may only use words from the sentence or the filled slots."""
    text = " ".join((query or "").split())
    if not text:
        return False
    hay = f"{sentence or ''} {' '.join((slots or {}).values())}".casefold()
    words = [word for word in re.findall(r"[A-Za-zÀ-ÿ]{4,}", text) if word.casefold() not in _STOP]
    if not words:
        return text.casefold() in hay
    # Speech mishears names; a close spelling of a word they said is still theirs.
    heard = re.findall(r"[a-zà-ÿ]{4,}", hay)
    return all(
        word.casefold() in hay or difflib.get_close_matches(word.casefold(), heard, n=1, cutoff=0.75)
        for word in words
    )


def ungrounded_names(reply: str, allowed: str) -> list[str]:
    hay = (allowed or "").casefold()
    found: list[str] = []
    for span in _names(reply or ""):
        if span.casefold() in _STOP:
            continue
        if span.casefold() in hay:
            continue
        # A single common-looking token at the start is not a customer.
        if " " not in span and span.casefold() in _STOP:
            continue
        found.append(span)
    return found


def ground_reply(reply: str, allowed: str, card: dict[str, Any] | None) -> str:
    """A lookup answer may not introduce a customer the tools did not return."""
    names = ungrounded_names(reply, allowed)
    if not names:
        return reply
    job = (card or {}).get("job")
    question = (card or {}).get("question") or ""
    if job in LOOKUP and question:
        return question
    cleaned = reply
    for span in names:
        cleaned = cleaned.replace(span, "")
    cleaned = " ".join(cleaned.split()).strip(" ,.-")
    return cleaned or reply


_QUERY_KEYS = ("query", "name", "title", "q", "customer", "search")
_ID_KEYS = ("project_id", "folder_id", "contact_id", "canvas_id", "thread_id", "signal_id")


def lookup_argument(name: str, payload: Any) -> str | None:
    """None lets the call through. An empty string is a search with no name."""
    if name not in LOOKUP_TOOLS:
        return None
    data = payload if isinstance(payload, dict) else {}
    for key in _QUERY_KEYS:
        value = str(data.get(key) or "").strip()
        if value:
            return value
    if any(str(data.get(key) or "").strip() for key in _ID_KEYS):
        return None
    # Listing this conversation's canvases or folders names nobody; only a
    # contact search without a name is a guess.
    if name in ("list_canvases", "list_folders"):
        return None
    return ""


def call_key(name: str, payload: Any) -> str:
    try:
        blob = json.dumps(payload or {}, sort_keys=True, default=str, ensure_ascii=False)
    except TypeError:
        blob = str(payload)
    return f"{name}\n{blob}"


def failure_text(result: Any) -> str | None:
    """Set when the same arguments must not run again this turn."""
    if not isinstance(result, dict):
        return None
    error = str(result.get("error") or "")
    if "call the tool again" in error.lower():
        return None
    status = str(result.get("status") or "")
    if status in ("denied", "error", "failed", "invalid", "timeout"):
        return error or status
    if error and "not available" in error.lower():
        return error
    return None
