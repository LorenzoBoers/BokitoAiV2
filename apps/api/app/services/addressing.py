"""Who a message speaks to, and who it only names.

A mention addresses an agent or team when it opens the message (or a
sentence), closes it, or is set off as a vocative (``@Ana, can you``). A
mention inside a sentence ("ask @Ana about it") is a reference: the named
agent does not take a turn for it. A plural word ("both", "allebei") with two
or more mentions addresses all of them.

When nobody is addressed the turn goes to the floor holder, then to the
agent ``team_router`` picks (last speaker first).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from uuid import UUID

from app.services.thread_dispatch import ENTITY_MENTION_PATTERN

_PLURAL = re.compile(
    r"\b(allebei|jullie|ieder|allemaal|each|both|all of you|everyone|iedereen)\b",
    re.IGNORECASE,
)
_GREETING = re.compile(
    r"^(hi|hey|hoi|hallo|dag|hello|ok|oke|oké|okay|thanks|dank|bedankt|en|and|nu|now|so|dus|ja|yes|nee|no|top|prima|goed)$",
    re.IGNORECASE,
)
_SENTENCE_END = re.compile(r"[.!?\n]\s*$")


@dataclass
class Mention:
    kind: str
    id: UUID
    name: str
    start: int
    end: int
    addressed: bool = False


@dataclass
class Addressing:
    mentions: list[Mention] = field(default_factory=list)
    plural: bool = False

    def addressed(self, kind: str | None = None) -> list[tuple[str, UUID]]:
        return _unique(m for m in self.mentions if m.addressed and (kind is None or m.kind == kind))

    def referenced(self, kind: str | None = None) -> list[tuple[str, UUID]]:
        hit = set(self.addressed())
        return [
            ref
            for ref in _unique(m for m in self.mentions if not m.addressed and (kind is None or m.kind == kind))
            if ref not in hit
        ]


def _unique(mentions) -> list[tuple[str, UUID]]:
    out: list[tuple[str, UUID]] = []
    for m in mentions:
        key = (m.kind, m.id)
        if key not in out:
            out.append(key)
    return out


def _bare(text: str) -> str:
    """Text with other mentions and punctuation removed."""
    return re.sub(r"[\s,;:.!?\-]+", " ", ENTITY_MENTION_PATTERN.sub(" ", text)).strip()


def _opens(before: str) -> bool:
    if not before.strip() or _SENTENCE_END.search(before):
        return True
    words = _bare(before.split("\n")[-1]).split()
    return len(words) <= 1 and all(_GREETING.match(w) for w in words)


def _closes(after: str) -> bool:
    return not _bare(after)


def _vocative(after: str) -> bool:
    return after.lstrip()[:1] in (",", ":")


def resolve(body_text: str) -> Addressing:
    text = body_text or ""
    mentions: list[Mention] = []
    for match in ENTITY_MENTION_PATTERN.finditer(text):
        name, kind, raw = match.groups()
        if kind not in ("agent", "team"):
            continue
        try:
            ref = UUID(raw)
        except ValueError:
            continue
        mentions.append(Mention(kind=kind, id=ref, name=name, start=match.start(), end=match.end()))

    plural = bool(_PLURAL.search(ENTITY_MENTION_PATTERN.sub(" ", text)))
    distinct = {(m.kind, m.id) for m in mentions}
    for m in mentions:
        if plural and len(distinct) >= 2:
            m.addressed = True
            continue
        before = ENTITY_MENTION_PATTERN.sub(" ", text[: m.start])
        after = ENTITY_MENTION_PATTERN.sub(" ", text[m.end :])
        m.addressed = _opens(before) or _closes(after) or _vocative(text[m.end :])
    return Addressing(mentions=mentions, plural=plural)


def turn_line(body_text: str, agent_id: UUID) -> str:
    """One prompt line: whether this agent was addressed or only named."""
    result = resolve(body_text)
    others = [m.name for m in result.mentions if m.kind == "agent" and m.id != agent_id and not m.addressed]
    me = [m for m in result.mentions if m.kind == "agent" and m.id == agent_id]
    if me and any(m.addressed for m in me):
        line = "You were addressed directly."
    elif me:
        line = "You were only named in passing; answer only if the message is for you."
    else:
        line = ""
    if others:
        names = ", ".join(dict.fromkeys(others))
        line = (line + " " if line else "") + (
            f"The message refers to {names}; they were not addressed. "
            "If their help is needed, ask them with ask_agent instead of speaking for them."
        )
    return line
