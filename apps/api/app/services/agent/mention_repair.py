"""Repair the mention chips an agent writes before its speech is stored.

Models sometimes wrap a chip in brackets (``[@[Name](agent:x)]``), invent an
id (``agent:support_agent``) or repeat the name in bold before the chip. The
dashboard then shows raw markup instead of a chip.
"""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

_CHIP_RE = re.compile(r"(\[)?@\[([^\]\n]+)\]\((user|agent|team):([^)\s]+)\)(?(1)\])")
_BOLD_BEFORE_CHIP_RE = re.compile(r"\*\*([^*\n]+)\*\*\s*(@\[\1\]\()")


def _key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


async def repair_mentions(session: AsyncSession, tenant_id: UUID, text: str) -> str:
    if not text or "@[" not in text:
        return text
    from app.models.agent import Agent
    from app.models.team import Team

    directory: dict[str, dict[str, str]] | None = None

    async def load() -> dict[str, dict[str, str]]:
        agents = (
            await session.execute(select(Agent).where(Agent.tenant_id == tenant_id))
        ).scalars().all()
        teams = (
            await session.execute(select(Team).where(Team.tenant_id == tenant_id))
        ).scalars().all()
        out: dict[str, dict[str, str]] = {"agent": {}, "team": {}}
        for agent in agents:
            for alias in (agent.name, getattr(agent, "slug", None), str(agent.id)):
                if alias:
                    out["agent"].setdefault(_key(alias), f"@[{agent.name}](agent:{agent.id})")
        for team in teams:
            for alias in (team.name, str(team.id)):
                out["team"].setdefault(_key(alias), f"@[{team.name}](team:{team.id})")
        return out

    pieces: list[str] = []
    last = 0
    for match in _CHIP_RE.finditer(text):
        name, kind, ref = match.group(2), match.group(3), match.group(4)
        if kind == "user":
            chip = f"@[{name}](user:{ref})" if ref.isdigit() else name
        else:
            if directory is None:
                directory = await load()
            known = directory[kind]
            chip = known.get(_key(ref)) or known.get(_key(name)) or name
        pieces.append(text[last : match.start()])
        pieces.append(chip)
        last = match.end()
    pieces.append(text[last:])
    return _BOLD_BEFORE_CHIP_RE.sub(r"\2", "".join(pieces))
