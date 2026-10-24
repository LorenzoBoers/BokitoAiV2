"""Turn-taking rules for spoken input: when a sentence is finished, and when a
sound over the agent's voice is a real interruption.

Pure text rules, no model call. The provider's VAD decides when audio stops;
these rules decide what that audio means:

- ``is_complete_utterance``: "Kun je de factuur van" is not a finished ask,
  even after a pause. A finished sentence needs a closing mark or enough
  trailing silence.
- ``classify_barge_in``: "ja", "oké", "hmm", "mm-hm" while the agent talks or
  works is a backchannel (keep going). Anything else is an interruption
  (yield).
"""

from __future__ import annotations

import re
from typing import Literal

END_SILENCE_MS = 700
"""Trailing silence that ends an unpunctuated sentence."""

PUNCTUATED_SILENCE_MS = 200
"""A closing mark from STT still needs a short pause behind it."""

BACKCHANNEL_MAX_WORDS = 4

_WORD = re.compile(r"[\w\u00c0-\u024f'-]+", re.UNICODE)

HESITATIONS = frozenset({"eh", "ehm", "uh", "uhm", "um", "uhh", "ehh", "euh", "hm", "hmm"})

# A sentence does not end on these: articles, prepositions, conjunctions,
# modal fillers. Dutch first; a few English ones for English calls.
_DANGLING = frozenset(
    {
        "de", "het", "een", "van", "naar", "voor", "met", "aan", "op", "in", "bij",
        "om", "te", "tot", "uit", "over", "door", "onder", "tegen", "zonder",
        "en", "of", "maar", "want", "dus", "dat", "die", "als", "omdat", "dan",
        "nog", "even", "ook", "mijn", "je", "jouw", "uw", "zijn", "haar", "onze",
        "the", "a", "an", "of", "to", "for", "with", "and", "or", "but", "that", "my", "your",
    }
)
# Subject pronouns end a fragment ("of hij") unless the sentence is closed.
_OPEN_SUBJECT = frozenset({"ik", "jij", "hij", "zij", "ze", "we", "wij", "jullie", "i", "he", "she", "we", "they"})

BACKCHANNELS = frozenset(
    {
        "ja", "jaja", "jah", "jep", "oké", "oke", "okay", "ok", "hmm", "hm", "mm", "mmm",
        "mhm", "mm-hm", "mmhm", "uhu", "aha", "ah", "oh", "juist", "precies", "klopt",
        "yes", "yeah", "yep", "right", "uh-huh", "sure",
    }
)


def _words(text: str) -> list[str]:
    return [w.strip("'-") for w in _WORD.findall((text or "").lower()) if w.strip("'-")]


def is_complete_utterance(text: str, *, trailing_silence_ms: int | None = None) -> bool:
    """True when ``text`` reads as a finished sentence the agent may answer.

    ``trailing_silence_ms`` is the pause after the last word (None: the person
    released the talk key, so only the words count).
    """
    words = _words(text)
    if not words:
        return False
    last = words[-1]
    closed = bool(re.search(r"[.!?]\s*$", (text or "").strip()))
    if last in HESITATIONS or last in _DANGLING:
        return False
    if last in _OPEN_SUBJECT and not closed:
        return False
    if trailing_silence_ms is None:
        return True
    if closed:
        return trailing_silence_ms >= PUNCTUATED_SILENCE_MS
    return trailing_silence_ms >= END_SILENCE_MS


def is_backchannel(text: str) -> bool:
    words = _words(text)
    return bool(words) and len(words) <= BACKCHANNEL_MAX_WORDS and all(w in BACKCHANNELS for w in words)


def classify_barge_in(text: str) -> Literal["backchannel", "interrupt"]:
    """'backchannel' keeps the agent going; 'interrupt' means stop and listen."""
    if "?" in (text or ""):
        return "interrupt"
    return "backchannel" if is_backchannel(text) else "interrupt"
