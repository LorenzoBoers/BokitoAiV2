"""Operator vocabulary for agent prompts, from ``docs/product-help/glossary.yaml``.

``sync_product_help.py`` packages the glossary as ``glossary.json`` next to the
product help, so the words agents use are the words the screens use.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

GLOSSARY_PATH = Path(__file__).resolve().parents[1] / "data" / "product_help" / "glossary.json"
VOCABULARY_HEADING = "## Vocabulary"


@lru_cache(maxsize=1)
def glossary() -> dict[str, Any]:
    try:
        data = json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def forbidden_synonyms() -> list[str]:
    """Words that must not appear in operator-facing text, any language."""
    words: list[str] = []
    for term in glossary().get("terms") or []:
        words.extend(str(w) for w in term.get("forbidden") or [] if w)
    return list(dict.fromkeys(words))


def forbidden_pattern(words: list[str]) -> re.Pattern[str] | None:
    """Whole-word, case-insensitive match; ``set_ai_handling`` is not "AI handling"."""
    if not words:
        return None
    alternation = "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True))
    return re.compile(rf"(?<![\w-])(?:{alternation})(?![\w-])", re.IGNORECASE)


@lru_cache(maxsize=1)
def vocabulary_block() -> str:
    """One block for every agent: English and Dutch names, and the words to avoid."""
    data = glossary()
    terms = data.get("terms") or []
    if not terms:
        return ""
    lines = [
        VOCABULARY_HEADING,
        "Name things the way the screens do. English / Dutch, then words never to use:",
    ]
    for term in terms:
        en, nl = term.get("en") or "", term.get("nl") or ""
        if not en:
            continue
        line = f"- {en} / {nl}" if nl and nl != en else f"- {en}"
        avoid = [w for w in term.get("forbidden") or [] if w]
        if avoid:
            line += f"; never: {', '.join(avoid)}"
        lines.append(line)
    nl_words = [w for w in data.get("nl_forbidden_words") or [] if w]
    if nl_words:
        lines.append(f"In Dutch, never use these English words: {', '.join(nl_words)}.")
    lines.append(
        "Code names (Signal, Project, Workstream, ai_handling) stay out of what people read."
    )
    return "\n".join(lines)
