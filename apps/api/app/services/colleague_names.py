"""Colleagues named in a spoken line, and an honest end to a peer ask.

Voice turns go through STT and a chat model. Two things went wrong on the dev
server (CH1–CH32, 24-10-2026):

- STT turns a colleague's name into a near miss ("Katel", "Kato", "Tato" for
  Cato). The turn then did not see a named colleague and dropped the
  intercom tool.
- The model wrote the call as text ("intercom_agent Cato *Dinsdag is vrij.*",
  "Handoff_to Dirk", "ask_agent Bram") and ended the turn. Nobody was asked,
  and the person heard an answer nobody gave.

Everything here matches against the workspace's own active agents only, so a
near miss can only become a real colleague's name, never a new person.
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any, Iterable, Sequence

# Tool names that must never be read aloud or shown as a spoken line.
TOOL_WORDS = re.compile(
    r"(?i)\b(?:intercom_agent|ask_agent|handoff_to|handoff to|start_conversation|"
    r"search_product_help|move_to_conversation|send_subagent_message|spawn_subagent|agent_id)\b"
)
PEER_TOOLS = frozenset({"intercom_agent", "ask_agent", "handoff_to"})

_ASK_VERB = re.compile(r"(?i)^(?:vraag|vraagt|vraach|vraagh|vragen|vroeg|navragen|ask|asks|informeer)$")
_FILLER = frozenset({"even", "eens", "ff", "effe", "het", "aan", "bij", "jij", "je", "u", "toch", "nog", "maar", "dan", "ook", "aan:"})
_PREFIX = re.compile(r"^\s*\[[^\]]*\]\s*")
_WORD = re.compile(r"[\w'-]+", re.UNICODE)
_CONJ = re.compile(
    r"(?i)^(of|wat|wanneer|hoe|hoeveel|wie|waar|welke|welk|waarom|whether|if|what|when|how|who|where|which|why)\b"
)
# "Bram heeft gezegd ...", "zoals Bram heeft aangegeven", "Bram antwoordt ..."
_CLAIM = r"(?i)\b{name}\b[^.!?]{{0,40}}\b(zegt|zei|heeft gezegd|heeft aangegeven|antwoordt|antwoordde|laat weten|meldt|says|said|replied|answered)\b"


def short_name(name: str) -> str:
    """'[TEST] Cato' -> 'Cato'."""
    return " ".join(_PREFIX.sub("", name or "").split())


def _fold(word: str) -> str:
    text = unicodedata.normalize("NFKD", word or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]", "", text)


def _key(word: str) -> str:
    # c/k sound the same in Dutch names (Cato / Kato); ph/f, ij/y as well.
    return _fold(word).replace("ph", "f").replace("ij", "y").replace("c", "k")


def _names_of(agent: Any) -> list[str]:
    full = short_name(getattr(agent, "name", "") or "")
    if not full:
        return []
    out = [full]
    first = full.split()[0]
    if first != full and len(first) >= 3:
        out.append(first)
    return out


def _close(token: str, name: str) -> float:
    """Similarity of a heard word to a colleague's name; 0 when not plausible."""
    a, b = _key(token), _key(name)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if len(a) < 3 or len(b) < 3 or abs(len(a) - len(b)) > 2:
        return 0.0
    # The sound must match at the start or right after it (Kato/Cato, Tato/Cato).
    if a[:2] != b[:2] and a[1:3] != b[1:3]:
        return 0.0
    ratio = SequenceMatcher(None, a, b).ratio()
    return ratio if ratio >= 0.66 else 0.0


def _tokens(text: str) -> list[tuple[str, int, int]]:
    return [(m.group(0), m.start(), m.end()) for m in _WORD.finditer(text or "")]


def _ask_slots(tokens: list[tuple[str, int, int]]) -> list[int]:
    """Token positions where a colleague's name stands in an ask.

    "vraag Kato of ...", "vraagt Tato van planning", "vraag aan Cato",
    "wil je Bram even vragen of ...".
    """
    slots: list[int] = []
    for i, (word, _s, _e) in enumerate(tokens):
        if not _ASK_VERB.match(word):
            continue
        j, skipped = i + 1, 0
        while j < len(tokens) and tokens[j][0].lower() in _FILLER and skipped < 2:
            j, skipped = j + 1, skipped + 1
        if j < len(tokens):
            slots.append(j)
        if word.lower() in ("vragen", "navragen"):
            k, skipped = i - 1, 0
            while k >= 0 and tokens[k][0].lower() in _FILLER and skipped < 2:
                k, skipped = k - 1, skipped + 1
            if k >= 0:
                slots.append(k)
    return slots


def _best(token: str, agents: Sequence[Any]) -> tuple[Any | None, float]:
    best, score, tie = None, 0.0, False
    for agent in agents:
        s = max((_close(token, name) for name in _names_of(agent)), default=0.0)
        if s > score:
            best, score, tie = agent, s, False
        elif s and s == score and agent is not best:
            tie = True
    if tie and score < 1.0:
        return None, 0.0
    return best, score


def _others(agents: Iterable[Any], exclude_id: Any = None) -> list[Any]:
    return [a for a in agents if a is not None and (exclude_id is None or getattr(a, "id", None) != exclude_id)]


def asked_colleague(text: str, agents: Iterable[Any], *, exclude_id: Any = None) -> tuple[Any | None, str]:
    """The colleague this sentence asks to be asked, and the word that was heard."""
    pool = _others(agents, exclude_id)
    tokens = _tokens(text)
    for slot in _ask_slots(tokens):
        word = tokens[slot][0]
        agent, score = _best(word, pool)
        if agent is not None and score:
            return agent, word
    return None, ""


def named_colleague(text: str, agents: Iterable[Any], *, exclude_id: Any = None) -> Any | None:
    """Any colleague named in the sentence: exactly anywhere, or as a near miss in an ask."""
    pool = _others(agents, exclude_id)
    asked, _ = asked_colleague(text, pool)
    if asked is not None:
        return asked
    folded = {_key(word) for word, _s, _e in _tokens(text)}
    for agent in pool:
        for name in _names_of(agent):
            parts = [_key(p) for p in name.split()]
            if parts and all(p in folded for p in parts):
                return agent
    return None


def match_agent_name(name: str, agents: Iterable[Any], *, exclude_id: Any = None) -> Any | None:
    """The active colleague a written or spoken name means, or None when unclear."""
    pool = _others(agents, exclude_id)
    cleaned = short_name(str(name or "")).strip().strip("*_`\"'.,:;!?")
    if not cleaned:
        return None
    for agent in pool:
        if _fold(cleaned) in {_fold(n) for n in _names_of(agent)}:
            return agent
    agent, score = _best(cleaned.split()[0] if cleaned.split() else cleaned, pool)
    return agent if score else None


def repair_heard_names(text: str, agents: Iterable[Any]) -> str:
    """Write a colleague's real name where STT heard a near miss in an ask."""
    pool = list(agents)
    if not text or not pool:
        return text or ""
    out = text
    tokens = _tokens(text)
    for slot in sorted(set(_ask_slots(tokens)), reverse=True):
        word, start, end = tokens[slot]
        agent, score = _best(word, pool)
        if agent is None or not score:
            continue
        names = _names_of(agent)
        name = names[-1]
        if _fold(word) == _fold(name):
            continue
        out = out[:start] + name + out[end:]
    # A common STT slip of the ask verb itself.
    out = re.sub(r"(?i)\bvraa(?:ch|gh)\b", "vraag", out)
    return out


def leaked_peer_call(text: str, agents: Iterable[Any], *, exclude_id: Any = None) -> Any | None:
    """The colleague in a tool call the model wrote as text, if any."""
    if not text or not TOOL_WORDS.search(text):
        return None
    pool = _others(agents, exclude_id)
    for match in TOOL_WORDS.finditer(text):
        tail = text[match.end() : match.end() + 60]
        for word, _s, _e in _tokens(tail)[:3]:
            if TOOL_WORDS.fullmatch(word):
                continue
            agent, score = _best(word, pool)
            if agent is not None and score:
                return agent
    return None


def strip_tool_words(text: str) -> str:
    """A spoken line without tool names, markdown stars or empty brackets."""
    t = TOOL_WORDS.sub(" ", text or "")
    t = re.sub(r"\*+", "", t)
    t = re.sub(r"\(\s*\)", "", t)
    return " ".join(t.split()).strip(" :-")


def claims_answer_from(text: str, agent: Any) -> bool:
    """True when the line reports what this colleague said."""
    for name in _names_of(agent):
        if re.search(_CLAIM.format(name=re.escape(name)), text or ""):
            return True
    return False


def ask_message(heard: str, word: str) -> str:
    """What to ask the colleague, taken from the person's own sentence."""
    text = " ".join((heard or "").split())
    if not text:
        return ""
    rest = ""
    if word:
        m = re.search(rf"\b{re.escape(word)}\b", text)
        if m:
            after = text[m.end() :]
            # "wil je Bram even vragen of ..." -> after "vragen".
            v = re.match(r"(?i)^\s*(?:(?:even|eens)\s+)?(?:na)?vragen\b", after)
            if v:
                after = after[v.end() :]
            # "Tato van planning of ..." -> drop "van planning".
            after = re.sub(r"(?i)^\s*van\s+[\w-]+\s*", " ", after)
            rest = after.strip(" ,:;")
    if not rest:
        return text[:500]
    rest = re.split(r"(?<=[.?!])\s+", rest, maxsplit=1)[0].strip()
    rest = re.sub(r"(?i)[,.]?\s*laat (?:het )?(?:me|mij)\b.*$", "", rest).strip(" ,.?!")
    if not rest:
        return text[:500]
    if _CONJ.match(rest):
        return f"Kun je laten weten {rest}?"[:500]
    return (rest[0].upper() + rest[1:] + ("" if rest.endswith("?") else "?"))[:500]


def heard_sentence(turn_prompt: str) -> str | None:
    """The person's own words in a dial-turn prompt; None for a colleague's relay."""
    m = re.search(r'said to you over the intercom: "(.*)"', turn_prompt or "")
    return m.group(1) if m else None


def asked_line(agent: Any, language: str) -> str:
    name = short_name(getattr(agent, "name", "") or "")
    if language == "nl":
        return f"Ik heb het aan {name} gevraagd. Je hoort {name} zelf zodra er antwoord is."
    return f"I've asked {name}. You'll hear {name} directly once they answer."


def unreachable_line(agent: Any, language: str) -> str:
    name = short_name(getattr(agent, "name", "") or "")
    if language == "nl":
        return f"Het lukte niet om {name} te vragen. Er is niets gevraagd."
    return f"I couldn't reach {name}. Nothing was asked."


def peer_call_ran(activity: Iterable[dict[str, Any]]) -> bool:
    """A real intercom/ask/handoff tool call that came back without an error."""
    for item in activity or []:
        if isinstance(item, dict) and item.get("tool") in PEER_TOOLS and str(item.get("status") or "") == "ok":
            return True
    return False


def colleague_roster(agents: Iterable[Any], *, exclude_id: Any = None, limit: int = 12) -> str:
    """Names and ids the model needs to call intercom_agent at all."""
    rows = [
        f"{short_name(a.name)} (agent_id {a.id})"
        for a in _others(agents, exclude_id)[:limit]
        if short_name(getattr(a, "name", "") or "")
    ]
    if not rows:
        return ""
    return (
        "## Colleagues you can reach\n"
        + "; ".join(rows)
        + "\nTo ask one of them, call the intercom_agent tool with that agent_id and the question. "
        "Never write a tool name in your reply, and never say what a colleague answered "
        "unless their answer is in this conversation."
    )
