"""What an agent may register as a new label.

A label is one reusable dimension. The check refuses names that duplicate an
existing label, glue a label or a company onto another word, or point at one
item (numbers, dates, months). Operators creating labels by hand are not
checked; agents are, in create_tag, update_tag and the label plan.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Company
from app.models.signal import SignalTag
from app.services.signal_tags import normalize_tag

MIN_DESCRIPTION = 8
_DIGITS_RE = re.compile(r"\d{2,}")
_MONTHS = frozenset(
    "jan feb mar apr may jun jul aug sep sept oct nov dec "
    "january february march april june july august september october november december "
    "maandag dinsdag woensdag donderdag vrijdag monday tuesday wednesday thursday friday "
    "januari februari maart mei juni juli augustus oktober "
    "q1 q2 q3 q4".split()
)
_DOUBLE_VOWEL_RE = re.compile(r"(aa|ee|oo|uu)")
_SUFFIXES = ("ingen", "ing", "en", "es", "s", "e")


def stem(name: str) -> str:
    """Rough EN/NL stem so `factuur`, `facturen` and `Facturen` meet."""
    text = _DOUBLE_VOWEL_RE.sub(lambda m: m.group(0)[0], name.replace("_", ""))
    for suffix in _SUFFIXES:
        if len(text) > len(suffix) + 3 and text.endswith(suffix):
            return text[: -len(suffix)]
    return text


def _company_keys(rows: list[tuple[str, str]]) -> dict[str, str]:
    """Normalized company name or domain root -> label-style company key."""
    keys: dict[str, str] = {}
    for name, domain in rows:
        root = (domain or "").lower().removeprefix("www.").split(".")[0]
        normalized = normalize_tag(name or "")
        first = normalized.split("_")[0] if normalized else ""
        key = root or first or normalized
        for candidate in (root, normalized, first):
            if candidate and len(candidate) >= 3:
                keys.setdefault(candidate, key)
    return keys


def _refuse(error: str, message: str, use: list[str] | None = None) -> dict[str, Any]:
    return {"error": error, "message": message, "use": use or []}


async def check_new_label(
    session: AsyncSession,
    tenant_id: UUID,
    name: str,
    description: str = "",
    *,
    renaming: str = "",
) -> dict[str, Any] | None:
    """``None`` when ``name`` may be registered; otherwise a refusal with ``use`` hints.

    ``renaming`` is the current name of a label being renamed; it does not
    count as a duplicate of itself.
    """
    label = normalize_tag(name)
    if not label:
        return _refuse("missing_name", "Pass a label name without #.")
    names = [
        tag_name
        for tag_name in (
            await session.execute(select(SignalTag.name).where(SignalTag.tenant_id == tenant_id))
        ).scalars()
        if tag_name != renaming
    ]
    if label in names:
        return None

    tokens = label.split("_")
    if _DIGITS_RE.search(label) or any(t in _MONTHS for t in tokens):
        return _refuse(
            "item_specific",
            "A label groups many conversations; numbers, dates and months point at one item. "
            "Leave them out.",
        )

    by_stem = {stem(existing): existing for existing in names}
    twin = by_stem.get(stem(label))
    if twin:
        return _refuse(
            "near_duplicate",
            f"{twin} already covers this. Use it, or merge the spare label into {twin}.",
            [twin],
        )

    if len(tokens) > 1:
        companies = _company_keys(
            [
                (row[0], row[1])
                for row in (
                    await session.execute(
                        select(Company.name, Company.domain)
                        .where(Company.tenant_id == tenant_id, Company.deleted_at.is_(None))
                        .limit(5000)
                    )
                ).all()
            ]
        )
        for size in range(len(tokens) - 1, 0, -1):
            for start in range(0, len(tokens) - size + 1):
                part = "_".join(tokens[start : start + size])
                rest = "_".join(tokens[:start] + tokens[start + size :])
                if not rest:
                    continue
                existing = by_stem.get(stem(part))
                company = companies.get(part)
                if existing or company:
                    hint = [existing] if existing else []
                    rest_twin = by_stem.get(stem(rest))
                    hint.append(rest_twin or rest)
                    who = (
                        f"{existing} is already a label"
                        if existing
                        else f"{part} is a company, so its label goes on the company"
                    )
                    return _refuse(
                        "combines_labels",
                        f"One label is one idea: {who}. Use separate labels.",
                        hint,
                    )

    if len((description or "").strip()) < MIN_DESCRIPTION:
        return _refuse(
            "missing_description",
            "Add a description that says when to apply this label.",
        )
    return None
