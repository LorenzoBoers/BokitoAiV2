"""Tag registry: one managed tag vocabulary for the Messages hub.

A tag is a `SignalTag` row (tenant-scoped, normalized name, optional
description). Threads reference tags by name in `Signal.tags_json`, so:

- Operators can create a tag in settings before any thread uses it.
- Tagging a thread with a new name registers it (`ensure_tags`), so the list
  never drifts from what is in use.
- AI triage and agent tools may only apply registered names, and read the
  descriptions as guidance.
- Rename and remove rewrite both the registry and every thread, so a tag
  folder in the sidebar always matches the threads behind it.
"""

import json
from datetime import datetime
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal, SignalTag

MAX_TAG_LEN = 40
MAX_TAGS_PER_THREAD = 20
MAX_DESCRIPTION_LEN = 200
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


def _parse_thread_tags(tags_json: str | None) -> list[str]:
    try:
        tags = json.loads(tags_json or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    return [t for t in tags if isinstance(t, str) and t.strip()]


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


async def usage_counts(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, dict[str, int]]:
    """Thread counts per tag name (customer threads only, ACL aware)."""
    from app.services.signal_threads import _visibility_predicate

    query = select(Signal.tags_json, Signal.status).where(
        Signal.tenant_id == tenant_id,
        Signal.channel.notin_(("internal", "assistant")),
        Signal.tags_json.isnot(None),
        Signal.tags_json != "[]",
    )
    acl = _visibility_predicate(visible_account_ids)
    if acl is not None:
        query = query.where(acl)
    result = await session.execute(query)

    totals: dict[str, dict[str, int]] = {}
    for tags_json, status in result.all():
        for raw in _parse_thread_tags(tags_json):
            name = normalize_tag(raw)
            if not name:
                continue
            row = totals.setdefault(name, {"total": 0, "open": 0})
            row["total"] += 1
            if status == "open":
                row["open"] += 1
    return totals


async def catalog(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
) -> list[dict[str, Any]]:
    """Registry entries with usage counts, most used first.

    Tags found on threads but missing from the registry (legacy data) are
    reported too, so no sidebar folder silently disappears.
    """
    counts = await usage_counts(
        session, tenant_id, visible_account_ids=visible_account_ids
    )
    registry = await _registry_by_name(session, tenant_id)
    names = set(registry) | set(counts)
    items = [
        {
            "tag": name,
            "description": (registry[name].description if name in registry else ""),
            "registered": name in registry,
            "total": counts.get(name, {}).get("total", 0),
            "open": counts.get(name, {}).get("open", 0),
        }
        for name in names
    ]
    items.sort(key=lambda row: (-row["total"], row["tag"]))
    return items


async def create_tag(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    name: str,
    description: str = "",
) -> SignalTag:
    normalized = normalize_tag(name)
    if not normalized:
        raise ValueError("tag name cannot be empty")
    existing = (await _registry_by_name(session, tenant_id)).get(normalized)
    if existing:
        return existing
    row = SignalTag(
        tenant_id=tenant_id,
        name=normalized,
        description=(description or "").strip()[:MAX_DESCRIPTION_LEN],
        created_by_user_id=user_id,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def update_tag(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    tag: str,
    new_name: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Rename a tag across the registry and every thread, and/or edit its
    description. Returns `{"tag": final_name, "changed": threads_touched}`."""
    current = normalize_tag(tag)
    if not current:
        return {"tag": "", "changed": 0}
    registry = await _registry_by_name(session, tenant_id)
    row = registry.get(current)
    renamed = normalize_tag(new_name or "") or None
    if renamed == current:
        renamed = None

    if description is not None:
        target = row or (await _ensure_row(session, tenant_id, current, user_id))
        target.description = description.strip()[:MAX_DESCRIPTION_LEN]
        target.updated_at = datetime.utcnow()
        session.add(target)
        row = target

    changed = 0
    if renamed:
        existing_target = registry.get(renamed)
        if row is not None:
            if existing_target is not None and existing_target.id != row.id:
                # Merging into an existing tag: keep the target row.
                if not (existing_target.description or "").strip():
                    existing_target.description = row.description
                    session.add(existing_target)
                await session.delete(row)
            else:
                row.name = renamed
                row.updated_at = datetime.utcnow()
                session.add(row)
        elif existing_target is None:
            session.add(
                SignalTag(
                    tenant_id=tenant_id, name=renamed, created_by_user_id=user_id
                )
            )
        changed = await _rewrite_thread_tags(session, tenant_id, current, renamed)

    await _audit_tag_change(
        session,
        tenant_id,
        user_id,
        tag=current,
        renamed=renamed,
        changed=changed,
        description_only=renamed is None,
    )
    await session.commit()
    return {"tag": renamed or current, "changed": changed}


async def delete_tag(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, *, tag: str
) -> int:
    """Remove a tag from the registry and from every thread."""
    current = normalize_tag(tag)
    if not current:
        return 0
    row = (await _registry_by_name(session, tenant_id)).get(current)
    if row is not None:
        await session.delete(row)
    changed = await _rewrite_thread_tags(session, tenant_id, current, None)
    await _audit_tag_change(
        session, tenant_id, user_id, tag=current, renamed=None, changed=changed
    )
    await session.commit()
    return changed


async def _ensure_row(
    session: AsyncSession, tenant_id: UUID, name: str, user_id: UUID | None
) -> SignalTag:
    row = SignalTag(tenant_id=tenant_id, name=name, created_by_user_id=user_id)
    session.add(row)
    await session.flush()
    return row


async def _rewrite_thread_tags(
    session: AsyncSession, tenant_id: UUID, tag: str, renamed: str | None
) -> int:
    """Replace or drop `tag` on every thread of the tenant. Returns row count."""
    result = await session.execute(
        select(Signal).where(
            Signal.tenant_id == tenant_id,
            Signal.tags_json.ilike(f'%"{tag}"%'),
        )
    )
    changed = 0
    for signal in result.scalars().all():
        tags = normalize_tags(_parse_thread_tags(signal.tags_json))
        if tag not in tags:
            continue
        next_tags = [t for t in tags if t != tag]
        if renamed and renamed not in next_tags:
            next_tags.append(renamed)
        signal.tags_json = json.dumps(next_tags)
        signal.updated_at = datetime.utcnow()
        session.add(signal)
        changed += 1
    return changed


async def _audit_tag_change(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    tag: str,
    renamed: str | None,
    changed: int,
    description_only: bool = False,
) -> None:
    from app.services.audit import record_audit

    if description_only:
        action, summary = "signal:tag_updated", f"described {tag}"
    elif renamed:
        action, summary = "signal:tag_renamed", f"{tag} -> {renamed}"
    else:
        action, summary = "signal:tag_deleted", f"removed {tag}"
    await record_audit(
        session,
        tenant_id,
        action=action,
        actor_type="user",
        actor_id=user_id,
        resource_type="signal_tag",
        resource_id=tag,
        summary=summary,
        before={"tag": tag, "threads": str(changed)},
        after={"tag": renamed or ""},
        commit=False,
    )
