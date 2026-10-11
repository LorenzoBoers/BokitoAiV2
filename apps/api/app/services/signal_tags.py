"""Hashtags: the workspace vocabulary for finding and grouping conversations.

A free tag is a label linked per conversation (`SignalTagLink`). A tag with a
playbook is a *category*: it is filed on a conversation as its ticket
(`Signal.ticket_tag_id`, see `services.tickets`), never linked as a free tag.
Operators may tag with a new name (it is registered on the spot); agents and
inbox rules only apply names the registry already has.
"""

import re
from collections.abc import Iterable
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal, SignalTag, SignalTagLink

MAX_TAG_LEN = 40
MAX_TAGS_PER_THREAD = 20
# Vocabulary size handed to the LLM for agent tagging.
AI_CATALOG_LIMIT = 30
_SEPARATOR_RE = re.compile(r"[^\w]+", re.UNICODE)


def normalize_tag(raw: str) -> str:
    """Canonical hashtag: no leading ``#``, lower case, words joined by hyphens."""
    if not isinstance(raw, str):
        return ""
    text = _SEPARATOR_RE.sub("-", raw.strip().lstrip("#").lower().replace("_", "-"))
    return text.strip("-")[:MAX_TAG_LEN].strip("-")


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
    """Free-tag rows for ``names``, creating new ones. Categories are skipped. Flushes."""
    wanted = normalize_tags(names)
    known = await _registry_by_name(session, tenant_id)
    created = False
    out: dict[str, SignalTag] = {}
    for name in wanted:
        row = known.get(name)
        if row is None:
            row = SignalTag(tenant_id=tenant_id, name=name, created_by_user_id=user_id)
            session.add(row)
            known[name] = row
            created = True
        if row.workstream_id is None:
            out[name] = row
    if created:
        await session.flush()
    return out


async def allowed_tag_names(
    session: AsyncSession, tenant_id: UUID, *, limit: int | None = None
) -> list[str]:
    """Free-tag vocabulary agents and inbox rules may apply."""
    names = [row.name for row in await registry_rows(session, tenant_id) if row.workstream_id is None]
    return names[:limit] if limit else names


def ai_catalog_lines_from_rows(
    rows: list[SignalTag], *, limit: int = AI_CATALOG_LIMIT
) -> list[str]:
    """`name - when to use it` lines from already-loaded registry rows."""
    lines: list[str] = []
    free = [
        row for row in rows if row.workstream_id is None and bool(row.ai_auto_tag)
    ]
    for row in free[:limit]:
        description = (row.description or "").strip()
        lines.append(f"{row.name} - {description}" if description else row.name)
    return lines


async def ai_catalog_lines(
    session: AsyncSession, tenant_id: UUID, *, limit: int = AI_CATALOG_LIMIT
) -> list[str]:
    """`name - when to use it` lines for an agent prompt (free tags only)."""
    return ai_catalog_lines_from_rows(
        await registry_rows(session, tenant_id), limit=limit
    )


async def tags_by_signal(
    session: AsyncSession, signal_ids: Iterable[UUID]
) -> dict[UUID, list[str]]:
    """Free-tag names per conversation, alphabetical, in one query.

    A link to the conversation's own category (kept from before a promote) is
    left out: the ticket chip already shows it.
    """
    ids = list(signal_ids)
    out: dict[UUID, list[str]] = {sid: [] for sid in ids}
    if not ids:
        return out
    rows = await session.execute(
        select(SignalTagLink.signal_id, SignalTag.name)
        .join(SignalTag, SignalTag.id == SignalTagLink.tag_id)
        .join(Signal, Signal.id == SignalTagLink.signal_id)
        .where(
            SignalTagLink.signal_id.in_(ids),
            or_(Signal.ticket_tag_id.is_(None), Signal.ticket_tag_id != SignalTagLink.tag_id),
        )
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
    """Replace a conversation's free tags (registering new names). Flushes, never commits."""
    rows = await ensure_tags(session, tenant_id, normalize_tags(names), user_id=user_id)
    category_ids = select(SignalTag.id).where(
        SignalTag.tenant_id == tenant_id, SignalTag.workstream_id.is_not(None)
    )
    await session.execute(
        delete(SignalTagLink).where(
            SignalTagLink.signal_id == signal_id, SignalTagLink.tag_id.not_in(category_ids)
        )
    )
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
    """Add free tags without removing any. Returns ``(all tags, newly added)``.

    ``registered_only`` skips names the registry does not have (agents and
    rules); otherwise new names are registered. Flushes, never commits.
    """
    current = await signal_tag_names(session, signal_id)
    wanted = [n for n in normalize_tags(names) if n not in current]
    if registered_only:
        known = await _registry_by_name(session, tenant_id)
        rows = {n: known[n] for n in wanted if n in known and known[n].workstream_id is None}
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
    from app.models.orchestra import Workstream

    counts = dict(
        (
            await session.execute(
                select(SignalTagLink.tag_id, func.count())
                .where(SignalTagLink.tenant_id == tenant_id)
                .group_by(SignalTagLink.tag_id)
            )
        ).all()
    )
    ticket_counts = dict(
        (
            await session.execute(
                select(Signal.ticket_tag_id, func.count())
                .where(
                    Signal.tenant_id == tenant_id,
                    Signal.ticket_tag_id.is_not(None),
                    Signal.deleted_at.is_(None),
                )
                .group_by(Signal.ticket_tag_id)
            )
        ).all()
    )
    names = dict(
        (await session.execute(select(Workstream.id, Workstream.name).where(Workstream.tenant_id == tenant_id))).all()
    )
    out = []
    for row in await registry_rows(session, tenant_id):
        item = serialize_tag(row, counts.get(row.id, 0) + ticket_counts.get(row.id, 0))
        item["workstream_name"] = names.get(row.workstream_id) if row.workstream_id else None
        out.append(item)
    return out


def serialize_tag(row: SignalTag, count: int = 0) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "description": row.description or "",
        "count": count,
        "is_category": row.workstream_id is not None,
        "workstream_id": str(row.workstream_id) if row.workstream_id else None,
        "pinned": bool(row.pinned),
        "show_in_nav": bool(row.show_in_nav),
        "ai_auto_tag": bool(row.ai_auto_tag),
        "send_mode": row.send_mode or "send",
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
    pinned: bool = False,
    user_id: UUID | None = None,
    commit: bool = True,
) -> SignalTag:
    clean = normalize_tag(name)
    if not clean:
        raise ValueError("Name is required")
    row = (await _registry_by_name(session, tenant_id)).get(clean)
    if row is None:
        row = SignalTag(tenant_id=tenant_id, name=clean, created_by_user_id=user_id)
        session.add(row)
    if description:
        row.description = description.strip()[:300]
    if pinned:
        row.pinned = True
    row.updated_at = datetime.utcnow()
    if commit:
        await session.commit()
    else:
        await session.flush()
    return row


async def update_tag(
    session: AsyncSession,
    tenant_id: UUID,
    tag_id: UUID,
    *,
    name: str | None = None,
    description: str | None = None,
    pinned: bool | None = None,
    show_in_nav: bool | None = None,
    ai_auto_tag: bool | None = None,
    commit: bool = True,
) -> SignalTag:
    """Rename, describe or place a tag. Renaming onto an existing free tag merges the two."""
    row = await _tag_row(session, tenant_id, tag_id)
    if name is not None:
        clean = normalize_tag(name)
        if not clean:
            raise ValueError("Name is required")
        other = (await _registry_by_name(session, tenant_id)).get(clean)
        if other is not None and other.id != row.id:
            if row.workstream_id is not None or other.workstream_id is not None:
                raise ValueError(f"#{clean} is already in use; pick another name")
            await _merge_into(session, row, other)
            row = other
        else:
            row.name = clean
            if row.workstream_id is not None:
                from app.models.orchestra import Workstream

                ws = await session.get(Workstream, row.workstream_id)
                if ws is not None and ws.tenant_id == tenant_id and ws.deleted_at is None:
                    ws.name = clean[:120]
                    ws.updated_at = datetime.utcnow()
                    session.add(ws)
    if description is not None:
        row.description = description.strip()[:300]
    if pinned is not None:
        row.pinned = bool(pinned)
    if show_in_nav is not None:
        row.show_in_nav = bool(show_in_nav)
    if ai_auto_tag is not None:
        row.ai_auto_tag = bool(ai_auto_tag)
    row.updated_at = datetime.utcnow()
    if commit:
        await session.commit()
    else:
        await session.flush()
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


async def delete_tag(session: AsyncSession, tenant_id: UUID, tag_id: UUID, *, commit: bool = True) -> None:
    """Remove a tag from the registry and every conversation. A category's
    tickets lose their category."""
    row = await _tag_row(session, tenant_id, tag_id)
    await session.execute(delete(SignalTagLink).where(SignalTagLink.tag_id == row.id))
    await session.execute(
        update(Signal)
        .where(Signal.tenant_id == tenant_id, Signal.ticket_tag_id == row.id)
        .values(ticket_tag_id=None, ticket_status="", stage_key="", ticket_certainty=None)
    )
    await session.delete(row)
    if commit:
        await session.commit()
    else:
        await session.flush()


async def set_tag_playbook(
    session: AsyncSession,
    tenant_id: UUID,
    tag_id: UUID,
    *,
    workstream_id: UUID | None,
    commit: bool = True,
) -> SignalTag:
    """Attach (or detach) the tag's playbook. Detaching unfiles its tickets."""
    from app.models.orchestra import Workstream

    row = await _tag_row(session, tenant_id, tag_id)
    if workstream_id is not None:
        ws = await session.get(Workstream, workstream_id)
        if ws is None or ws.tenant_id != tenant_id or ws.deleted_at is not None:
            raise LookupError("Playbook not found")
        row.workstream_id = ws.id
    elif row.workstream_id is not None:
        await session.execute(
            update(Signal)
            .where(Signal.tenant_id == tenant_id, Signal.ticket_tag_id == row.id)
            .values(ticket_tag_id=None, ticket_status="", stage_key="", ticket_certainty=None)
        )
        row.workstream_id = None
        row.show_in_nav = False
    row.updated_at = datetime.utcnow()
    session.add(row)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return row


async def promote_tag(
    session: AsyncSession,
    tenant_id: UUID,
    tag_id: UUID,
    *,
    workstream_id: UUID | None = None,
    playbook_name: str = "",
    user_id: UUID | None = None,
) -> SignalTag:
    """Make a free tag a category: attach an existing playbook or create one
    with the default pipeline. Existing links stay; threads are not rewritten."""
    from app.models.orchestra import Workstream

    row = await _tag_row(session, tenant_id, tag_id)
    if workstream_id is None:
        # Flow title follows the action-tag hashtag (no independent display name).
        ws = Workstream(
            tenant_id=tenant_id,
            name=(playbook_name.strip() or row.name)[:120],
            description=row.description or "",
        )
        session.add(ws)
        await session.flush()
        workstream_id = ws.id
    await set_tag_playbook(session, tenant_id, row.id, workstream_id=workstream_id, commit=False)
    row.show_in_nav = True
    row.pinned = False
    row.updated_at = datetime.utcnow()
    session.add(row)
    # Keep the flow title in sync with the primary action tag.
    ws = await session.get(Workstream, workstream_id)
    if ws is not None and ws.tenant_id == tenant_id:
        ws.name = row.name[:120]
        ws.updated_at = datetime.utcnow()
        session.add(ws)
    await session.commit()
    return row


def signals_tagged(tenant_id: UUID, name: str):
    """Subquery of conversation ids carrying hashtag ``name`` (link or ticket)."""
    clean = normalize_tag(name)
    linked = (
        select(SignalTagLink.signal_id)
        .join(SignalTag, SignalTag.id == SignalTagLink.tag_id)
        .where(SignalTag.tenant_id == tenant_id, SignalTag.name == clean)
    )
    filed = (
        select(Signal.id)
        .join(SignalTag, SignalTag.id == Signal.ticket_tag_id)
        .where(SignalTag.tenant_id == tenant_id, SignalTag.name == clean)
    )
    return linked.union(filed)
