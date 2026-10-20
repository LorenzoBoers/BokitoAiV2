"""Platform skills: fixed agent skills that apply to every tenant.

A platform skill is a markdown file under ``app/data/platform_skills``. It
reaches an agent's system prompt when the agent holds one of the tools in its
frontmatter. Operators see that a skill exists (name and description) but
never its body; tenants cannot edit or read it.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

PLATFORM_SKILL_DIR = Path(__file__).resolve().parent.parent / "data" / "platform_skills"


@dataclass(frozen=True)
class PlatformSkill:
    slug: str
    name: dict[str, str]
    description: dict[str, str]
    tools: frozenset[str]
    body: str


def _parse(slug: str, text: str) -> PlatformSkill:
    meta: dict[str, str] = {}
    body = text
    if text.startswith("---"):
        head, _, rest = text[3:].partition("\n---")
        body = rest.lstrip("\n")
        for line in head.strip().splitlines():
            key, sep, value = line.partition(":")
            if sep:
                meta[key.strip()] = value.strip()
    name = meta.get("name") or slug.replace("_", " ").title()
    description = meta.get("description", "")
    tools = frozenset(t.strip() for t in meta.get("tools", "").split(",") if t.strip())
    return PlatformSkill(
        slug=slug,
        name={"en": name, "nl": meta.get("name_nl") or name},
        description={"en": description, "nl": meta.get("description_nl") or description},
        tools=tools,
        body=body.strip(),
    )


@lru_cache(maxsize=1)
def all_skills() -> tuple[PlatformSkill, ...]:
    if not PLATFORM_SKILL_DIR.is_dir():
        return ()
    skills = []
    for path in sorted(PLATFORM_SKILL_DIR.glob("*.md")):
        try:
            skills.append(_parse(path.stem, path.read_text(encoding="utf-8")))
        except OSError:
            continue
    return tuple(skills)


def platform_skills_for(tool_names: Iterable[str]) -> list[PlatformSkill]:
    names = set(tool_names)
    return [skill for skill in all_skills() if skill.tools & names]


def platform_skills_block(tools: Iterable[dict[str, Any]] | None) -> str:
    """Bodies of the platform skills that match the agent's tools."""
    names = [str(t.get("name") or "") for t in tools or [] if isinstance(t, dict)]
    return "\n\n".join(skill.body for skill in platform_skills_for(names) if skill.body)


def catalog(lang: str = "en") -> list[dict[str, Any]]:
    """What operators may see: name and description, never the body."""
    key = lang if lang in ("en", "nl") else "en"
    return [
        {
            "slug": skill.slug,
            "name": skill.name[key],
            "description": skill.description[key],
            "locked": True,
        }
        for skill in all_skills()
    ]
