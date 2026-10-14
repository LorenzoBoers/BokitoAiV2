"""Hashtags: the workspace vocabulary for finding and grouping conversations.

A free tag is a label linked per conversation (`SignalTagLink`). A tag with a
playbook is a *category*: it is filed on a conversation as its ticket
(`Signal.ticket_tag_id`, see `services.tickets`), never linked as a free tag.
A tag a folder carries places conversations (`services.folders`); every tag
write here ends in `refile` so the cached folder follows the tags.
Operators may tag with a new name (it is registered on the spot); agents and
inbox rules only apply names the registry already has. Tags in an exclusive
group replace each other on a conversation.
"""

import re
from collections.abc import Iterable
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Contact
from app.models.signal import CompanyTagLink, ContactTagLink, Signal, SignalTag, SignalTagLink, TagGroup

MAX_TAG_LEN = 40
MAX_TAGS_PER_THREAD = 20
# Vocabulary size handed to the LLM for agent tagging.
AI_CATALOG_LIMIT = 30
_SEPARATOR_RE = re.compile(r"[^\w]+", re.UNICODE)


def normalize_tag(raw: str) -> str:
    """Canonical hashtag: no leading ``#``, lower case, words joined by underscores."""
    if not isinstance(raw, str):
        return ""
    text = raw.strip().lstrip("#").lower().replace("-", "_")
    text = _SEPARATOR_RE.sub("_", text)
    text = re.sub(r"_+", "_", text)
    return text.strip("_")[:MAX_TAG_LEN].strip("_")


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
    """Free-tag lines for an agent prompt, grouped with folder paths when known."""
    lines: list[str] = []
    for row in await registry_with_counts(session, tenant_id):
        if row.get("is_category") or not row.get("ai_auto_tag"):
            continue
        name = str(row.get("name") or "")
        group = str(row.get("group_name") or "").strip()
        paths = [
            str(folder.get("path") or "")
            for folder in row.get("folders") or []
            if isinstance(folder, dict) and folder.get("path")
        ]
        desc = str(row.get("description") or "").strip()
        label = f"{group}: #{name}" if group else name
        if paths:
            label = f"{label} → {paths[0]}"
        lines.append(f"{label} - {desc}" if desc else label)
        if len(lines) >= limit:
            break
    return lines


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


async def _exclusive_groups(session: AsyncSession, tenant_id: UUID) -> set[UUID]:
    rows = await session.execute(
        select(TagGroup.id).where(TagGroup.tenant_id == tenant_id, TagGroup.exclusive.is_(True))
    )
    return set(rows.scalars())


async def _signal_row(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> Signal | None:
    signal = await session.get(Signal, signal_id)
    return signal if signal is not None and signal.tenant_id == tenant_id else None


async def _current_tag_rows(session: AsyncSession, signal_id: UUID) -> dict[UUID, SignalTag]:
    rows = await session.execute(
        select(SignalTag).join(SignalTagLink, SignalTagLink.tag_id == SignalTag.id).where(SignalTagLink.signal_id == signal_id)
    )
    return {row.id: row for row in rows.scalars()}


def _dedupe_exclusive(rows: list[SignalTag], exclusive: set[UUID]) -> list[SignalTag]:
    """Within one request the last tag of an exclusive group wins."""
    winner: dict[UUID, UUID] = {}
    for row in rows:
        if row.group_id in exclusive:
            winner[row.group_id] = row.id
    return [row for row in rows if row.group_id not in exclusive or winner[row.group_id] == row.id]


async def _after_tag_change(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID, *, actor_type: str, actor_id: str
) -> None:
    from app.services.folders import refile

    signal = await _signal_row(session, tenant_id, signal_id)
    if signal is not None:
        await refile(session, signal, actor_type=actor_type, actor_id=actor_id)


async def set_signal_tags(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    names: Iterable[Any],
    *,
    user_id: UUID | None = None,
) -> list[str]:
    """Replace a conversation's free tags (registering new names). Flushes, never commits.

    The operator's list is authoritative: of two tags from one exclusive
    group the last one stays. The folder is refiled afterwards.
    """
    rows = await ensure_tags(session, tenant_id, normalize_tags(names), user_id=user_id)
    exclusive = await _exclusive_groups(session, tenant_id)
    kept = _dedupe_exclusive(list(rows.values()), exclusive)
    category_ids = select(SignalTag.id).where(
        SignalTag.tenant_id == tenant_id, SignalTag.workstream_id.is_not(None)
    )
    await session.execute(
        delete(SignalTagLink).where(
            SignalTagLink.signal_id == signal_id, SignalTagLink.tag_id.not_in(category_ids)
        )
    )
    for row in kept:
        session.add(SignalTagLink(signal_id=signal_id, tag_id=row.id, tenant_id=tenant_id))
    await session.flush()
    await _after_tag_change(session, tenant_id, signal_id, actor_type="user", actor_id=str(user_id or ""))
    return sorted(row.name for row in kept)


async def add_signal_tags(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    names: Iterable[Any],
    *,
    registered_only: bool = False,
    user_id: UUID | None = None,
    actor_type: str = "user",
    actor_id: str = "",
) -> tuple[list[str], list[str]]:
    """Add free tags without removing any. Returns ``(all tags, newly added)``.

    ``registered_only`` skips names the registry does not have (agents and
    rules); otherwise new names are registered. A person's new tag replaces
    the conversation's tag from the same exclusive group; an agent or rule
    skips it (``skipped_exclusive`` on the result of `add_signal_tag_rows`).
    Flushes, never commits.
    """
    current = await signal_tag_names(session, signal_id)
    wanted = [n for n in normalize_tags(names) if n not in current]
    if registered_only:
        known = await _registry_by_name(session, tenant_id)
        rows = {n: known[n] for n in wanted if n in known and known[n].workstream_id is None}
    else:
        rows = await ensure_tags(session, tenant_id, wanted, user_id=user_id)
    result = await add_signal_tag_rows(
        session,
        tenant_id,
        signal_id,
        list(rows.values()),
        replace_exclusive=not registered_only,
        actor_type=actor_type,
        actor_id=actor_id or str(user_id or ""),
    )
    return result["tags"], result["added"]


async def add_signal_tag_rows(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    rows: list[SignalTag],
    *,
    replace_exclusive: bool,
    actor_type: str = "user",
    actor_id: str = "",
) -> dict[str, Any]:
    """Link tag rows to a conversation; the exclusive-group rule decides what
    happens to a competing tag already there (or inherited from the contact).

    Returns ``{"tags": all names, "added": names, "replaced": names, "skipped_exclusive": [{tag, conflicts_with}]}``.
    """
    from app.services.folders import contact_tag_ids

    exclusive = await _exclusive_groups(session, tenant_id)
    current = await _current_tag_rows(session, signal_id)
    signal = await _signal_row(session, tenant_id, signal_id)
    inherited_ids = await contact_tag_ids(session, signal.contact_id) if signal is not None else set()
    inherited = {
        row.id: row
        for row in (
            (await session.execute(select(SignalTag).where(SignalTag.id.in_(list(inherited_ids))))).scalars()
            if inherited_ids
            else []
        )
    }
    ticket_row = await session.get(SignalTag, signal.ticket_tag_id) if signal is not None and signal.ticket_tag_id else None
    candidates = _dedupe_exclusive([r for r in rows if r.id not in current], exclusive)
    added: list[SignalTag] = []
    replaced: list[str] = []
    skipped: list[dict[str, str]] = []
    for row in candidates:
        if row.group_id in exclusive:
            competing_links = [c for c in current.values() if c.group_id == row.group_id and c.id != row.id]
            competing_fixed = [c for c in inherited.values() if c.group_id == row.group_id and c.id != row.id]
            if ticket_row is not None and ticket_row.group_id == row.group_id and ticket_row.id != row.id:
                competing_fixed.append(ticket_row)
            if competing_fixed:
                # Contact and action tags are not ours to replace from here.
                skipped.append({"tag": row.name, "conflicts_with": competing_fixed[0].name})
                continue
            if competing_links:
                if not replace_exclusive:
                    skipped.append({"tag": row.name, "conflicts_with": competing_links[0].name})
                    continue
                for old in competing_links:
                    await session.execute(
                        delete(SignalTagLink).where(SignalTagLink.signal_id == signal_id, SignalTagLink.tag_id == old.id)
                    )
                    current.pop(old.id, None)
                    replaced.append(old.name)
        if len(current) >= MAX_TAGS_PER_THREAD:
            break
        session.add(SignalTagLink(signal_id=signal_id, tag_id=row.id, tenant_id=tenant_id))
        current[row.id] = row
        added.append(row)
    if added or replaced:
        await session.flush()
        await _after_tag_change(session, tenant_id, signal_id, actor_type=actor_type, actor_id=actor_id)
    return {
        "tags": sorted(await signal_tag_names(session, signal_id)),
        "added": [row.name for row in added],
        "replaced": replaced,
        "skipped_exclusive": skipped,
    }


async def add_signal_tag_ids(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    tag_ids: Iterable[UUID],
    *,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    """Link tags by id (filing in a folder). Action tags are skipped: they are filed, not linked."""
    ids = [t for t in dict.fromkeys(tag_ids)]
    if not ids:
        return {"tags": await signal_tag_names(session, signal_id), "added": [], "replaced": [], "skipped_exclusive": []}
    rows = list(
        (
            await session.execute(
                select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.id.in_(ids))
            )
        ).scalars()
    )
    by_id = {row.id: row for row in rows}
    ordered = [by_id[i] for i in ids if i in by_id and by_id[i].workstream_id is None]
    return await add_signal_tag_rows(
        session, tenant_id, signal_id, ordered, replace_exclusive=True, actor_type="user", actor_id=str(user_id or "")
    )


async def remove_signal_tag_ids(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID, tag_ids: Iterable[UUID], *, user_id: UUID | None = None
) -> None:
    ids = [t for t in dict.fromkeys(tag_ids)]
    if not ids:
        return
    await session.execute(
        delete(SignalTagLink).where(SignalTagLink.signal_id == signal_id, SignalTagLink.tag_id.in_(ids))
    )
    await session.flush()
    await _after_tag_change(session, tenant_id, signal_id, actor_type="user", actor_id=str(user_id or ""))


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
    from app.services.folders import load_catalog, serialize_folders_for_tag

    catalog = await load_catalog(session, tenant_id)
    groups = catalog.groups
    out = []
    for row in await registry_rows(session, tenant_id):
        item = serialize_tag(row, counts.get(row.id, 0) + ticket_counts.get(row.id, 0))
        item["workstream_name"] = names.get(row.workstream_id) if row.workstream_id else None
        item["folders"] = serialize_folders_for_tag(catalog, row.id)
        group = groups.get(row.group_id) if row.group_id else None
        item["group_name"] = group.name if group else None
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
        "group_id": str(row.group_id) if row.group_id else None,
        "show_in_nav": bool(row.show_in_nav),
        "ai_auto_tag": bool(row.ai_auto_tag),
        "send_mode": row.send_mode or "send",
    }


# ---------------------------------------------------------------------------
# Tag groups


def serialize_group(row: TagGroup, *, tag_count: int = 0) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "slug": row.slug,
        "description": row.description or "",
        "exclusive": bool(row.exclusive),
        "sort_order": row.sort_order,
        "tag_count": tag_count,
    }


async def list_groups(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    rows = list(
        (
            await session.execute(
                select(TagGroup).where(TagGroup.tenant_id == tenant_id).order_by(TagGroup.sort_order, TagGroup.name)
            )
        ).scalars()
    )
    counts = dict(
        (
            await session.execute(
                select(SignalTag.group_id, func.count())
                .where(SignalTag.tenant_id == tenant_id, SignalTag.group_id.is_not(None))
                .group_by(SignalTag.group_id)
            )
        ).all()
    )
    return [serialize_group(row, tag_count=int(counts.get(row.id, 0))) for row in rows]


async def _group_row(session: AsyncSession, tenant_id: UUID, group_id: UUID) -> TagGroup:
    row = await session.get(TagGroup, group_id)
    if row is None or row.tenant_id != tenant_id:
        raise LookupError("Tag group not found")
    return row


async def create_group(
    session: AsyncSession,
    tenant_id: UUID,
    name: str,
    *,
    description: str = "",
    exclusive: bool = False,
    commit: bool = True,
) -> TagGroup:
    clean = (name or "").strip()[:80]
    slug = normalize_tag(clean)
    if not slug:
        raise ValueError("Name is required")
    existing = (
        await session.execute(select(TagGroup).where(TagGroup.tenant_id == tenant_id, TagGroup.slug == slug))
    ).scalar_one_or_none()
    if existing is not None:
        raise ValueError(f"A group named {existing.name} already exists")
    row = TagGroup(tenant_id=tenant_id, name=clean, slug=slug, description=description.strip()[:300], exclusive=bool(exclusive))
    session.add(row)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return row


async def update_group(
    session: AsyncSession,
    tenant_id: UUID,
    group_id: UUID,
    *,
    name: str | None = None,
    description: str | None = None,
    exclusive: bool | None = None,
    sort_order: int | None = None,
    commit: bool = True,
) -> TagGroup:
    row = await _group_row(session, tenant_id, group_id)
    if name is not None:
        clean = name.strip()[:80]
        slug = normalize_tag(clean)
        if not slug:
            raise ValueError("Name is required")
        other = (
            await session.execute(select(TagGroup).where(TagGroup.tenant_id == tenant_id, TagGroup.slug == slug))
        ).scalar_one_or_none()
        if other is not None and other.id != row.id:
            raise ValueError(f"A group named {other.name} already exists")
        row.name, row.slug = clean, slug
    if description is not None:
        row.description = description.strip()[:300]
    if exclusive is not None:
        row.exclusive = bool(exclusive)
    if sort_order is not None:
        row.sort_order = int(sort_order)
    row.updated_at = datetime.utcnow()
    session.add(row)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return row


async def delete_group(session: AsyncSession, tenant_id: UUID, group_id: UUID, *, commit: bool = True) -> None:
    """Tags lose their group; group folders lose their dynamic children (and refile)."""
    from app.services.folders import refile_tagged

    row = await _group_row(session, tenant_id, group_id)
    tag_ids = list(
        (await session.execute(select(SignalTag.id).where(SignalTag.tenant_id == tenant_id, SignalTag.group_id == row.id))).scalars()
    )
    await session.execute(
        update(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.group_id == row.id).values(group_id=None)
    )
    await session.flush()
    await refile_tagged(session, tenant_id, tag_ids)
    await session.delete(row)
    if commit:
        await session.commit()
    else:
        await session.flush()


async def exclusive_violations(session: AsyncSession, tenant_id: UUID, group_id: UUID) -> list[dict[str, Any]]:
    """Conversations carrying more than one tag of this group (shown when a group turns exclusive)."""
    rows = await session.execute(
        select(SignalTagLink.signal_id, func.count())
        .join(SignalTag, SignalTag.id == SignalTagLink.tag_id)
        .where(SignalTag.tenant_id == tenant_id, SignalTag.group_id == group_id)
        .group_by(SignalTagLink.signal_id)
        .having(func.count() > 1)
    )
    out: list[dict[str, Any]] = []
    for signal_id, count in rows.all():
        signal = await session.get(Signal, signal_id)
        if signal is None or signal.deleted_at is not None:
            continue
        out.append({"signal_id": str(signal_id), "subject": signal.subject, "count": int(count)})
    return out


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
    show_in_nav: bool = False,
    group_id: UUID | None = None,
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
    if show_in_nav:
        row.show_in_nav = True
    if group_id is not None:
        await _group_row(session, tenant_id, group_id)
        row.group_id = group_id
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
    show_in_nav: bool | None = None,
    ai_auto_tag: bool | None = None,
    group_id: UUID | None = None,
    clear_group: bool = False,
    commit: bool = True,
) -> SignalTag:
    """Rename, describe, group or place a tag. Renaming onto an existing free tag merges the two.

    A group change refiles every conversation carrying the tag (it may now be
    a virtual folder, or stop being one).
    """
    from app.services.folders import refile_tagged

    row = await _tag_row(session, tenant_id, tag_id)
    regroup = False
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
            from app.models.project import Project, ProjectTagLink

            single_tag_projects = (
                await session.execute(
                    select(ProjectTagLink.project_id)
                    .where(ProjectTagLink.tag_id == row.id)
                    .group_by(ProjectTagLink.project_id)
                    .having(func.count() == 1)
                )
            ).scalars()
            if single_tag_projects:
                await session.execute(
                    update(Project)
                    .where(Project.id.in_(list(single_tag_projects)), Project.deleted_at.is_(None))
                    .values(name=clean, slug=clean, updated_at=datetime.utcnow())
                )
    if description is not None:
        row.description = description.strip()[:300]
    if show_in_nav is not None:
        row.show_in_nav = bool(show_in_nav)
    if ai_auto_tag is not None:
        row.ai_auto_tag = bool(ai_auto_tag)
    if clear_group and row.group_id is not None:
        row.group_id = None
        regroup = True
    elif group_id is not None and group_id != row.group_id:
        await _group_row(session, tenant_id, group_id)
        row.group_id = group_id
        regroup = True
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.flush()
    if regroup:
        await refile_tagged(session, tenant_id, [row.id])
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
    for model, owner in ((ContactTagLink, ContactTagLink.contact_id), (CompanyTagLink, CompanyTagLink.company_id)):
        have = set((await session.execute(select(owner).where(model.tag_id == target.id))).scalars())
        for link in list((await session.execute(select(model).where(model.tag_id == source.id))).scalars()):
            owner_id = getattr(link, owner.key)
            if owner_id not in have:
                session.add(model(**{owner.key: owner_id, "tag_id": target.id, "tenant_id": target.tenant_id}))
            await session.delete(link)
    from app.models.project import ProjectTagLink

    for link in list(
        (await session.execute(select(ProjectTagLink).where(ProjectTagLink.tag_id == source.id))).scalars()
    ):
        exists = (
            await session.execute(
                select(ProjectTagLink.project_id).where(
                    ProjectTagLink.project_id == link.project_id,
                    ProjectTagLink.tag_id == target.id,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            link.tag_id = target.id
            session.add(link)
        else:
            await session.delete(link)
    await session.flush()
    await session.delete(source)


async def delete_tag(session: AsyncSession, tenant_id: UUID, tag_id: UUID, *, commit: bool = True) -> None:
    """Remove a tag from the registry, every conversation, contact and company.
    A category's tickets lose their category. A tag that defines a folder
    cannot go: move or remove the folder first."""
    from app.models.project import Project, ProjectTagLink
    from app.services.folders import refile_many

    row = await _tag_row(session, tenant_id, tag_id)
    folders = list(
        (
            await session.execute(
                select(Project.name)
                .join(ProjectTagLink, ProjectTagLink.project_id == Project.id)
                .where(
                    Project.tenant_id == tenant_id,
                    ProjectTagLink.tag_id == row.id,
                    Project.deleted_at.is_(None),
                )
                .distinct()
            )
        ).scalars()
    )
    if folders:
        raise ValueError(
            f"#{row.name} is the tag of folder {folders[0]}"
            + (f" and {len(folders) - 1} more" if len(folders) > 1 else "")
            + ". Remove or retag the folder first."
        )
    affected = list(
        (await session.execute(select(SignalTagLink.signal_id).where(SignalTagLink.tag_id == row.id))).scalars()
    )
    affected.extend(
        (await session.execute(select(Signal.id).where(Signal.tenant_id == tenant_id, Signal.ticket_tag_id == row.id))).scalars()
    )
    contact_ids = list(
        (await session.execute(select(ContactTagLink.contact_id).where(ContactTagLink.tag_id == row.id))).scalars()
    )
    company_ids = list(
        (await session.execute(select(CompanyTagLink.company_id).where(CompanyTagLink.tag_id == row.id))).scalars()
    )
    if contact_ids or company_ids:
        contact_scope = select(Contact.id).where(Contact.tenant_id == tenant_id)
        if contact_ids and company_ids:
            contact_scope = contact_scope.where(or_(Contact.id.in_(contact_ids), Contact.company_id.in_(company_ids)))
        elif contact_ids:
            contact_scope = contact_scope.where(Contact.id.in_(contact_ids))
        else:
            contact_scope = contact_scope.where(Contact.company_id.in_(company_ids))
        affected.extend(
            (await session.execute(select(Signal.id).where(Signal.tenant_id == tenant_id, Signal.contact_id.in_(contact_scope)))).scalars()
        )
    from app.models.calendar import CalendarTagLink

    await session.execute(delete(SignalTagLink).where(SignalTagLink.tag_id == row.id))
    await session.execute(delete(ContactTagLink).where(ContactTagLink.tag_id == row.id))
    await session.execute(delete(CompanyTagLink).where(CompanyTagLink.tag_id == row.id))
    await session.execute(delete(CalendarTagLink).where(CalendarTagLink.tag_id == row.id))
    await session.execute(
        update(Signal)
        .where(Signal.tenant_id == tenant_id, Signal.ticket_tag_id == row.id)
        .values(ticket_tag_id=None, ticket_status="", stage_key="", ticket_certainty=None)
    )
    await session.delete(row)
    await session.flush()
    await refile_many(session, tenant_id, affected)
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
    """Subquery of conversation ids carrying hashtag ``name``: a link, the
    action tag, or inherited from the contact or its company."""
    clean = normalize_tag(name)
    tag_ids = select(SignalTag.id).where(SignalTag.tenant_id == tenant_id, SignalTag.name == clean)
    return signals_with_tag_ids(tenant_id, tag_ids)


def signals_with_tag_ids(tenant_id: UUID, tag_ids):
    """Subquery of conversation ids carrying any of ``tag_ids`` (a subquery or list)."""
    linked = select(SignalTagLink.signal_id).where(SignalTagLink.tag_id.in_(tag_ids))
    filed = select(Signal.id).where(Signal.tenant_id == tenant_id, Signal.ticket_tag_id.in_(tag_ids))
    contacts = select(ContactTagLink.contact_id).where(ContactTagLink.tag_id.in_(tag_ids))
    companies = select(CompanyTagLink.company_id).where(CompanyTagLink.tag_id.in_(tag_ids))
    via_contact = select(Signal.id).where(
        Signal.tenant_id == tenant_id,
        Signal.contact_id.in_(
            select(Contact.id).where(
                Contact.tenant_id == tenant_id,
                or_(Contact.id.in_(contacts), Contact.company_id.in_(companies)),
            )
        ),
    )
    return linked.union(filed, via_contact)


async def _owner_tag_rows(
    session: AsyncSession, tenant_id: UUID, *, contact_id: UUID | None = None, company_id: UUID | None = None
) -> list[SignalTag]:
    if contact_id is not None:
        ids = (
            await session.execute(select(ContactTagLink.tag_id).where(ContactTagLink.contact_id == contact_id))
        ).scalars().all()
    elif company_id is not None:
        ids = (
            await session.execute(select(CompanyTagLink.tag_id).where(CompanyTagLink.company_id == company_id))
        ).scalars().all()
    else:
        return []
    if not ids:
        return []
    return list(
        (
            await session.execute(
                select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.id.in_(ids)).order_by(SignalTag.name)
            )
        ).scalars()
    )


def _tag_payloads(rows: list[SignalTag]) -> list[dict[str, Any]]:
    return [{"id": str(row.id), "name": row.name} for row in rows]


async def list_contact_tags(session: AsyncSession, tenant_id: UUID, contact_id: UUID) -> list[dict[str, Any]]:
    return _tag_payloads(await _owner_tag_rows(session, tenant_id, contact_id=contact_id))


async def list_company_tags(session: AsyncSession, tenant_id: UUID, company_id: UUID) -> list[dict[str, Any]]:
    return _tag_payloads(await _owner_tag_rows(session, tenant_id, company_id=company_id))


async def inherited_tags_by_signal(
    session: AsyncSession, tenant_id: UUID, signals: Iterable[Signal]
) -> dict[UUID, list[str]]:
    """Contact and company tag names per conversation, excluding tags already on the thread."""
    rows = list(signals)
    out: dict[UUID, list[str]] = {row.id: [] for row in rows}
    contact_ids = {row.contact_id for row in rows if row.contact_id}
    if not contact_ids:
        return out
    contacts = {
        contact.id: contact
        for contact in (
            await session.execute(
                select(Contact).where(Contact.tenant_id == tenant_id, Contact.id.in_(contact_ids))
            )
        ).scalars()
    }
    company_ids = {contact.company_id for contact in contacts.values() if contact.company_id}
    contact_names: dict[UUID, list[str]] = {cid: [] for cid in contact_ids}
    if contact_ids:
        for contact_id, name in (
            await session.execute(
                select(ContactTagLink.contact_id, SignalTag.name)
                .join(SignalTag, SignalTag.id == ContactTagLink.tag_id)
                .where(ContactTagLink.contact_id.in_(contact_ids), SignalTag.tenant_id == tenant_id)
                .order_by(SignalTag.name)
            )
        ).all():
            contact_names.setdefault(contact_id, []).append(name)
    company_names: dict[UUID, list[str]] = {}
    if company_ids:
        for company_id, name in (
            await session.execute(
                select(CompanyTagLink.company_id, SignalTag.name)
                .join(SignalTag, SignalTag.id == CompanyTagLink.tag_id)
                .where(CompanyTagLink.company_id.in_(company_ids), SignalTag.tenant_id == tenant_id)
                .order_by(SignalTag.name)
            )
        ).all():
            company_names.setdefault(company_id, []).append(name)
    own = await tags_by_signal(session, [row.id for row in rows])
    for row in rows:
        if not row.contact_id:
            continue
        contact = contacts.get(row.contact_id)
        names = list(contact_names.get(row.contact_id, []))
        if contact and contact.company_id:
            names.extend(company_names.get(contact.company_id, []))
        seen = set(own.get(row.id, []))
        unique: list[str] = []
        for name in names:
            if name in seen:
                continue
            seen.add(name)
            unique.append(name)
        out[row.id] = unique
    return out


async def set_contact_tags(
    session: AsyncSession, tenant_id: UUID, contact_id: UUID, names: list[str], *, user_id: UUID | None = None
) -> list[dict[str, Any]]:
    from app.services.folders import refile_many

    wanted = await ensure_tags(session, tenant_id, names, user_id=user_id)
    await session.execute(delete(ContactTagLink).where(ContactTagLink.contact_id == contact_id))
    now = datetime.utcnow()
    for row in wanted.values():
        session.add(ContactTagLink(contact_id=contact_id, tag_id=row.id, tenant_id=tenant_id, created_at=now))
    await session.flush()
    signal_ids = list(
        (
            await session.execute(
                select(Signal.id).where(Signal.tenant_id == tenant_id, Signal.contact_id == contact_id)
            )
        ).scalars()
    )
    await refile_many(session, tenant_id, signal_ids)
    return _tag_payloads(await _owner_tag_rows(session, tenant_id, contact_id=contact_id))


async def set_company_tags(
    session: AsyncSession, tenant_id: UUID, company_id: UUID, names: list[str], *, user_id: UUID | None = None
) -> list[dict[str, Any]]:
    from app.models.channel import Contact
    from app.services.folders import refile_many

    wanted = await ensure_tags(session, tenant_id, names, user_id=user_id)
    await session.execute(delete(CompanyTagLink).where(CompanyTagLink.company_id == company_id))
    now = datetime.utcnow()
    for row in wanted.values():
        session.add(CompanyTagLink(company_id=company_id, tag_id=row.id, tenant_id=tenant_id, created_at=now))
    await session.flush()
    contact_ids = list(
        (
            await session.execute(
                select(Contact.id).where(Contact.tenant_id == tenant_id, Contact.company_id == company_id)
            )
        ).scalars()
    )
    if contact_ids:
        signal_ids = list(
            (
                await session.execute(
                    select(Signal.id).where(Signal.tenant_id == tenant_id, Signal.contact_id.in_(contact_ids))
                )
            ).scalars()
        )
        await refile_many(session, tenant_id, signal_ids)
    return _tag_payloads(await _owner_tag_rows(session, tenant_id, company_id=company_id))
