"""Conversation tags: free labels from the tenant registry, linked per conversation.

Tags carry no follow-up logic; they are for finding and grouping. The
conversation's category is not a tag: clients show it as the first, locked
chip in the tag row. Operators may tag with a new name (it is registered on
the spot); agents and inbox rules only apply names the registry already has.
"""

from collections.abc import Iterable
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import SignalTag, SignalTagLink

MAX_TAG_LEN = 40
MAX_TAGS_PER_THREAD = 20
# Vocabulary size handed to the LLM for agent tagging.
AI_CATALOG_LIMIT = 30


def normalize_tag(raw: str) -> str:
    """Canonical tag name: trimmed, collapsed whitespace, lower case."""
    if not isinstance(raw, str):
        return ""
    return " ".join(raw.split()).strip().lower()[:MAX_TAG_LEN]


def normalize_tags(values: Iterable[Any] | None) -> list[str]:
    """Normalize a conversation's tag list: dedupe, drop blanks, keep order."""
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
) -> dict[str, SignalTag]:
    """Registry rows for ``names``, creating the ones that are new. Flushes, never commits."""
    wanted = normalize_tags(names)
    known = await _registry_by_name(session, tenant_id)
    created = False
    for name in wanted:
        if name not in known:
            row = SignalTag(tenant_id=tenant_id, name=name, created_by_user_id=user_id)
            session.add(row)
            known[name] = row
            created = True
    if created:
        await session.flush()
    return {name: known[name] for name in wanted}


async def allowed_tag_names(
    session: AsyncSession, tenant_id: UUID, *, limit: int | None = None
) -> list[str]:
    """Vocabulary agents and inbox rules may apply."""
    names = [row.name for row in await registry_rows(session, tenant_id)]
    return names[:limit] if limit else names


async def ai_catalog_lines(
    session: AsyncSession, tenant_id: UUID, *, limit: int = AI_CATALOG_LIMIT
) -> list[str]:
    """`name - when to use it` lines for an agent prompt."""
    lines: list[str] = []
    for row in (await registry_rows(session, tenant_id))[:limit]:
        description = (row.description or "").strip()
        lines.append(f"{row.name} - {description}" if description else row.name)
    return lines


async def tags_by_signal(
    session: AsyncSession, signal_ids: Iterable[UUID]
) -> dict[UUID, list[str]]:
    """Tag names per conversation, alphabetical, in one query."""
    ids = list(signal_ids)
    out: dict[UUID, list[str]] = {sid: [] for sid in ids}
    if not ids:
        return out
    rows = await session.execute(
        select(SignalTagLink.signal_id, SignalTag.name)
        .join(SignalTag, SignalTag.id == SignalTagLink.tag_id)
        .where(SignalTagLink.signal_id.in_(ids))
        .order_by(SignalTag.name)
    )
    for signal_id, name in rows.all():
        out.setdefault(signal_id, []).append(name)
    return out


async def signal_tag_names(session: AsyncSession, signal_id: UUID) -> list[str]:
    return (await tags_by_signal(session, [signal_id]))[signal_id]


async def set_signal_tags(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    names: Iterable[Any],
    *,
    user_id: UUID | None = None,
) -> list[str]:
    """Replace a conversation's tags (registering new names). Flushes, never commits."""
    rows = await ensure_tags(session, tenant_id, normalize_tags(names), user_id=user_id)
    await session.execute(delete(SignalTagLink).where(SignalTagLink.signal_id == signal_id))
    for row in rows.values():
        session.add(SignalTagLink(signal_id=signal_id, tag_id=row.id, tenant_id=tenant_id))
    await session.flush()
    return sorted(rows)


async def add_signal_tags(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    names: Iterable[Any],
    *,
    registered_only: bool = False,
) -> tuple[list[str], list[str]]:
    """Add tags without removing any. Returns ``(all tags, newly added)``.

    ``registered_only`` skips names the registry does not have (agents and
    rules); otherwise new names are registered. Flushes, never commits.
    """
    current = await signal_tag_names(session, signal_id)
    wanted = [n for n in normalize_tags(names) if n not in current]
    if registered_only:
        known = await _registry_by_name(session, tenant_id)
        rows = {n: known[n] for n in wanted if n in known}
    else:
        rows = await ensure_tags(session, tenant_id, wanted)
    room = max(0, MAX_TAGS_PER_THREAD - len(current))
    added = list(rows)[:room]
    for name in added:
        session.add(SignalTagLink(signal_id=signal_id, tag_id=rows[name].id, tenant_id=tenant_id))
    if added:
        await session.flush()
    return sorted([*current, *added]), added


async def registry_with_counts(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    counts = dict(
        (
            await session.execute(
                select(SignalTagLink.tag_id, func.count())
                .where(SignalTagLink.tenant_id == tenant_id)
                .group_by(SignalTagLink.tag_id)
            )
        ).all()
    )
    return [serialize_tag(row, counts.get(row.id, 0)) for row in await registry_rows(session, tenant_id)]


def serialize_tag(row: SignalTag, count: int = 0) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "description": row.description or "",
        "count": count,
    }


async def _tag_row(session: AsyncSession, tenant_id: UUID, tag_id: UUID) -> SignalTag:
    row = await session.get(SignalTag, tag_id)
    if row is None or row.tenant_id != tenant_id:
        raise LookupError("Tag not found")
    return row


async def create_tag(
    session: AsyncSession,
    tenant_id: UUID,
    name: str,
    *,
    description: str = "",
    user_id: UUID | None = None,
) -> SignalTag:
    clean = normalize_tag(name)
    if not clean:
        raise ValueError("Name is required")
    row = (await ensure_tags(session, tenant_id, [clean], user_id=user_id))[clean]
    if description:
        row.description = description.strip()[:300]
        row.updated_at = datetime.utcnow()
    await session.commit()
    return row


async def update_tag(
    session: AsyncSession,
    tenant_id: UUID,
    tag_id: UUID,
    *,
    name: str | None = None,
    description: str | None = None,
) -> SignalTag:
    """Rename or describe a tag. Renaming onto an existing name merges the two."""
    row = await _tag_row(session, tenant_id, tag_id)
    if name is not None:
        clean = normalize_tag(name)
        if not clean:
            raise ValueError("Name is required")
        other = (await _registry_by_name(session, tenant_id)).get(clean)
        if other is not None and other.id != row.id:
            await _merge_into(session, row, other)
            row = other
        else:
            row.name = clean
    if description is not None:
        row.description = description.strip()[:300]
    row.updated_at = datetime.utcnow()
    await session.commit()
    return row


async def _merge_into(session: AsyncSession, source: SignalTag, target: SignalTag) -> None:
    tagged = set(
        (
            await session.execute(
                select(SignalTagLink.signal_id).where(SignalTagLink.tag_id == target.id)
            )
        ).scalars()
    )
    links = (
        await session.execute(select(SignalTagLink).where(SignalTagLink.tag_id == source.id))
    ).scalars()
    for link in list(links):
        if link.signal_id not in tagged:
            session.add(
                SignalTagLink(signal_id=link.signal_id, tag_id=target.id, tenant_id=target.tenant_id)
            )
        await session.delete(link)
    await session.flush()
    await session.delete(source)


async def delete_tag(session: AsyncSession, tenant_id: UUID, tag_id: UUID) -> None:
    """Remove a tag from the registry and from every conversation."""
    row = await _tag_row(session, tenant_id, tag_id)
    await session.execute(delete(SignalTagLink).where(SignalTagLink.tag_id == row.id))
    await session.delete(row)
    await session.commit()


def signals_tagged(tenant_id: UUID, name: str):
    """Subquery of conversation ids carrying tag ``name``."""
    return (
        select(SignalTagLink.signal_id)
        .join(SignalTag, SignalTag.id == SignalTagLink.tag_id)
        .where(SignalTag.tenant_id == tenant_id, SignalTag.name == normalize_tag(name))
    )
