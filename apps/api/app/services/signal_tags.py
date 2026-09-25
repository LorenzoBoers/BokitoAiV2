"""Compatibility helpers for labels stored in ``Signal.tags_json``.

The standalone tag catalog API and management UI are retired. Existing labels
remain normalized and registered only so migrated rules and agent tools do not
write unbounded free-form values.
"""

from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import SignalTag

MAX_TAG_LEN = 40
MAX_TAGS_PER_THREAD = 20
# Vocabulary size handed to the LLM for triage / agent tagging.
AI_CATALOG_LIMIT = 30


def normalize_tag(raw: str) -> str:
    """Canonical tag name: trimmed, collapsed whitespace, lower case."""
    if not isinstance(raw, str):
        return ""
    return " ".join(raw.split()).strip().lower()[:MAX_TAG_LEN]


def normalize_tags(values: Iterable[Any] | None) -> list[str]:
    """Normalize a thread's tag list: dedupe, drop blanks, keep order."""
    out: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        name = normalize_tag(value if isinstance(value, str) else "")
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
        if len(out) >= MAX_TAGS_PER_THREAD:
            break
    return out


async def registry_rows(session: AsyncSession, tenant_id: UUID) -> list[SignalTag]:
    result = await session.execute(
        select(SignalTag).where(SignalTag.tenant_id == tenant_id).order_by(SignalTag.name)
    )
    return list(result.scalars().all())


async def _registry_by_name(session: AsyncSession, tenant_id: UUID) -> dict[str, SignalTag]:
    return {row.name: row for row in await registry_rows(session, tenant_id)}


async def ensure_tags(
    session: AsyncSession,
    tenant_id: UUID,
    names: Iterable[str],
    *,
    user_id: UUID | None = None,
) -> list[str]:
    """Register tag names that are new to this tenant. Returns the added names.

    Caller owns the transaction: rows are flushed, never committed here.
    """
    wanted = normalize_tags(names)
    if not wanted:
        return []
    known = set((await _registry_by_name(session, tenant_id)).keys())
    added: list[str] = []
    for name in wanted:
        if name in known:
            continue
        session.add(
            SignalTag(tenant_id=tenant_id, name=name, created_by_user_id=user_id)
        )
        known.add(name)
        added.append(name)
    if added:
        await session.flush()
    return added


async def allowed_tag_names(
    session: AsyncSession, tenant_id: UUID, *, limit: int | None = None
) -> list[str]:
    """Vocabulary AI triage and agent tools may apply."""
    names = [row.name for row in await registry_rows(session, tenant_id)]
    return names[:limit] if limit else names


async def ai_catalog_lines(
    session: AsyncSession, tenant_id: UUID, *, limit: int = AI_CATALOG_LIMIT
) -> list[str]:
    """`name - when to use it` lines for the triage prompt."""
    lines: list[str] = []
    for row in (await registry_rows(session, tenant_id))[:limit]:
        description = (row.description or "").strip()
        lines.append(f"{row.name} - {description}" if description else row.name)
    return lines
